<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { FullScreen, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElCheckbox, ElInput, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag, type InputInstance } from 'element-plus'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import SerialUrgencyBadge from '@/components/SerialUrgencyBadge.vue'
import type { CalendarRange } from '@/types/recordFilters'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamWorkspaceActions from '@/components/TeamWorkspaceActions.vue'
import StockSourcePicker from '@/components/StockSourcePicker.vue'
import TeamMaterialOverviewPanel from '@/components/TeamMaterialOverview.vue'
import TeamSerialOverview from '@/components/TeamSerialOverview.vue'
import TeamMaterialAnalysis from '@/components/TeamMaterialAnalysis.vue'
import MaterialAmount from '@/components/MaterialAmount.vue'
import MaterialStockActionDialog from '@/components/MaterialStockActionDialog.vue'
import WarehouseReceiptDialog from '@/components/WarehouseReceiptDialog.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import BarcodeCard from '@/components/BarcodeCard.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import MaterialTransferStatus from '@/components/MaterialTransferStatus.vue'
import StatePanel from '@/components/StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { showToast } from '@/stores/toast'
import { teamWorkspaceProfile } from '@/config/teamWorkspaces'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import { subscribeSharedInventoryChanges as subscribeInventoryChanges } from '@/services/inventoryChanges'
import { materialTransferApi } from '@/services/materialTransferApi'
import { isExternalEntryKind, materialEntryLabel, materialSourceLabel, receiptSourceLabel, materialTypeOptions, materialTypeLabel, type MaterialTransfer, type MaterialType } from '@/types/materialTransfer'
import { isDispatchNumber, dispatchStatusLabel, dispatchStatusLabels, type DispatchKind, type DispatchStatus, type TeamMaterialOverview, type StockBatch, type MaterialDispatch, type MaterialLoss } from '@/types/teamMaterials'
import { formatDateTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const teamKey = computed(() => String(route.params.teamId ?? ''))
const teamId = computed(() => Number(teamKey.value))
const validId = computed(() => /^\d+$/.test(teamKey.value) && Number.isSafeInteger(teamId.value) && teamId.value > 0)
const team = computed(() => directory.items.find(item => String(item.id) === teamKey.value))
const profile = computed(() => teamWorkspaceProfile(team.value?.code))
const scopeReady = computed(() => validId.value && directory.loaded && !directory.error && Boolean(team.value?.active))
const scopeLoading = computed(() => validId.value && !directory.error && (!directory.loaded || directory.loading) && !scopeReady.value)
const canWrite = computed(() => scopeReady.value && auth.isTeamAccount && auth.currentUser?.active !== false && String(auth.currentUser?.team_id) === teamKey.value && !auth.currentUserError)
const isWarehouse = computed(() => scopeReady.value && team.value?.code === 'FACTORY-WAREHOUSE' && team.value?.kind === 'warehouse')
const canReceive = computed(() => isWarehouse.value && canWrite.value && auth.currentUser?.active !== false)
const title = computed(() => scopeReady.value ? profile.value?.name || team.value!.name : '班组工作台')
const tabValues = computed(() => ['overview', 'materials', 'pending', 'stock', 'outgoing', 'losses', ...(isWarehouse.value ? ['receipts'] : [])])
const queryText = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const tab = computed(() => queryText('tab') === 'serials' ? 'stock' : tabValues.value.includes(queryText('tab')) ? queryText('tab') : queryText('direction') === 'outgoing' ? 'outgoing' : queryText('direction') === 'incoming' ? queryText('status') === 'received' ? 'stock' : 'pending' : 'stock')
watch(() => queryText('tab'), value => {
  if (value === 'serials') void router.replace({ path: route.path, query: { ...route.query, tab: 'stock' }, hash: route.hash })
}, { immediate: true })
const page = computed(() => Number.isSafeInteger(Number(queryText('page'))) && Number(queryText('page')) > 0 ? Number(queryText('page')) : 1)
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(queryText('page_size'))) ? Number(queryText('page_size')) : 10)
const queryDraft = ref('')
const dateDraft = ref<CalendarRange>({ from: '', to: '' }), urgentDraft = ref(false)
const materialDraft = ref<MaterialType | ''>('')
const receiptSourceDraft = ref<'external' | 'internal' | 'return' | ''>('')
const statusDraft = ref<DispatchStatus | ''>('')
const nextTeamDraft = ref<string | number>('')
const kindDraft = ref<DispatchKind | ''>('')
const dispatchKinds = ['transfer', 'warehouse_outbound', 'inspection_shipment'] as const
const overview = ref<TeamMaterialOverview | null>(null)
const overviewError = ref('')
const pending = ref<MaterialTransfer[]>([])
const outgoing = ref<MaterialDispatch[]>([])
const losses = ref<MaterialLoss[]>([])
const receipts = ref<MaterialTransfer[]>([])
const receiptOpen = ref(false)
const openingReceipt = ref(false)
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const selected = ref<MaterialTransfer | null>(null)
const drawerOpen = ref(false)
const groupOpen = ref(false)
const selectedDispatchNo = ref('')
const detailOpen = computed(() => drawerOpen.value || groupOpen.value)
const actionOpen = ref(false)
const pickerOpen = ref(false)
const openingDispatch = ref(false)
const actionMode = ref<'dispatch' | 'loss'>('dispatch')
const actionSources = ref<StockBatch[]>([])
const scanner = ref<InputInstance>()
const scanValue = ref('')
const scanError = ref('')
const scanning = ref(false)
const container = ref<HTMLElement>()
const contentWidth = ref(0)
const docked = computed(() => contentWidth.value >= 1660)
const traceScope = computed(() => ({ team_id: teamId.value, direction: 'all' as const }))
const actionBindings = computed(() => ({ canWrite: canWrite.value, canReceive: canReceive.value, openingReceipt: openingReceipt.value, openingDispatch: openingDispatch.value, loading: loading.value, onDispatch: openNewDispatch, onReceipt: openReceipt, onScan: focusScan, onRefresh: loadView }))
let version = 0
let actionVersion = 0
let scanVersion = 0
let observer: ResizeObserver | undefined
let hid = ''
let hidTime = 0
const syncState = ref<InventoryConnection>('connecting'), syncError = ref('')
let unsubscribe: (() => void) | undefined, streamVersion = 0
let refreshQueued = false, refreshing = false, disposed = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined

function queueRefresh() {
  if (disposed || document.hidden) return
  refreshQueued = true
  if (refreshTimer || refreshing || loading.value) return
  refreshTimer = setTimeout(async () => {
    refreshTimer = undefined
    if (disposed || document.hidden) return
    if (loading.value) return // Its completion watcher drains the queued update.
    refreshQueued = false; refreshing = true
    const scope = teamKey.value
    try {
      await Promise.all([auth.refreshCurrentUser(), directory.refreshTeamDirectory()])
      if (!disposed && !document.hidden && scope === teamKey.value && scopeReady.value) await loadView(false, true)
    } catch { if (!disposed) syncError.value = '数据更新失败，保留上次结果，请刷新重试。' }
    finally { refreshing = false; if (refreshQueued) queueRefresh() }
  }, 100)
}
function connectChanges() {
  const current = ++streamVersion
  unsubscribe?.()
  unsubscribe = subscribeInventoryChanges({
    onData() { if (current === streamVersion) queueRefresh() },
    onState(state) { if (current === streamVersion) syncState.value = state },
  })
}
function syncVisibility() {
  if (document.hidden) { ++streamVersion; unsubscribe?.(); unsubscribe = undefined; clearTimeout(refreshTimer); refreshTimer = undefined; refreshQueued = false }
  else connectChanges()
}
watch(loading, value => { if (!value && refreshQueued) queueRefresh() })

function asTransfer(row: unknown) { return row as MaterialTransfer }
function asLoss(row: unknown) { return row as MaterialLoss }

function selectTab(value: string) { void router.push({ path: route.path, query: value === 'stock' ? {} : { tab: value } }) }
function applyFilters(nextPage = 1, size = pageSize.value) {
  void router.replace({ path: route.path, query: { tab: tab.value, ...(tab.value === 'receipts' && receiptSourceDraft.value ? { receipt_source: receiptSourceDraft.value } : {}), ...(dateDraft.value.from ? { date_from: dateDraft.value.from } : {}), ...(dateDraft.value.to ? { date_to: dateDraft.value.to } : {}), ...(urgentDraft.value ? { urgent_only: 'true' } : {}), ...(queryDraft.value.trim() ? { query: queryDraft.value.trim() } : {}), ...(tab.value === 'receipts' && materialDraft.value ? { material_type: materialDraft.value } : {}), ...(tab.value === 'outgoing' ? { ...(kindDraft.value ? { entry_kind: kindDraft.value } : {}), ...(statusDraft.value ? { status: statusDraft.value } : {}), ...(!isExternalEntryKind(kindDraft.value) && nextTeamDraft.value ? { next_team_id: String(nextTeamDraft.value) } : {}) } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}), ...(size !== 10 ? { page_size: String(size) } : {}) } })
}
function closeDetails() { ++actionVersion; pickerOpen.value = false; openingDispatch.value = false; drawerOpen.value = false; groupOpen.value = false; selectedDispatchNo.value = '';  selected.value = null; actionOpen.value = false; receiptOpen.value = false; actionSources.value = []; ++scanVersion; scanning.value = false; scanError.value = '' }
function openDetail(transfer: MaterialTransfer) { groupOpen.value = false; selected.value = transfer; drawerOpen.value = true }
function openDispatch(code: string) { drawerOpen.value = false; selectedDispatchNo.value = code; groupOpen.value = true }
function openIncoming(transfer: MaterialTransfer) { if (transfer.dispatch_no && isDispatchNumber(transfer.dispatch_no)) openDispatch(transfer.dispatch_no); else openDetail(transfer) }
function openLossSource(loss: MaterialLoss) { selected.value = null; selectedBatchNo.value = loss.batch_no; drawerOpen.value = true }
const selectedBatchNo = ref('')
watch(selected, transfer => { if (transfer) selectedBatchNo.value = transfer.batch_no })

async function openAction(mode: 'dispatch' | 'loss', sources: StockBatch[]) {
  const current = ++actionVersion
  const scope = teamKey.value
  try { await auth.refreshCurrentUser() } catch { showToast('账号信息刷新失败，请重试', 'error'); return }
  if (current !== actionVersion || scope !== teamKey.value || !canWrite.value || !sources.length) return
  pickerOpen.value = false
  actionMode.value = mode; actionSources.value = sources; actionOpen.value = true
}
async function openNewDispatch() {
  if (!canWrite.value || openingDispatch.value) return
  closeDetails()
  const current = actionVersion
  openingDispatch.value = true
  try {
    await auth.refreshCurrentUser()
    if (current === actionVersion && canWrite.value) pickerOpen.value = true
  } catch { showToast('账号信息刷新失败，请重试', 'error') }
  finally { if (current === actionVersion) openingDispatch.value = false }
}
function savedAction(result: MaterialDispatch | MaterialLoss) {
  showToast('dispatch_no' in result ? `${materialEntryLabel(result.entry_kind)} ${result.dispatch_no} 已生成，共 ${result.line_count} 条物料明细，整批一个条码` : `丢失记录 ${result.loss_no} 已登记`, 'success')
  void loadView()
  if ('dispatch_no' in result && isDispatchNumber(result.dispatch_no)) openDispatch(result.dispatch_no)
}

async function openReceipt() {
  if (openingReceipt.value || !canReceive.value) return
  const scope = teamKey.value
  openingReceipt.value = true
  try {
    await auth.refreshCurrentUser()
    if (scope === teamKey.value && canReceive.value) receiptOpen.value = true
  } catch { showToast('账号信息刷新失败，请重试', 'error') }
  finally { openingReceipt.value = false }
}
function savedReceipt(transfer: MaterialTransfer) {
  if (String(isExternalEntryKind(transfer.entry_kind) ? transfer.source_team.id : transfer.next_team.id) !== teamKey.value) return
  showToast(`入库单 ${transfer.batch_no} 已入账`, 'success')
  void loadView(true)
}

async function loadView(refreshWarehouse: unknown = false, background = false) {
  const current = ++version
  if (!scopeReady.value) { overview.value = null; pending.value = []; outgoing.value = []; losses.value = []; receipts.value = []; total.value = 0; loading.value = false; return }
  if (!background) { loading.value = true; loadError.value = ''; overviewError.value = '' }
  syncError.value = ''
  const id = teamId.value
  const currentTab = tab.value
  const params = { date_from: queryText('date_from') || undefined, date_to: queryText('date_to') || undefined, urgent_only: queryText('urgent_only') === 'true' || undefined, query: queryText('query') || undefined, page: page.value, page_size: pageSize.value }
  const materialType = materialTypeOptions.find(option => option.value === queryText('material_type'))?.value
  const dispatchStatus = Object.keys(dispatchStatusLabels).includes(queryText('status')) ? queryText('status') as DispatchStatus : undefined
  const balanceRequest = teamMaterialApi.overview(id).then(result => { if (current === version) { overview.value = result; overviewError.value = '' } }).catch(error => { if (current === version) { if (background) syncError.value = '数据更新失败，保留上次结果，请刷新重试。'; else { overview.value = null; overviewError.value = error instanceof Error ? error.message : '物料纵览加载失败' } } })
  const refreshRequests = refreshWarehouse === true && isWarehouse.value ? [
    ...(currentTab !== 'receipts' ? [teamMaterialApi.receipts(id, { page: 1, page_size: 20 }).then(result => { if (current === version) receipts.value = result.items })] : []),
  ].map(request => request.catch(() => { if (current === version) showToast('入库已成功，部分物料记录刷新失败，请点击刷新', 'error') })) : []
  try {
    if (currentTab === 'pending') { const result = await materialTransferApi.list({ ...params, team_id: id, direction: 'incoming', status: 'pending' }); if (current === version) { pending.value = result.items; total.value = result.total } }
    else if (currentTab === 'outgoing') { const result = await teamMaterialApi.dispatches(id, { ...params, next_team_id: isExternalEntryKind(queryText('entry_kind')) ? undefined : queryText('next_team_id') || undefined, status: dispatchStatus, entry_kind: dispatchKinds.find(kind => kind === queryText('entry_kind')) }); if (current === version) { outgoing.value = result.items; total.value = result.total } }
    else if (currentTab === 'losses') { const result = await teamMaterialApi.losses(id, params); if (current === version) { losses.value = result.items; total.value = result.total } }
    else if (currentTab === 'receipts' && isWarehouse.value) { const result = await teamMaterialApi.receipts(id, { ...params, material_type: materialType, receipt_source: receiptSourceDraft.value || undefined }); if (current === version) { receipts.value = result.items; total.value = result.total } }
    if (current === version) loadError.value = ''
  } catch (error) { if (current === version) { if (background) syncError.value = '数据更新失败，保留上次结果，请刷新重试。'; else { pending.value = []; outgoing.value = []; losses.value = []; receipts.value = []; total.value = 0; loadError.value = error instanceof Error ? error.message : '物料记录加载失败' } } }
  await Promise.all([balanceRequest, ...refreshRequests])
  if (current === version) loading.value = false
}

watch([() => ['overview', 'stock', 'materials'].includes(tab.value) ? `${route.path}:${tab.value}` : route.fullPath, scopeReady], () => {
  closeDetails(); pending.value = []; outgoing.value = []; losses.value = []; receipts.value = []; overview.value = null
  dateDraft.value = { from: queryText('date_from'), to: queryText('date_to') }; urgentDraft.value = queryText('urgent_only') === 'true'
  receiptSourceDraft.value = ['external', 'internal', 'return'].includes(queryText('receipt_source')) ? queryText('receipt_source') as 'external' | 'internal' | 'return' : ''
  queryDraft.value = queryText('query'); materialDraft.value = materialTypeOptions.find(option => option.value === queryText('material_type'))?.value || ''; statusDraft.value = Object.keys(dispatchStatusLabels).includes(queryText('status')) ? queryText('status') as DispatchStatus : ''; nextTeamDraft.value = queryText('next_team_id'); kindDraft.value = dispatchKinds.find(kind => kind === queryText('entry_kind')) || ''
  void loadView()
}, { immediate: true })
watch(() => `${auth.currentUser?.id ?? ''}:${auth.currentUser?.team_id ?? ''}:${auth.currentUser?.active}:${auth.isTeamAccount}`, () => { closeDetails(); void loadView() })

async function scan() {
  const code = scanValue.value.trim()
  if (!code || scanning.value || !scopeReady.value) return
  const current = ++scanVersion
  scanning.value = true; scanError.value = ''
  try {
    if (isDispatchNumber(code)) {
      const group = await materialDispatchApi.get(code)
      if (current !== scanVersion) return
      if (![group.source_team.id, group.next_team.id].some(id => String(id) === teamKey.value)) { scanError.value = '此出库批次与当前工作台不符。'; return }
      openDispatch(group.dispatch_no); scanValue.value = ''; return
    }
    const transfer = await materialTransferApi.get(code)
    if (current !== scanVersion) return
    if (String(isExternalEntryKind(transfer.entry_kind) ? transfer.source_team.id : transfer.next_team.id) !== teamKey.value) { scanError.value = '这张单据的接收班组与当前工作台不符，外部出库请到出库班组查看。'; return }
    openIncoming(transfer); scanValue.value = ''
  } catch (error) { if (current === scanVersion) scanError.value = error instanceof Error ? error.message : '未找到转料单' }
  finally { if (current === scanVersion) scanning.value = false }
}
async function focusScan() { if (tab.value !== 'pending') await router.replace({ path: route.path, query: { tab: 'pending' } }); await nextTick(); scanner.value?.focus() }
function handleScanKey(event: KeyboardEvent) {
  if (tab.value !== 'pending' || detailOpen.value || actionOpen.value || event.ctrlKey || event.altKey || event.metaKey || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))) return
  const now = Date.now()
  if (now - hidTime > 100) hid = ''
  hidTime = now
  if (event.key === 'Enter') { if (hid.length >= 6) { event.preventDefault(); scanValue.value = hid; void scan() } hid = '' }
  else if (event.key.length === 1) hid += event.key
}
onMounted(() => {
  if (!directory.loaded && !directory.loading) void directory.refreshTeamDirectory()
  observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { contentWidth.value = container.value?.clientWidth || 0 }) : undefined
  if (container.value) { contentWidth.value = container.value.clientWidth; observer?.observe(container.value) }
  document.addEventListener('keydown', handleScanKey)
  document.addEventListener('visibilitychange', syncVisibility)
  if (!document.hidden) connectChanges()
})
onBeforeUnmount(() => { disposed = true; ++streamVersion; unsubscribe?.(); clearTimeout(refreshTimer); ++version; ++scanVersion; ++actionVersion; observer?.disconnect(); document.removeEventListener('keydown', handleScanKey); document.removeEventListener('visibilitychange', syncVisibility) })
</script>

<template>
  <TeamWorkspaceShell :title="title" :model-value="tab" :warehouse="isWarehouse" :pending-count="overview?.pending_incoming.count" :class="{ 'team-workspace--docked': docked && detailOpen }" @update:model-value="selectTab">
    <template #actions><TeamWorkspaceActions v-if="scopeReady" v-bind="actionBindings" :show-scan="tab !== 'pending'" /></template>
    <div ref="container" class="team-material-content">
      <ElAlert v-if="syncError || syncState === 'reconnecting' || syncState === 'expired'" type="warning" :closable="false" :title="syncState === 'expired' ? '登录或访问凭证已失效，请重新验证。' : syncError || '实时连接中断，当前显示上次结果，正在重连。'" />
      <StatePanel v-if="scopeLoading" state="loading" title="正在读取班组信息" />
      <StatePanel v-else-if="!scopeReady" state="error" :title="!validId ? '无效的班组编号' : directory.error ? '班组目录加载失败' : '未找到启用的班组'" description="请刷新班组目录，或从侧边栏选择已配置的班组。" @retry="directory.refreshTeamDirectory" />
      <template v-else>
        <ElAlert v-if="overview?.legacy_received_count" class="legacy-notice" type="info" :closable="false" :title="`另有 ${overview.legacy_received_count} 张历史已接收单未纳入台账余额。`"><template #default>历史单据仍可在 <RouterLink :to="{ path: '/transfer-batches', query: { next_team_id: teamKey, status: 'received' } }">全局转料记录</RouterLink> 查看。</template></ElAlert>
        <template v-if="['overview', 'stock', 'materials'].includes(tab)">
          <StatePanel v-if="loading && !overview" state="loading" title="正在读取物料结存" />
          <StatePanel v-else-if="overviewError" state="error" :description="overviewError" @retry="loadView" />
          <TeamMaterialAnalysis v-else-if="overview && tab === 'overview'" :key="teamId" :team-id="teamId" :overview="overview" />
          <TeamSerialOverview v-else-if="overview && tab === 'stock'" :key="teamId" :team-id="teamId" :overview="overview" :can-write="canWrite" @changed="loadView" @action="openAction" />
          <TeamMaterialOverviewPanel v-else-if="overview" :overview="overview" @filter="router.push({ path: route.path, query: { tab: 'stock', material_name: $event, filter_label: `库存材质：${$event}` } })" />
        </template>
        <template v-else>
          <div class="team-list-layout" :class="{ 'team-list-layout--detail': docked && detailOpen }">
            <section class="team-list-panel">
              <div class="list-toolbar" :class="{ 'list-toolbar--pending': tab === 'pending' }">
                <ElInput v-model="queryDraft" :prefix-icon="Search" :aria-label="`${tab === 'losses' ? '丢失记录' : '物料'}搜索`" clearable :placeholder="tab === 'outgoing' ? '搜索出库号、批次、流水号或材质' : tab === 'pending' ? '批次、流水号或材质' : '搜索批次、流水号或材质'" @keyup.enter="applyFilters()" @clear="applyFilters()" />
                <template v-if="tab === 'pending'"><ElButton @click="applyFilters()">查询</ElButton><div class="scanner-inline"><ElInput ref="scanner" v-model="scanValue" aria-label="扫描转料批次号" placeholder="扫码或输入批次号" @keyup.enter="scan" /><ElButton :icon="FullScreen" :loading="scanning" @click="scan">查看来料</ElButton></div></template>
                <ElSelect v-if="tab === 'receipts'" v-model="materialDraft" aria-label="物料类型筛选" placeholder="全部类型" clearable @change="applyFilters()"><ElOption v-for="type in materialTypeOptions" :key="type.value" :value="type.value" :label="type.label" /></ElSelect>
                <ElSelect v-if="tab === 'receipts'" v-model="receiptSourceDraft" aria-label="入库来源筛选" placeholder="全部来源" clearable @change="applyFilters()"><ElOption value="external" label="外部来料（含退回）" /><ElOption value="internal" label="车间转入" /><ElOption value="return" label="外部退回" /></ElSelect>
                <ElSelect v-if="tab === 'outgoing'" v-model="kindDraft" aria-label="出库方式筛选" placeholder="全部方式" clearable @change="applyFilters()"><ElOption v-for="kind in dispatchKinds" :key="kind" :value="kind" :label="materialEntryLabel(kind)" /></ElSelect>
                <ElSelect v-if="tab === 'outgoing'" v-model="statusDraft" aria-label="出库状态筛选" placeholder="全部状态" clearable @change="applyFilters()"><ElOption v-for="(label, value) in dispatchStatusLabels" :key="value" :value="value" :label="label" /></ElSelect>
                <ElSelect v-if="tab === 'outgoing' && !isExternalEntryKind(kindDraft)" v-model="nextTeamDraft" aria-label="接收班组筛选" placeholder="全部接收班组" clearable filterable @change="applyFilters()"><ElOption v-for="item in directory.items.filter(item => item.active && String(item.id) !== teamKey)" :key="item.id" :value="String(item.id)" :label="teamWorkspaceProfile(item.code)?.name || item.name" /></ElSelect>
                <RecordDateFilter v-model="dateDraft" :label="tab === 'receipts' ? '入库日期' : '登记日期'" @update:model-value="applyFilters()" />
                <ElCheckbox v-model="urgentDraft" @change="applyFilters()">仅看加急</ElCheckbox>
                <ElButton v-if="tab !== 'pending'" @click="applyFilters()">查询</ElButton>
              </div>
              <p v-if="tab === 'pending' && scanError" class="scanner-error" role="alert">{{ scanError }}</p>
              <StatePanel v-if="loading" state="loading" title="正在读取物料记录" />
              <StatePanel v-else-if="loadError" state="error" :description="loadError" @retry="loadView" />
              <StatePanel v-else-if="!total" state="empty" :title="tab === 'pending' ? '暂无待接收来料' : tab === 'outgoing' ? '暂无出库记录' : tab === 'receipts' ? '暂无入库记录' : '暂无丢失记录'" description="可以调整搜索条件或刷新记录。" />
              <div v-else class="team-table-scroll">
                <ElTable v-if="tab === 'pending'" :data="pending" class="business-table team-table" row-key="id">
                  <ElTableColumn label="批次 / 流水号" min-width="220"><template #default="{ row }"><button class="batch-link" @click="openIncoming(asTransfer(row))">{{ row.dispatch_no || row.batch_no }}</button><small class="cell-secondary">{{ row.serial_no }}<SerialUrgencyBadge :urgency="row.urgency" /></small></template></ElTableColumn>
                  <ElTableColumn label="材质 / 类型" min-width="140"><template #default="{ row }">{{ row.material_name || '—' }}<small class="cell-secondary">{{ materialTypeLabel(row.material_type) }}</small></template></ElTableColumn>
                  <ElTableColumn label="数量 / 重量" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.quantity" :weight="row.weight" /></template></ElTableColumn>
                  <ElTableColumn label="上序" min-width="100"><template #default="{ row }">{{ row.source_team.name }}</template></ElTableColumn>
                  <ElTableColumn label="转出人 / 时间" min-width="150"><template #default="{ row }">{{ row.transferred_by || '—' }}<small class="cell-secondary">{{ formatDateTime(row.transferred_at) }}</small></template></ElTableColumn>
                  <ElTableColumn label="操作" width="110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="openIncoming(asTransfer(row))">{{ row.dispatch_no ? '查看整批' : canWrite ? '核对接收' : '查看详情' }}</ElButton></template></ElTableColumn>
                </ElTable>
                <ElTable v-else-if="tab === 'receipts'" :data="receipts" class="business-table team-table" row-key="id">
                  <ElTableColumn label="入库单 / 流水号" min-width="240"><template #default="{ row }"><button class="batch-link" @click="openDetail(asTransfer(row))">{{ row.batch_no }}</button><small class="cell-secondary">{{ row.serial_no }}<SerialUrgencyBadge :urgency="row.urgency" /></small></template></ElTableColumn>
                  <ElTableColumn label="入库来源" min-width="160"><template #default="{ row }">{{ receiptSourceLabel(asTransfer(row)) }}<small class="cell-secondary">{{ materialSourceLabel(asTransfer(row)) }}</small></template></ElTableColumn>
                  <ElTableColumn label="材质 / 类型" min-width="140"><template #default="{ row }">{{ row.material_name }}<small class="cell-secondary">{{ materialTypeLabel(row.material_type) }}</small></template></ElTableColumn>
                  <ElTableColumn label="数量 / 重量" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.quantity" :weight="row.weight" /></template></ElTableColumn>
                  <ElTableColumn label="入库说明" min-width="160" prop="notes" show-overflow-tooltip />
                  <ElTableColumn label="状态" width="120"><template #default="{ row }"><MaterialTransferStatus :status="row.status" :entry-kind="row.entry_kind" /></template></ElTableColumn>
                  <ElTableColumn label="接收人 / 时间" min-width="150"><template #default="{ row }">{{ row.received_by || '—' }}<small class="cell-secondary">{{ formatDateTime(row.received_at) }}</small></template></ElTableColumn>
                  <ElTableColumn label="操作" width="100" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="openDetail(asTransfer(row))">查看入库单</ElButton></template></ElTableColumn>
                </ElTable>
                <ElTable v-else-if="tab === 'outgoing'" :data="outgoing" class="business-table team-table dispatch-table" row-key="dispatch_no">
                  <ElTableColumn label="批次条形码" min-width="390"><template #default="{ row }"><BarcodeCard :value="row.barcode_payload || row.dispatch_no" entity-label="整批出库" compact /></template></ElTableColumn>
                  <ElTableColumn label="方式 / 下序" min-width="140"><template #default="{ row }">{{ materialEntryLabel(row.entry_kind) }}<small class="cell-secondary">{{ isExternalEntryKind(row.entry_kind) ? row.external_destination || row.next_team.name : teamWorkspaceProfile(row.next_team.code)?.name || row.next_team.name }}</small></template></ElTableColumn>
                  <ElTableColumn label="明细" width="65"><template #default="{ row }">{{ row.line_count }} 条<ElTag v-if="row.items.some((item: MaterialTransfer) => item.status !== 'voided' && item.urgency?.urgent)" type="danger" size="small">含加急</ElTag></template></ElTableColumn>
                  <ElTableColumn label="数量 / 重量" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.total_quantity" :weight="row.total_weight" /></template></ElTableColumn>
                  <ElTableColumn label="状态" width="120"><template #default="{ row }"><ElTag :type="['received', 'dispatched'].includes(row.status) ? 'success' : row.status === 'voided' ? 'info' : 'warning'" size="small">{{ dispatchStatusLabel(row.status, row.entry_kind) }}</ElTag></template></ElTableColumn>
                  <ElTableColumn label="登记人 / 时间" min-width="150"><template #default="{ row }">{{ row.created_by || '—' }}<small class="cell-secondary">{{ formatDateTime(row.created_at) }}</small></template></ElTableColumn>
                  <ElTableColumn label="操作" width="110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="isDispatchNumber(row.dispatch_no) ? openDispatch(row.dispatch_no) : openDetail(row.items[0])">查看整批</ElButton></template></ElTableColumn>
                </ElTable>
                <ElTable v-else :data="losses" class="business-table team-table" row-key="id">
                  <ElTableColumn label="丢失记录 / 来源" min-width="220"><template #default="{ row }">{{ row.loss_no }}<button class="batch-link cell-secondary" @click="openLossSource(asLoss(row))">{{ row.batch_no }}</button></template></ElTableColumn>
                  <ElTableColumn label="材质 / 流水号" min-width="150"><template #default="{ row }">{{ row.material_name || '—' }}<small class="cell-secondary">{{ row.serial_no }}<SerialUrgencyBadge :urgency="row.urgency" /></small></template></ElTableColumn>
                  <ElTableColumn label="数量 / 重量" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.quantity" :weight="row.weight" /></template></ElTableColumn>
                  <ElTableColumn prop="reason" class-name="table-prose" label="原因" min-width="200" show-overflow-tooltip />
                  <ElTableColumn label="登记人 / 时间" min-width="150"><template #default="{ row }">{{ row.created_by || '—' }}<small class="cell-secondary">{{ formatDateTime(row.created_at) }}</small></template></ElTableColumn>
                </ElTable>
              </div>
              <footer v-if="!loading && !loadError" class="table-footer"><span>共 {{ total }} 条记录</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="total" layout="sizes, prev, pager, next" @current-change="applyFilters($event)" @size-change="applyFilters(1, $event)" /></footer>
            </section>
            <MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="selectedDispatchNo" :docked="docked" @changed="loadView" />
            <MaterialTransferDrawer v-model="drawerOpen" :transfer="selected" :batch-no="selectedBatchNo" :docked="docked" :trace-scope="traceScope" @changed="loadView" />
          </div>
        </template>
      </template>
    </div>
    <template #dialogs><StockSourcePicker v-if="pickerOpen && canWrite" :team-id="teamId" @close="closeDetails" @selected="openAction('dispatch', $event)" /><WarehouseReceiptDialog v-model="receiptOpen" :team-id="teamId" @saved="savedReceipt" /><MaterialStockActionDialog v-model="actionOpen" :team-id="teamId" :mode="actionMode" :sources="actionSources" @saved="savedAction" @balances-changed="loadView" /><MaterialDispatchDrawer v-if="['overview', 'stock', 'materials'].includes(tab)" v-model="groupOpen" :dispatch-no="selectedDispatchNo" @changed="loadView" /></template>
  </TeamWorkspaceShell>
</template>

<style scoped>
.team-material-content { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; gap: 10px; }
.legacy-notice { flex-shrink: 0; }
.legacy-notice a { color: var(--primary); }
.team-list-layout { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); min-width: 0; min-height: 0; gap: 12px; }
.team-list-layout--detail { grid-template-columns: minmax(0, 1fr) 900px; }
.team-list-panel { container-type: inline-size; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #fff; overflow: hidden; }
.list-toolbar, .scanner-error, .table-footer { flex-shrink: 0; }
.list-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 0; }
.list-toolbar > .el-input { flex: 1 1 220px; max-width: 380px; }
.list-toolbar > .el-select { width: 145px; }
.list-toolbar--pending { flex-wrap: nowrap; }
.list-toolbar--pending > .el-input { flex: 1 1 180px; min-width: 160px; max-width: 240px; }
.list-toolbar--pending > .el-button { margin-left: 0; }
.list-toolbar--pending :deep(.record-date-trigger) { max-width: 280px; }
.list-toolbar--pending :deep(.record-date-trigger > span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scanner-inline { display: flex; align-items: center; flex: 1 1 280px; min-width: 250px; max-width: 360px; gap: 8px; }
.scanner-inline > .el-input { flex: 1; min-width: 130px; }
.scanner-error { margin: 0 12px 8px; font-size: 12px; color: var(--danger); }
.team-table-scroll { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.team-table :deep(.el-checkbox) { height: 24px; }
.team-table :deep(.material-amount) { gap: 4px 10px; white-space: nowrap; }
.cell-secondary { display: block; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--workspace-muted, var(--subtle)); font-size: var(--workspace-meta-size, 14px); line-height: 22px; }
.batch-link { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: transparent; color: var(--workspace-ink, #303133); font: inherit; font-size: var(--workspace-body-size, 16px); font-weight: 400; line-height: 24px; text-align: left; cursor: pointer; }
.batch-link:hover { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
.batch-link.cell-secondary { font-size: var(--workspace-meta-size, 14px); }
.row-actions { display: flex; align-items: center; gap: 10px; }
.row-actions .el-button + .el-button { margin-left: 0; }
.table-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--line); }
.table-footer > span { color: var(--subtle); font-size: 12px; }
@container (max-width: 1040px) { .list-toolbar--pending { flex-wrap: wrap; }.scanner-inline { max-width: none; } }
@media (max-width: 760px) { .list-toolbar > .el-input { flex-basis: 100%; max-width: none; }.list-toolbar--pending > .el-input { flex: 1 1 160px; }.list-toolbar > .el-select { flex: 1; min-width: 120px; }.table-footer { padding: 8px; overflow-x: auto; } }
</style>

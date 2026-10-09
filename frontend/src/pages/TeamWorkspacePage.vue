<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { Filter, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElCheckbox, ElInput, ElOption, ElPagination, ElPopover, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import SerialUrgencyBadge from '@/components/SerialUrgencyBadge.vue'
import type { CalendarRange } from '@/types/recordFilters'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamWorkspaceActions from '@/components/TeamWorkspaceActions.vue'
import StockSourcePicker from '@/components/StockSourcePicker.vue'
import TeamMaterialOverviewPanel from '@/components/TeamMaterialOverview.vue'
import TeamInventory from '@/components/TeamInventory.vue'
import TeamSerialHistory from '@/components/TeamSerialHistory.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import { inventoryAmount } from '@/types/teamInventory'
import MaterialStockActionDialog from '@/components/MaterialStockActionDialog.vue'
import WarehouseManagement from '@/components/WarehouseManagement.vue'
import WarehouseReceiptDialog from '@/components/WarehouseReceiptDialog.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialReceiptScanner from '@/components/MaterialReceiptScanner.vue'
import MaterialBatchPrintDialog from '@/components/MaterialBatchPrintDialog.vue'
import BarcodeCard from '@/components/BarcodeCard.vue'
import MaterialTransferStatus from '@/components/MaterialTransferStatus.vue'
import StatePanel from '@/components/StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { showToast } from '@/stores/toast'
import { resolveTeamWorkspaceSection, teamWorkspaceProfile, teamWorkspaceSectionPath, type TeamWorkspaceSection } from '@/config/teamWorkspaces'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import { shouldRefreshInventory, subscribeSharedInventoryChanges as subscribeInventoryChanges } from '@/services/inventoryChanges'
import { materialTransferApi } from '@/services/materialTransferApi'
import { isExternalEntryKind, materialEntryLabel, materialSourceLabel, materialPurposeLabel, receiptSourceLabel, materialTypeOptions, materialTypeLabel, type MaterialTransfer, type MaterialType } from '@/types/materialTransfer'
import { dispatchStatusLabels, type DispatchKind, type DispatchStatus, type TeamMaterialOverview, type StockBatch, type CreatedMaterialBatches, type MaterialLoss } from '@/types/teamMaterials'
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
const canManageWarehouse = computed(() => isWarehouse.value && (auth.isAdmin || canWrite.value))
const canReceive = computed(() => isWarehouse.value && canWrite.value && auth.currentUser?.active !== false)
const title = computed(() => scopeReady.value ? profile.value?.name || team.value!.name : '班组工作台')
const queryText = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const tab = computed(() => resolveTeamWorkspaceSection(route.query, isWarehouse.value, canManageWarehouse.value))
function selectSection(section: TeamWorkspaceSection) {
  if (section !== tab.value) void router.push(teamWorkspaceSectionPath(teamKey.value, section))
}
function paginateSummary(nextPage: number, size: number) {
  void router.replace({ path: route.path, query: { tab: tab.value, ...(nextPage > 1 ? { page: String(nextPage) } : {}), ...(size !== 10 ? { page_size: String(size) } : {}) } })
}
function openSummaryDetail(value: string) {
  void router.push({ path: route.path, query: { tab: 'stock', availability: 'all', [tab.value === 'material-types' ? 'material_type' : 'material_name']: value,
    summary: tab.value, ...(page.value > 1 ? { summary_page: String(page.value) } : {}), ...(pageSize.value !== 10 ? { summary_page_size: String(pageSize.value) } : {}) } })
}
watch(() => queryText('tab'), value => {
  if (value === 'serials') void router.replace({ path: route.path, query: { ...route.query, tab: 'stock' }, hash: route.hash })
  if (value === 'overview') void router.replace({ path: route.path, query: { ...route.query, tab: 'history' }, hash: route.hash })
}, { immediate: true })
const page = computed(() => Number.isSafeInteger(Number(queryText('page'))) && Number(queryText('page')) > 0 ? Number(queryText('page')) : 1)
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(queryText('page_size'))) ? Number(queryText('page_size')) : 10)
const queryDraft = ref('')
const dateDraft = ref<CalendarRange>({ from: '', to: '' }), urgentDraft = ref(false)
const materialDraft = ref<MaterialType | ''>('')
const receiptSourceDraft = ref<'external' | 'internal' | 'return' | ''>('')
const batchStatusLabels = { pending: '转出待确认', received: '已签收', dispatched: dispatchStatusLabels.dispatched, voided: dispatchStatusLabels.voided }
type BatchStatus = Exclude<DispatchStatus, 'partial'>
const statusDraft = ref<BatchStatus | ''>('')
const nextTeamDraft = ref<string | number>('')
const kindDraft = ref<DispatchKind | ''>('')
const dispatchKinds = ['transfer', 'warehouse_outbound', 'inspection_shipment'] as const
const listTitle = computed(() => ({ pending: '来料待签收', receipts: '入库记录', outgoing: '出库记录', losses: '丢失记录' })[tab.value as 'pending' | 'receipts' | 'outgoing' | 'losses'])
const listFiltersOpen = ref(false)
watch(tab, () => { listFiltersOpen.value = false })
const activeListFilters = computed(() => [
  { key: 'material_type', label: materialTypeLabel(queryText('material_type') as MaterialType) },
  { key: 'receipt_source', label: ({ external: '外部来料（含退回）', internal: '车间转入', return: '外部退回' } as Record<string, string>)[queryText('receipt_source')] },
  { key: 'entry_kind', label: materialEntryLabel(dispatchKinds.find(kind => kind === queryText('entry_kind'))) },
  { key: 'status', label: batchStatusLabels[queryText('status') as BatchStatus] },
  { key: 'next_team_id', label: directory.items.find(item => String(item.id) === queryText('next_team_id'))?.name },
  ...(['receipts', 'outgoing'].includes(tab.value) ? [{ key: 'urgent_only', label: '仅看加急' }] : []),
].filter(item => queryText(item.key) && (item.key !== 'urgent_only' || queryText(item.key) === 'true')))
function removeListFilter(key: string) {
  const query = { ...route.query }; delete query[key]; delete query.page
  void router.replace({ path: route.path, query })
}
function resetListFilters() {
  queryDraft.value = ''; dateDraft.value = { from: '', to: '' }; urgentDraft.value = false
  materialDraft.value = ''; receiptSourceDraft.value = ''; kindDraft.value = ''; statusDraft.value = ''; nextTeamDraft.value = ''
  applyFilters()
}
const overview = ref<TeamMaterialOverview | null>(null)
const pendingCount = computed(() => scopeReady.value && overview.value && Number(overview.value.team_id) === teamId.value ? (isWarehouse.value ? overview.value.pending_incoming.batch_count ?? overview.value.pending_incoming.count : overview.value.pending_incoming.count) : null)
const overviewError = ref('')
const pending = ref<MaterialTransfer[]>([])
const outgoing = ref<MaterialTransfer[]>([])
const selectedPrintRows = ref<MaterialTransfer[]>([])
const printRows = ref<MaterialTransfer[]>([]), printOpen = ref(false)
function openPrint(items: MaterialTransfer[]) { printRows.value = [...items]; printOpen.value = true }
const losses = ref<MaterialLoss[]>([])
const receipts = ref<MaterialTransfer[]>([])
const receiptOpen = ref(false)
const businessOpen = ref(false)
function businessChanged() { void directory.refreshTeamDirectory(); void loadView() }
async function openingStocked() {
  const alreadyInStock = tab.value === 'stock'
  businessOpen.value = false
  await router.replace(teamWorkspaceSectionPath(teamKey.value, 'stock'))
  if (alreadyInStock) await loadView()
}
const openingReceipt = ref(false)
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const selected = ref<MaterialTransfer | null>(null)
const drawerOpen = ref(false)
const actionOpen = ref(false)
const pickerOpen = ref(false)
const openingDispatch = ref(false)
const actionMode = ref<'dispatch' | 'loss'>('dispatch')
const actionSources = ref<StockBatch[]>([])
const scanner = ref<InstanceType<typeof MaterialReceiptScanner>>()
const traceScope = computed(() => ({ team_id: teamId.value, direction: 'all' as const }))
const actionBindings = computed(() => ({ canWrite: canWrite.value, canReceive: canReceive.value, openingReceipt: openingReceipt.value, openingDispatch: openingDispatch.value, loading: loading.value, warehouse: isWarehouse.value, showScan: canWrite.value && tab.value !== 'pending', onDispatch: openNewDispatch, onReceipt: openReceipt, onScan: focusScan, onRefresh: loadView }))
let version = 0
let actionVersion = 0
const syncState = ref<InventoryConnection>('connecting'), syncError = ref('')
let unsubscribe: (() => void) | undefined, streamVersion = 0
let refreshQueued = false, refreshing = false, disposed = false
let identityQueued = false, directoryQueued = false
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
    const refreshIdentity = identityQueued, refreshDirectory = directoryQueued
    identityQueued = false; directoryQueued = false
    try {
      await Promise.all([
        ...(refreshIdentity ? [auth.refreshCurrentUser()] : []),
        ...(refreshDirectory ? [directory.refreshTeamDirectory()] : []),
      ])
      if (!disposed && !document.hidden && scope === teamKey.value && scopeReady.value) await loadView(false, true)
    } catch { if (!disposed) { identityQueued ||= refreshIdentity; directoryQueued ||= refreshDirectory; syncError.value = '数据更新失败，保留上次结果，请刷新重试。' } }
    finally { refreshing = false; if (refreshQueued) queueRefresh() }
  }, 100)
}
function connectChanges() {
  const current = ++streamVersion
  unsubscribe?.()
  unsubscribe = subscribeInventoryChanges({
    onData(change) {
      if (current !== streamVersion || !shouldRefreshInventory(change, teamId.value)) return
      identityQueued ||= change.team_ids === undefined || Boolean(change.current_user_changed)
      directoryQueued ||= change.team_ids === undefined || Boolean(change.directory_changed)
      queueRefresh()
    },
    onState(state) { if (current === streamVersion) syncState.value = state },
  })
}
function syncVisibility() {
  if (document.hidden) { ++streamVersion; unsubscribe?.(); unsubscribe = undefined; clearTimeout(refreshTimer); refreshTimer = undefined; refreshQueued = false; identityQueued = directoryQueued = false }
  else connectChanges()
}
watch(loading, value => { if (!value && refreshQueued) queueRefresh() })

function asTransfer(row: unknown) { return row as MaterialTransfer }
function asLoss(row: unknown) { return row as MaterialLoss }

function applyFilters(nextPage = 1, size = pageSize.value) {
  void router.replace({ path: route.path, query: { tab: tab.value, ...(tab.value === 'receipts' && receiptSourceDraft.value ? { receipt_source: receiptSourceDraft.value } : {}), ...(dateDraft.value.from ? { date_from: dateDraft.value.from } : {}), ...(dateDraft.value.to ? { date_to: dateDraft.value.to } : {}), ...(urgentDraft.value ? { urgent_only: 'true' } : {}), ...(queryDraft.value.trim() ? { query: queryDraft.value.trim() } : {}), ...(['receipts', 'outgoing'].includes(tab.value) && materialDraft.value ? { material_type: materialDraft.value } : {}), ...(tab.value === 'outgoing' ? { ...(kindDraft.value ? { entry_kind: kindDraft.value } : {}), ...(statusDraft.value ? { status: statusDraft.value } : {}), ...(!isExternalEntryKind(kindDraft.value) && nextTeamDraft.value ? { next_team_id: String(nextTeamDraft.value) } : {}) } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}), ...(size !== 10 ? { page_size: String(size) } : {}) } })
}
function closeDetails() { ++actionVersion; pickerOpen.value = false; openingDispatch.value = false; drawerOpen.value = false; selected.value = null; actionOpen.value = false; receiptOpen.value = false; actionSources.value = [] }
function openDetail(transfer: MaterialTransfer) { selected.value = transfer; drawerOpen.value = true }
function openIncoming(transfer: MaterialTransfer) { openDetail(transfer) }
function openWarehouseMaterial(batchNo: string) { selected.value = null; selectedBatchNo.value = batchNo; drawerOpen.value = true }
async function dispatchWarehouseMaterial(batchNo: string) {
  if (!canWrite.value || !isWarehouse.value) return
  const scope = teamKey.value, current = ++actionVersion
  try {
    const result = await teamMaterialApi.stock(teamId.value, { query: batchNo, availability: 'dispatchable', page_size: 100 })
    if (current !== actionVersion || scope !== teamKey.value) return
    const source = result.items.find(item => item.transfer.batch_no === batchNo)
    if (!source) { showToast('该批物料暂无可转出库存，请刷新查看', 'error'); return }
    await openAction('dispatch', [source])
  } catch (e) { showToast(e instanceof Error ? e.message : '读取库存失败', 'error') }
}
async function dispatchWarehouseBatches(sourceIds: number[]) {
  if (!canWrite.value || !isWarehouse.value || openingDispatch.value || !sourceIds.length) return
  const scope = teamKey.value, current = ++actionVersion
  openingDispatch.value = true
  try {
    const ids = [...new Set(sourceIds)]
    const result = await teamMaterialApi.stock(teamId.value, { source_ids: ids.join(','), availability: 'dispatchable', page_size: 100 })
    if (current !== actionVersion || scope !== teamKey.value) return
    const sources = ids.map(id => result.items.find(item => Number(item.transfer.id) === id))
    if (sources.some(item => !item)) { showToast('部分物料已转出或库存已变化，请刷新后重新勾选', 'error'); void loadView(); return }
    await openAction('dispatch', sources as StockBatch[])
  } catch (e) { if (current === actionVersion && scope === teamKey.value) showToast(e instanceof Error ? e.message : '读取库存失败', 'error') }
  finally { if (scope === teamKey.value) openingDispatch.value = false }
}
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
function savedAction(result: CreatedMaterialBatches | MaterialLoss) {
  const first = 'items' in result ? result.items[0] : undefined
  showToast(first && isExternalEntryKind(first.entry_kind) && first.status === 'dispatched'
    ? `已完成${first.entry_kind === 'inspection_shipment' ? '发货' : '出库'}`
    : 'items' in result ? `已生成 ${result.items.length} 个独立批次，每批一个条码` : `丢失记录 ${result.loss_no} 已登记`, 'success')
  void loadView()
  if ('items' in result) openPrint(result.items)
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
  showToast(`入库单 ${transfer.batch_no} 已入库`, 'success')
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
  const dispatchStatus = Object.keys(batchStatusLabels).includes(queryText('status')) ? queryText('status') as BatchStatus : undefined
  const balanceRequest = teamMaterialApi.overview(id).then(result => { if (current === version) { overview.value = result; overviewError.value = '' } }).catch(error => { if (current === version) { if (background) syncError.value = '数据更新失败，保留上次结果，请刷新重试。'; else { overview.value = null; overviewError.value = error instanceof Error ? error.message : '物料纵览加载失败' } } })
  const refreshRequests = refreshWarehouse === true && isWarehouse.value ? [
    ...(currentTab !== 'receipts' ? [teamMaterialApi.receipts(id, { page: 1, page_size: 20 }).then(result => { if (current === version) receipts.value = result.items })] : []),
  ].map(request => request.catch(() => { if (current === version) showToast('入库已成功，部分物料记录刷新失败，请点击刷新', 'error') })) : []
  try {
    if (currentTab === 'pending') { const result = await materialTransferApi.list({ ...params, team_id: id, direction: 'incoming', status: 'pending' }); if (current === version) { pending.value = result.items; total.value = result.total } }
    else if (currentTab === 'outgoing') { const result = await teamMaterialApi.dispatches(id, { ...params, material_type: materialType, next_team_id: isExternalEntryKind(queryText('entry_kind')) ? undefined : queryText('next_team_id') || undefined, status: dispatchStatus, entry_kind: dispatchKinds.find(kind => kind === queryText('entry_kind')) }); if (current === version) { outgoing.value = result.items; selectedPrintRows.value = []; total.value = result.total } }
    else if (currentTab === 'losses') { const result = await teamMaterialApi.losses(id, params); if (current === version) { losses.value = result.items; total.value = result.total } }
    else if (currentTab === 'receipts') { const result = await teamMaterialApi.receipts(id, { ...params, material_type: materialType, receipt_source: receiptSourceDraft.value || undefined }); if (current === version) { receipts.value = result.items; total.value = result.total } }
    if (current === version) loadError.value = ''
  } catch (error) { if (current === version) { if (background) syncError.value = '数据更新失败，保留上次结果，请刷新重试。'; else { pending.value = []; outgoing.value = []; losses.value = []; receipts.value = []; total.value = 0; loadError.value = error instanceof Error ? error.message : '物料记录加载失败' } } }
  await Promise.all([balanceRequest, ...refreshRequests])
  if (current === version) loading.value = false
}

watch([() => ['overview', 'stock', 'materials', 'material-types'].includes(tab.value) ? `${route.path}:${tab.value}` : route.fullPath, scopeReady], () => {
  businessOpen.value = false
  closeDetails(); pending.value = []; outgoing.value = []; selectedPrintRows.value = []; printOpen.value = false; losses.value = []; receipts.value = []; overview.value = null
  dateDraft.value = { from: queryText('date_from'), to: queryText('date_to') }; urgentDraft.value = queryText('urgent_only') === 'true'
  receiptSourceDraft.value = ['external', 'internal', 'return'].includes(queryText('receipt_source')) ? queryText('receipt_source') as 'external' | 'internal' | 'return' : ''
  queryDraft.value = queryText('query'); materialDraft.value = materialTypeOptions.find(option => option.value === queryText('material_type'))?.value || ''; statusDraft.value = Object.keys(batchStatusLabels).includes(queryText('status')) ? queryText('status') as BatchStatus : ''; nextTeamDraft.value = queryText('next_team_id'); kindDraft.value = dispatchKinds.find(kind => kind === queryText('entry_kind')) || ''
  void loadView()
}, { immediate: true })
watch(() => `${auth.currentUser?.id ?? ''}:${auth.currentUser?.team_id ?? ''}:${auth.currentUser?.active}:${auth.isTeamAccount}`, () => { closeDetails(); void loadView() })

async function focusScan() { if (tab.value !== 'pending') await router.replace({ path: route.path, query: { tab: 'pending' } }); await nextTick(); scanner.value?.focus() }
onMounted(() => {
  if (!directory.loaded && !directory.loading) void directory.refreshTeamDirectory()
  document.addEventListener('visibilitychange', syncVisibility)
  if (!document.hidden) connectChanges()
})
onBeforeUnmount(() => { disposed = true; ++streamVersion; unsubscribe?.(); clearTimeout(refreshTimer); ++version; ++actionVersion; document.removeEventListener('visibilitychange', syncVisibility) })
</script>

<template>
  <TeamWorkspaceShell :title="title" :model-value="tab" :warehouse="isWarehouse" :manage-warehouse="canManageWarehouse" :pending-count="pendingCount" @update:model-value="selectSection">
    <template v-if="canWrite" #settings><ElButton :icon="Setting" text aria-label="班组设置" @click="businessOpen = true">班组设置</ElButton></template>
    <div class="team-material-content">
      <ElAlert v-if="syncError || syncState === 'reconnecting' || syncState === 'expired'" type="warning" :closable="false" :title="syncState === 'expired' ? '登录或访问凭证已失效，请重新验证。' : syncError || '实时连接中断，当前显示上次结果，正在重连。'" />
      <StatePanel v-if="scopeLoading" state="loading" title="正在读取班组信息" />
      <StatePanel v-else-if="!scopeReady" state="error" :title="!validId ? '无效的班组编号' : directory.error ? '班组目录加载失败' : '未找到启用的班组'" description="请刷新班组目录，或从侧边栏选择已配置的班组。" @retry="directory.refreshTeamDirectory" />
      <template v-else>
        <ElAlert v-if="overview?.legacy_received_count" class="legacy-notice" type="info" :closable="false" :title="`另有 ${overview.legacy_received_count} 张历史已接收单未计入库存。`"><template #default>历史单据仍可在 <RouterLink :to="{ path: '/transfer-batches', query: { next_team_id: teamKey, status: 'received' } }">全局转料记录</RouterLink> 查看。</template></ElAlert>
        <WarehouseManagement v-if="tab === 'warehouse'" :key="teamId" :team-id="teamId" :can-manage="canManageWarehouse" :can-dispatch="canWrite" :refresh-key="overview" @view="openWarehouseMaterial" @dispatch="dispatchWarehouseMaterial" @batch-dispatch="dispatchWarehouseBatches" />
        <TeamSerialHistory v-else-if="['overview', 'history'].includes(tab)" :key="teamId" :team-id="teamId"><template #actions><TeamWorkspaceActions v-bind="actionBindings" /></template></TeamSerialHistory>
        <template v-else-if="['stock', 'materials', 'material-types'].includes(tab)">
          <StatePanel v-if="loading && !overview" state="loading" title="正在读取物料库存" />
          <StatePanel v-else-if="overviewError" state="error" :description="overviewError" @retry="loadView" />
          <TeamInventory v-else-if="overview && tab === 'stock'" :key="teamId" :team-id="teamId" :warehouse="isWarehouse" :overview="overview" :can-write="canWrite" @refresh="loadView" @changed="loadView" @action="openAction"><template #actions><TeamWorkspaceActions v-bind="actionBindings" :show-refresh="false" /></template></TeamInventory>
          <TeamMaterialOverviewPanel v-else-if="overview" :key="tab" :overview="overview" :kind="tab === 'material-types' ? 'type' : 'material'" :page="page" :page-size="pageSize" @filter="openSummaryDetail" @paginate="paginateSummary"><template #actions><TeamWorkspaceActions v-bind="actionBindings" /></template></TeamMaterialOverviewPanel>
        </template>
        <template v-else>
          <div class="team-list-layout">
            <section class="team-list-panel">
              <header class="list-heading">
                <div class="list-heading__title"><h2>{{ listTitle }}</h2><span v-if="!loading && !loadError">{{ total }} 条记录</span></div>
                <div class="list-heading__actions">
                  <ElButton v-if="tab === 'outgoing'" :disabled="!selectedPrintRows.length" @click="openPrint(selectedPrintRows)">合并打印<span v-if="selectedPrintRows.length">（{{ selectedPrintRows.length }}）</span></ElButton>
                  <TeamWorkspaceActions v-bind="actionBindings" :show-refresh="false" />
                </div>
              </header>
              <div class="list-toolbar">
                <ElInput v-model="queryDraft" :prefix-icon="Search" :aria-label="`${tab === 'losses' ? '丢失记录' : '物料'}搜索`" clearable :placeholder="tab === 'outgoing' ? '搜索批次、流水号、业务或去向' : tab === 'losses' ? '搜索批次、流水号或材质' : '搜索批次、流水号、材质或业务'" @keyup.enter="applyFilters()" @clear="applyFilters()" />
                <div class="list-filter-controls">
                  <RecordDateFilter v-model="dateDraft" :label="tab === 'receipts' ? '入库日期' : '登记日期'" @update:model-value="applyFilters()" />
                  <ElPopover v-if="['receipts', 'outgoing'].includes(tab)" v-model:visible="listFiltersOpen" role="dialog" aria-label="记录筛选" trigger="click" placement="bottom-start" :width="320" popper-class="workspace-record-filters" :popper-options="{ modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 12 } }] }">
                    <template #reference><ElButton :icon="Filter" :aria-expanded="listFiltersOpen">筛选<span v-if="activeListFilters.length" class="list-filter-count">{{ activeListFilters.length }}</span></ElButton></template>
                    <div class="list-extra-filters">
                      <label>物料类型<ElSelect v-model="materialDraft" aria-label="物料类型筛选" placeholder="全部类型" clearable @change="applyFilters()"><ElOption v-for="type in materialTypeOptions" :key="type.value" :value="type.value" :label="type.label" /></ElSelect></label>
                      <label v-if="tab === 'receipts' && isWarehouse">入库来源<ElSelect v-model="receiptSourceDraft" aria-label="入库来源筛选" placeholder="全部来源" clearable @change="applyFilters()"><ElOption value="external" label="外部来料（含退回）" /><ElOption value="internal" label="车间转入" /><ElOption value="return" label="外部退回" /></ElSelect></label>
                      <template v-if="tab === 'outgoing'">
                        <label>出库方式<ElSelect v-model="kindDraft" aria-label="出库方式筛选" placeholder="全部方式" clearable @change="applyFilters()"><ElOption v-for="kind in dispatchKinds" :key="kind" :value="kind" :label="materialEntryLabel(kind)" /></ElSelect></label>
                        <label>出库状态<ElSelect v-model="statusDraft" aria-label="出库状态筛选" placeholder="全部状态" clearable @change="applyFilters()"><ElOption v-for="(label, value) in batchStatusLabels" :key="value" :value="value" :label="label" /></ElSelect></label>
                        <label v-if="!isExternalEntryKind(kindDraft)">接收班组<ElSelect v-model="nextTeamDraft" aria-label="接收班组筛选" placeholder="全部接收班组" clearable filterable @change="applyFilters()"><ElOption v-for="item in directory.items.filter(item => item.active && String(item.id) !== teamKey)" :key="item.id" :value="String(item.id)" :label="teamWorkspaceProfile(item.code)?.name || item.name" /></ElSelect></label>
                      </template>
                      <ElCheckbox v-model="urgentDraft" @change="applyFilters()">仅看加急</ElCheckbox>
                    </div>
                  </ElPopover>
                </div>
                <ElCheckbox v-if="!['receipts', 'outgoing'].includes(tab)" v-model="urgentDraft" @change="applyFilters()">仅看加急</ElCheckbox>
                <div class="list-query-actions"><ElButton type="primary" @click="applyFilters()">查询</ElButton><ElButton text @click="resetListFilters">重置</ElButton></div>
                <ElButton class="list-refresh" :icon="Refresh" :loading="loading" text aria-label="刷新工作台" title="刷新" @click="loadView()" />
              </div>
              <div v-if="activeListFilters.length" class="list-active-filters"><ElTag v-for="filter in activeListFilters" :key="filter.key" closable @close="removeListFilter(filter.key)">{{ filter.label || queryText(filter.key) }}</ElTag></div>
              <MaterialReceiptScanner v-if="tab === 'pending' && canWrite" :key="teamId" ref="scanner" :team-id="teamId" :paused="drawerOpen || actionOpen || pickerOpen || receiptOpen || businessOpen || printOpen" @received="loadView(true, true)" />
              <StatePanel v-if="loading" state="loading" title="正在读取物料记录" />
              <StatePanel v-else-if="loadError" state="error" :description="loadError" @retry="loadView" />
              <StatePanel v-else-if="!total" state="empty" :title="tab === 'pending' ? '暂无来料待签收' : tab === 'outgoing' ? '暂无出库记录' : tab === 'receipts' ? '暂无入库记录' : '暂无丢失记录'" description="可以调整搜索条件或刷新记录。" />
              <div v-else class="team-table-scroll">
                <ElTable v-if="tab === 'pending'" :data="pending" class="business-table team-table single-line-table" row-key="id">
                  <ElTableColumn label="批次号" min-width="190" show-overflow-tooltip><template #default="{ row }"><button class="batch-link" :title="row.batch_no" @click="openIncoming(asTransfer(row))">{{ row.batch_no }}</button></template></ElTableColumn>
                  <ElTableColumn label="流水号" min-width="220" show-overflow-tooltip><template #default="{ row }"><span class="record-serial"><span :title="row.serial_no">{{ row.serial_no }}</span><SerialUrgencyBadge :urgency="row.urgency" /></span></template></ElTableColumn>
                  <ElTableColumn label="材质" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.material_name || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ materialTypeLabel(row.material_type) }}</template></ElTableColumn>
                  <ElTableColumn prop="purpose_name" label="接收业务" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ materialPurposeLabel(asTransfer(row)) }}</template></ElTableColumn>
                  <ElTableColumn label="件数" min-width="100" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template></ElTableColumn>
                  <ElTableColumn label="重量 (kg)" min-width="125" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.weight) }}</template></ElTableColumn>
                  <ElTableColumn label="上序" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.source_team.name }}</template></ElTableColumn>
                  <ElTableColumn label="转出人" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.transferred_by || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="转出时间" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.transferred_at) }}</template></ElTableColumn>
                  <ElTableColumn label="操作" width="110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="openIncoming(asTransfer(row))">{{ canWrite ? '核对接收' : '查看详情' }}</ElButton></template></ElTableColumn>
                </ElTable>
                <ElTable v-else-if="tab === 'receipts'" :data="receipts" class="business-table team-table single-line-table" row-key="id">
                  <ElTableColumn v-if="isWarehouse" prop="warehouse_location" label="仓位" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.warehouse_location || '未填写' }}</template></ElTableColumn>
                  <ElTableColumn label="批次号" min-width="190" show-overflow-tooltip><template #default="{ row }"><button class="batch-link" :title="row.batch_no" @click="openDetail(asTransfer(row))">{{ row.batch_no }}</button></template></ElTableColumn>
                  <ElTableColumn label="流水号" min-width="220" show-overflow-tooltip><template #default="{ row }"><span class="record-serial"><span :title="row.serial_no">{{ row.serial_no }}</span><SerialUrgencyBadge :urgency="row.urgency" /></span></template></ElTableColumn>
                  <ElTableColumn label="入库时间" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.received_at) }}</template></ElTableColumn>
                  <ElTableColumn v-if="isWarehouse" label="来源类别" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ receiptSourceLabel(asTransfer(row)) }}</template></ElTableColumn>
                  <ElTableColumn label="来源" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ materialSourceLabel(asTransfer(row)) }}</template></ElTableColumn>
                  <ElTableColumn label="材质" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.material_name || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ materialTypeLabel(row.material_type) }}</template></ElTableColumn>
                  <ElTableColumn prop="purpose_name" label="接收业务" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ materialPurposeLabel(asTransfer(row)) }}</template></ElTableColumn>
                  <ElTableColumn label="件数" min-width="100" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template></ElTableColumn>
                  <ElTableColumn label="重量 (kg)" min-width="125" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.weight) }}</template></ElTableColumn>
                  <ElTableColumn label="状态" width="120"><template #default="{ row }"><MaterialTransferStatus :status="row.status" :entry-kind="row.entry_kind" /></template></ElTableColumn>
                  <ElTableColumn label="接收人" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.received_by || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="操作" width="100" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="openDetail(asTransfer(row))">查看入库单</ElButton></template></ElTableColumn>
                </ElTable>
                <ElTable v-else-if="tab === 'outgoing'" :data="outgoing" class="business-table team-table dispatch-table single-line-table" row-key="batch_no" @selection-change="selectedPrintRows = $event">
                  <ElTableColumn type="selection" width="48" />
                  <ElTableColumn label="批次号" min-width="190"><template #default="{ row }"><ElPopover :trigger="['hover', 'focus']" placement="top" :width="320" :show-after="180"><template #reference><button class="batch-link" :title="row.batch_no" :aria-label="`${row.batch_no}，悬停查看条码，点击查看详情`" @click="openDetail(asTransfer(row))">{{ row.batch_no }}</button></template><BarcodeCard :value="row.batch_no" entity-label="批次号" compact /></ElPopover></template></ElTableColumn>
                  <ElTableColumn label="流水号" min-width="220" show-overflow-tooltip><template #default="{ row }"><span class="record-serial"><span :title="row.serial_no">{{ row.serial_no }}</span><SerialUrgencyBadge :urgency="row.urgency" /></span></template></ElTableColumn>
                  <ElTableColumn label="材质" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.material_name || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ materialTypeLabel(row.material_type) }}</template></ElTableColumn>
                  <ElTableColumn label="出库方式" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ materialEntryLabel(row.entry_kind) }}</template></ElTableColumn>
                  <ElTableColumn label="下序 / 去向" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ isExternalEntryKind(row.entry_kind) ? row.external_destination || row.next_team.name : teamWorkspaceProfile(row.next_team.code)?.name || row.next_team.name }}</template></ElTableColumn>
                  <ElTableColumn prop="purpose_name" label="接收业务" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ materialPurposeLabel(asTransfer(row)) }}</template></ElTableColumn>
                  <ElTableColumn label="件数" min-width="100" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template></ElTableColumn>
                  <ElTableColumn label="重量 (kg)" min-width="125" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.weight) }}</template></ElTableColumn>
                  <ElTableColumn label="状态" width="120"><template #default="{ row }"><MaterialTransferStatus :status="row.status" :entry-kind="row.entry_kind" outgoing /></template></ElTableColumn>
                  <ElTableColumn label="登记人" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.transferred_by || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="登记时间" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.transferred_at) }}</template></ElTableColumn>
                  <ElTableColumn label="操作" width="110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="openDetail(asTransfer(row))">查看详情</ElButton></template></ElTableColumn>
                </ElTable>
                <ElTable v-else :data="losses" class="business-table team-table single-line-table" row-key="id">
                  <ElTableColumn prop="loss_no" label="丢失记录号" min-width="190" show-overflow-tooltip />
                  <ElTableColumn label="来源批次号" min-width="190" show-overflow-tooltip><template #default="{ row }"><button class="batch-link" :title="row.batch_no" @click="openLossSource(asLoss(row))">{{ row.batch_no }}</button></template></ElTableColumn>
                  <ElTableColumn label="流水号" min-width="220" show-overflow-tooltip><template #default="{ row }"><span class="record-serial"><span :title="row.serial_no">{{ row.serial_no }}</span><SerialUrgencyBadge :urgency="row.urgency" /></span></template></ElTableColumn>
                  <ElTableColumn label="材质" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.material_name || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="件数" min-width="100" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template></ElTableColumn>
                  <ElTableColumn label="重量 (kg)" min-width="125" align="center" show-overflow-tooltip><template #default="{ row }">{{ inventoryAmount(row.weight) }}</template></ElTableColumn>
                  <ElTableColumn prop="reason" label="原因" min-width="200" show-overflow-tooltip />
                  <ElTableColumn label="登记人" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.created_by || '—' }}</template></ElTableColumn>
                  <ElTableColumn label="登记时间" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn>
                </ElTable>
              </div>
              <footer v-if="!loading && !loadError" class="table-footer"><span>共 {{ total }} 条记录</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="total" layout="sizes, prev, pager, next" @current-change="applyFilters($event)" @size-change="applyFilters(1, $event)" /></footer>
            </section>
            <MaterialTransferDrawer v-model="drawerOpen" :transfer="selected" :batch-no="selectedBatchNo" :trace-scope="traceScope" :allow-print="tab !== 'pending'" :receipt-only="tab === 'pending'" @changed="loadView" />
          </div>
        </template>
      </template>
    </div>
    <template #dialogs>
      <StockSourcePicker v-if="pickerOpen && canWrite" :team-id="teamId" @close="closeDetails" @selected="openAction('dispatch', $event)" @outbound="closeDetails(); router.push({ path: route.path, query: { tab: 'outgoing', status: 'pending' } })" />
      <WarehouseReceiptDialog v-model="receiptOpen" :team-id="teamId" @saved="savedReceipt" />
      <MaterialStockActionDialog v-model="actionOpen" :team-id="teamId" :mode="actionMode" :sources="actionSources" @saved="savedAction" @balances-changed="loadView" />
      <MaterialBatchPrintDialog v-model="printOpen" :items="printRows" />
      <TeamBusinessDialog v-if="businessOpen && canWrite" :key="teamId" v-model="businessOpen" :team-id="teamId" @changed="businessChanged" @stocked="openingStocked" />
    </template>
  </TeamWorkspaceShell>
</template>

<style scoped>
.team-material-content { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; gap: 10px; }
.legacy-notice { flex-shrink: 0; }
.legacy-notice a { color: var(--primary); }
.team-list-layout { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); min-width: 0; min-height: 0; gap: 12px; }
.team-list-panel { container-type: inline-size; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #fff; border: 1px solid var(--line); border-radius: var(--card-radius); overflow: hidden; }
.list-heading, .list-toolbar, .list-active-filters, .table-footer { flex-shrink: 0; }
.list-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; min-height: 68px; padding: 16px; border-bottom: 1px solid var(--line); }
.list-heading__title { display: flex; align-items: baseline; gap: 12px; }
.list-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.list-heading__title > span { color: var(--muted); font-size: 13px; }
.list-heading__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.list-heading__actions > .el-button { height: 36px; }
.list-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 14px 16px; }
.list-toolbar > .el-input { flex: 1 1 220px; min-width: 0; }
.list-filter-controls, .list-query-actions { display: flex; align-items: center; gap: 8px; }
.list-toolbar :deep(.record-date-trigger) { min-width: 0; max-width: 260px; }
.list-toolbar :deep(.record-date-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.list-toolbar > .list-refresh { margin-left: auto; width: 36px; padding: 0; }
.list-extra-filters { display: flex; flex-direction: column; gap: 14px; max-height: min(560px, 65dvh); overflow-y: auto; padding: 4px; }
.list-extra-filters > label:not(.el-checkbox) { display: flex; flex-direction: column; gap: 6px; color: var(--muted); font-size: 13px; }
:global(.workspace-record-filters) { max-width: calc(100vw - 32px); }
.list-filter-count { margin-left: 6px; color: var(--primary); font-variant-numeric: tabular-nums; }
.list-active-filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 12px; }
.list-active-filters :deep(.el-tag) { max-width: 100%; }
.list-active-filters :deep(.el-tag__content) { overflow: hidden; text-overflow: ellipsis; }
.team-table-scroll { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.team-table :deep(.el-checkbox) { height: 24px; }
.record-serial { display: flex; align-items: center; justify-content: center; min-width: 0; white-space: nowrap; }
.record-serial > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.record-serial :deep(.serial-urgency-badge) { flex-shrink: 0; }
.batch-link { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: transparent; color: var(--workspace-ink, #303133); font: inherit; font-size: var(--workspace-body-size, 16px); font-weight: 400; line-height: 24px; text-align: left; cursor: pointer; }
.batch-link:hover { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
.row-actions { display: flex; align-items: center; gap: 10px; }
.row-actions .el-button + .el-button { margin-left: 0; }
.table-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--line); }
.table-footer > span { color: var(--subtle); font-size: 12px; }
@container (max-width: 980px) { .list-toolbar > .el-input { flex-basis: 100%; } }
@container (max-width: 560px) {
  .list-heading__actions { width: 100%; }
  .list-heading__actions :deep(.workspace-actions) { margin-left: 0; justify-content: flex-start; }
  .list-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
  .list-toolbar > .el-input, .list-filter-controls { grid-column: 1 / -1; }
  .list-filter-controls :deep(.record-date-trigger) { flex: 1; max-width: none; }
  .list-toolbar > .el-checkbox { grid-column: 1 / -1; }
  .list-query-actions { grid-column: 1; }
  .list-toolbar > .list-refresh { grid-column: 2; }
}
@media (max-width: 760px) {
  .list-heading, .list-toolbar, .list-active-filters { padding-inline: 12px; }
  .table-footer { padding: 8px; overflow-x: auto; }
  .team-table :deep(.el-table-fixed-column--right) { position: relative !important; right: auto !important; }
  .team-table :deep(.el-table-fixed-column--right::before) { box-shadow: none; }
  .team-table :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
}
</style>

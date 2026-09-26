<script setup lang="ts">
import { FullScreen, ArrowDown, CircleCheck, Clock, Collection, Plus, Refresh, Remove, Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElCard,
  ElIcon,
  ElInput,
  ElLoading,
  ElOption,
  ElPagination,
  ElPopover,
  ElSelect,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  type InputInstance,
} from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { isDispatchNumber } from '@/types/teamMaterials'
import MaterialTransferStatus from '@/components/MaterialTransferStatus.vue'
import MaterialTransferFormDialog from '@/components/MaterialTransferFormDialog.vue'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import SerialUrgencyBadge from '@/components/SerialUrgencyBadge.vue'
import { ElCheckbox } from 'element-plus'
import StatePanel from '@/components/StatePanel.vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { MaterialTransferApiError, materialTransferApi } from '@/services/materialTransferApi'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import type { MaterialSearchField, MaterialSearchMode, MaterialType, MaterialTransfer, MaterialTransferFilterParams, MaterialTransferStatus as TransferStatusValue, MaterialTransferStatusCounts } from '@/types/materialTransfer'
import { isWarehouseReceipt, materialSearchFields, materialSearchModes, materialTypeLabel, materialTypeOptions } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const route = useRoute()
const vLoading = ElLoading.directive
const router = useRouter()
const authStore = useAuthStore()
const teamStore = useTeamDirectoryStore()
const rows = ref<MaterialTransfer[]>([])
const loading = ref(true)
const errorMessage = ref('')
const total = ref(0)
const statusCounts = ref<MaterialTransferStatusCounts | null>(null)
const countsLoading = ref(true)
const statusOptions = [
  { value: 'all', label: '全部', icon: Collection },
  { value: 'pending', label: '待确认', icon: Clock },
  { value: 'received', label: '已接收 / 入库', icon: CircleCheck },
  { value: 'dispatched', label: '已出库 / 发货', icon: CircleCheck },
  { value: 'voided', label: '已作废', icon: Remove },
] as const
let countsVersion = 0
function readRouteFilters() {
  const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  const requestedPage = Number(text('page'))
  return {
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10,
    query: text('query'),
    dateFrom: text('date_from'), dateTo: text('date_to'), urgentOnly: text('urgent_only') === 'true',
    status: statusOptions.find(option => option.value === text('status'))?.value ?? 'all',
    sourceTeamId: text('source_team_id'), nextTeamId: text('next_team_id'),
    searchMode: materialSearchModes.find(option => option.value === text('search_mode'))?.value ?? 'contains',
    searchField: materialSearchFields.find(option => option.value === text('search_field'))?.value ?? 'all',
    materialType: materialTypeOptions.find(option => option.value === text('material_type'))?.value ?? '' as const,
  }
}
const initialFilters = readRouteFilters()
const dateDraft = ref({ from: initialFilters.dateFrom, to: initialFilters.dateTo }), urgentDraft = ref(initialFilters.urgentOnly)
const dates = ref({ ...dateDraft.value }), urgentOnly = ref(urgentDraft.value)
const page = ref(initialFilters.page)
const pageSize = ref(initialFilters.pageSize)
const queryDraft = ref(initialFilters.query)
const statusDraft = ref<TransferStatusValue | 'all'>(initialFilters.status)
const sourceTeamDraft = ref<string | number>(initialFilters.sourceTeamId)
const nextTeamDraft = ref<string | number>(initialFilters.nextTeamId)
const searchModeDraft = ref<MaterialSearchMode>(initialFilters.searchMode)
const searchFieldDraft = ref<MaterialSearchField>(initialFilters.searchField)
const materialTypeDraft = ref<MaterialType | ''>(initialFilters.materialType)
const query = ref(queryDraft.value)
const status = ref(statusDraft.value)
const sourceTeamId = ref(sourceTeamDraft.value)
const nextTeamId = ref(nextTeamDraft.value)
const searchMode = ref(searchModeDraft.value)
const searchField = ref(searchFieldDraft.value)
const materialType = ref(materialTypeDraft.value)
const filterParams = computed<MaterialTransferFilterParams>(() => ({
  query: query.value || undefined,
  date_from: dates.value.from || undefined, date_to: dates.value.to || undefined, urgent_only: urgentOnly.value || undefined,
  search_mode: searchMode.value,
  search_field: searchField.value,
  material_type: materialType.value || undefined,
  source_team_id: sourceTeamId.value || undefined,
  next_team_id: nextTeamId.value || undefined,
}))
const searchPlaceholder = computed(() => searchFieldDraft.value !== 'all'
  ? `搜索${materialSearchFields.find(option => option.value === searchFieldDraft.value)?.label}`
  : searchModeDraft.value === 'contains' ? '搜索编号、材质、班组或转料人' : '搜索批次号、流水号、原单批号、编号、客户代码或材质')
const hasFilters = computed(() => Boolean(dateDraft.value.from || dateDraft.value.to || urgentDraft.value || queryDraft.value || sourceTeamDraft.value !== '' || nextTeamDraft.value !== '' || statusDraft.value !== 'all' || searchModeDraft.value !== 'contains' || searchFieldDraft.value !== 'all' || materialTypeDraft.value))
const scanInput = ref<InputInstance>()
const scanValue = ref('')
const scanPanelOpen = ref(false)
function focusScanner(): void { void nextTick(() => scanInput.value?.focus()) }
const scanning = ref(false)
const scanError = ref('')
const drawerOpen = ref(false)
const groupOpen = ref(false)
const selectedDispatchNo = ref('')
const anyDetailOpen = computed(() => drawerOpen.value || groupOpen.value)
const selected = ref<MaterialTransfer | null>(null)
const createOpen = ref(false)
let requestVersion = 0
let scanVersion = 0
let hidBuffer = ''
let hidLastKeyAt = 0
let disposed = false

const hasRows = computed(() => rows.value.length > 0)
const canCreate = computed(() => authStore.isTeamAccount && Boolean(authStore.currentUser?.team_id) && !authStore.currentUserError)
async function openCreate(): Promise<void> {
  try {
    await authStore.refreshCurrentUser()
    if (canCreate.value) createOpen.value = true
    else showToast('当前账号不能从此班组发出转料', 'error')
  } catch { showToast('账号信息刷新失败，请重试', 'error') }
}
watch(() => `${authStore.currentUser?.id ?? ''}:${authStore.currentUser?.team_id ?? ''}:${authStore.isTeamAccount}`, () => {
  clearWorkspace()
  void loadRows()
  void loadCounts()
})
const layoutElement = ref<HTMLElement>()
const workspaceWidth = ref(0)
const detailBusy = ref(false)
const docked = computed(() => workspaceWidth.value >= 1660)
const showDockedDetail = computed(() => docked.value && anyDetailOpen.value)
const teamFilterLabel = computed(() => sourceTeamDraft.value !== '' || nextTeamDraft.value !== '' ? '班组筛选 · 已设置' : '全部班组')
let layoutObserver: ResizeObserver | undefined
let detailTrigger: HTMLElement | null = null
function measureWorkspace() { workspaceWidth.value = layoutElement.value?.clientWidth || 0 }
watch(anyDetailOpen, async (open) => {
  if (!open && docked.value) {
    await nextTick()
    if (detailTrigger?.isConnected) detailTrigger.focus({ preventScroll: true })
    else layoutElement.value?.querySelector<HTMLElement>('.batch-link')?.focus({ preventScroll: true })
  }
})

function numberText(value: number, unit: string): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

function asTransfer(row: unknown): MaterialTransfer {
  return row as MaterialTransfer
}

function traceLink(serialNo: string) {
  if (authStore.isTeamAccount && authStore.currentUser?.team_id) return { path: `/team-workspaces/${authStore.currentUser.team_id}`, query: { serial_no: serialNo, tab: 'history' } }
  return { path: '/material-trace', query: { serial_no: serialNo } }
}

async function loadCounts(background = false): Promise<void> {
  const version = ++countsVersion
  if (!background) countsLoading.value = true
  try {
    const result = await materialTransferApi.counts(filterParams.value)
    if (!disposed && version === countsVersion) statusCounts.value = result
  } catch (error) {
    if (!disposed && version === countsVersion) {
      if (background) throw error
      statusCounts.value = null
    }
  } finally {
    if (!disposed && version === countsVersion) countsLoading.value = false
  }
}

function selectStatus(value: TransferStatusValue | 'all'): void {
  statusDraft.value = value
  applyFilters()
}

watch(filterParams, () => {
  statusCounts.value = null
  void loadCounts()
})

function updateRoute(): void {
  void router.replace({
    path: route.path,
    query: {
      ...(dates.value.from ? { date_from: dates.value.from } : {}), ...(dates.value.to ? { date_to: dates.value.to } : {}), ...(urgentOnly.value ? { urgent_only: 'true' } : {}),
      ...(query.value ? { query: query.value } : {}),
      ...(searchMode.value !== 'contains' ? { search_mode: searchMode.value } : {}),
      ...(searchField.value !== 'all' ? { search_field: searchField.value } : {}),
      ...(materialType.value ? { material_type: materialType.value } : {}),
      ...(status.value !== 'all' ? { status: status.value } : {}),
      ...(sourceTeamId.value !== '' ? { source_team_id: String(sourceTeamId.value) } : {}),
      ...(nextTeamId.value !== '' ? { next_team_id: String(nextTeamId.value) } : {}),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
      ...(pageSize.value !== 10 ? { page_size: String(pageSize.value) } : {}),
    },
  })
}

async function loadRows(background = false): Promise<void> {
  const version = ++requestVersion
  if (!background) loading.value = true
  errorMessage.value = ''
  try {
    const result = await materialTransferApi.list({
      ...filterParams.value,
      status: status.value as TransferStatusValue | 'all',
      page: page.value,
      page_size: pageSize.value,
    })
    if (disposed || version !== requestVersion) return
    rows.value = result.items
    total.value = result.total
    const refreshed = result.items.find((item) => item.batch_no === selected.value?.batch_no)
    if (!background && refreshed && !detailBusy.value) selected.value = refreshed
  } catch (error) {
    if (disposed || version !== requestVersion) return
    if (background) throw error
    rows.value = []
    total.value = 0
    errorMessage.value = error instanceof Error ? error.message : '转料记录加载失败'
  } finally {
    if (!disposed && version === requestVersion) loading.value = false
  }
}

const liveRefresh = useLiveRefresh(async () => {
  // Wait for both requests, including on failure, before draining another event.
  const results = await Promise.allSettled([loadRows(true), loadCounts(true)])
  if (results.some(result => result.status === 'rejected')) throw new Error('同步失败')
}, { busy: () => loading.value || countsLoading.value })

function applyFilters(): void {
  if (dates.value.from !== dateDraft.value.from || dates.value.to !== dateDraft.value.to) dates.value = { ...dateDraft.value }
  urgentOnly.value = urgentDraft.value
  query.value = queryDraft.value.trim()
  status.value = statusDraft.value
  sourceTeamId.value = sourceTeamDraft.value
  nextTeamId.value = nextTeamDraft.value
  searchMode.value = searchModeDraft.value
  searchField.value = searchFieldDraft.value
  materialType.value = materialTypeDraft.value
  page.value = 1
  updateRoute()
  void loadRows()
}

function resetFilters(): void {
  dateDraft.value = { from: '', to: '' }; urgentDraft.value = false
  queryDraft.value = ''
  statusDraft.value = 'all'
  sourceTeamDraft.value = ''
  nextTeamDraft.value = ''
  searchModeDraft.value = 'contains'
  searchFieldDraft.value = 'all'
  materialTypeDraft.value = ''
  applyFilters()
}

function setPage(next: number): void {
  page.value = next
  updateRoute()
  void loadRows()
}

function setPageSize(next: number): void {
  pageSize.value = next
  page.value = 1
  updateRoute()
  void loadRows()
}

function clearWorkspace(): void {
  ++requestVersion
  ++countsVersion
  ++scanVersion
  rows.value = []
  total.value = 0
  statusCounts.value = null
  selected.value = null
  drawerOpen.value = false
  groupOpen.value = false
  selectedDispatchNo.value = ''
  createOpen.value = false
  detailBusy.value = false
  scanning.value = false
  scanValue.value = ''
  scanError.value = ''
  scanPanelOpen.value = false
  errorMessage.value = ''
}

watch(() => route.query, () => {
  const restored = readRouteFilters()
  const current = { page: page.value, pageSize: pageSize.value, query: query.value, dateFrom: dates.value.from, dateTo: dates.value.to, urgentOnly: urgentOnly.value, status: status.value, sourceTeamId: String(sourceTeamId.value), nextTeamId: String(nextTeamId.value), searchMode: searchMode.value, searchField: searchField.value, materialType: materialType.value }
  if (JSON.stringify(restored) === JSON.stringify(current)) return
  page.value = restored.page
  pageSize.value = restored.pageSize
  dates.value = dateDraft.value = { from: restored.dateFrom, to: restored.dateTo }; urgentOnly.value = urgentDraft.value = restored.urgentOnly
  query.value = queryDraft.value = restored.query
  status.value = statusDraft.value = restored.status
  sourceTeamId.value = sourceTeamDraft.value = restored.sourceTeamId
  nextTeamId.value = nextTeamDraft.value = restored.nextTeamId
  searchMode.value = searchModeDraft.value = restored.searchMode
  searchField.value = searchFieldDraft.value = restored.searchField
  materialType.value = materialTypeDraft.value = restored.materialType
  void loadRows()
})

function openDetail(transfer: MaterialTransfer): void {
  if (detailBusy.value) return
  detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  selected.value = transfer
  groupOpen.value = false
  drawerOpen.value = true
}

async function scan(raw?: string): Promise<void> {
  const batchNo = (raw ?? scanValue.value).trim().toUpperCase()
  if (!batchNo || scanning.value || detailBusy.value) return
  const version = ++scanVersion
  scanning.value = true
  scanError.value = ''
  try {
    if (isDispatchNumber(batchNo)) {
      const group = await materialDispatchApi.get(batchNo)
      if (disposed || version !== scanVersion) return
      detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      selectedDispatchNo.value = group.dispatch_no; drawerOpen.value = false; groupOpen.value = true
      scanValue.value = ''; scanPanelOpen.value = false
      showToast(`已读取历史合并记录，共 ${group.line_count} 个批次`, 'success')
      return
    }
    const transfer = await materialTransferApi.get(batchNo)
    if (disposed || version !== scanVersion) return
    selected.value = transfer
    groupOpen.value = false
    drawerOpen.value = true
    scanValue.value = ''
    scanPanelOpen.value = false
    showToast(`已读取转料单 ${transfer.batch_no}`, 'success')
  } catch (error) {
    if (disposed || version !== scanVersion) return
    scanError.value = error instanceof MaterialTransferApiError && error.status === 404
      ? `未找到转料单 ${batchNo}`
      : error instanceof Error ? error.message : '转料单查询失败'
    showToast(scanError.value, 'error')
  } finally {
    if (!disposed && version === scanVersion) {
      scanning.value = false
      await nextTick()
      if (!anyDetailOpen.value) scanInput.value?.focus()
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function handleHidKeydown(event: KeyboardEvent): void {
  if (anyDetailOpen.value || createOpen.value || isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
  const now = Date.now()
  if (event.key === 'Enter' || event.key === 'Tab') {
    const code = hidBuffer.toUpperCase()
    const isScannerInput = Boolean(code) && now - hidLastKeyAt <= 180 && /^(?:TL|CK)[A-Z0-9-]{4,}$/.test(code)
    hidBuffer = ''
    hidLastKeyAt = 0
    if (isScannerInput) {
      event.preventDefault()
      scanValue.value = code
      void scan(code)
    }
    return
  }
  if (event.key.length !== 1 || !/^[\x21-\x7e]$/.test(event.key)) {
    hidBuffer = ''
    hidLastKeyAt = 0
    return
  }
  if (hidLastKeyAt && now - hidLastKeyAt > 180) hidBuffer = ''
  hidBuffer = `${hidBuffer}${event.key}`.slice(-64)
  hidLastKeyAt = now
}

function updateTransfer(transfer: MaterialTransfer): void {
  const index = rows.value.findIndex((item) => item.batch_no === transfer.batch_no)
  if (index >= 0) rows.value.splice(index, 1, transfer)
  selected.value = transfer
  void loadRows()
  void loadCounts()
}

function handleCreated(transfer: MaterialTransfer): void {
  if (String(transfer.source_team.id) !== String(authStore.currentUser?.team_id)) { void loadRows(); void loadCounts(); return }
  selected.value = transfer
  groupOpen.value = false
  drawerOpen.value = true
  void loadRows()
  void loadCounts()
}

onMounted(() => {
  measureWorkspace()
  if (typeof ResizeObserver !== 'undefined' && layoutElement.value) {
    layoutObserver = new ResizeObserver(measureWorkspace)
    layoutObserver.observe(layoutElement.value)
  } else window.addEventListener('resize', measureWorkspace)
  window.addEventListener('keydown', handleHidKeydown)
  if (!teamStore.items.length) void teamStore.refreshTeamDirectory()
  void loadRows()
  void loadCounts()
})

onBeforeUnmount(() => {
  disposed = true
  layoutObserver?.disconnect()
  window.removeEventListener('resize', measureWorkspace)
  ++requestVersion
  ++scanVersion
  window.removeEventListener('keydown', handleHidKeydown)
})
</script>

<template>
  <section ref="layoutElement" class="page workspace-page transfers-page reading-workspace" :class="{ 'transfers-page--detail': showDockedDetail }">
    <h1 class="sr-only">转料记录</h1>
    <div class="transfers-main">
      <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
      <div class="status-toolbar">
      <div class="status-overview" role="group" aria-label="按转料状态筛选" :aria-busy="countsLoading">
        <button v-for="option in statusOptions" :key="option.value" type="button" class="status-filter" :class="[`status-filter--${option.value}`, { 'is-selected': statusDraft === option.value }]" :aria-label="option.label === '全部' ? '全部转料' : option.label" :aria-pressed="statusDraft === option.value" @click="selectStatus(option.value)">
          <ElIcon class="status-filter__icon"><component :is="option.icon" /></ElIcon>
          <span class="status-filter__copy"><span>{{ option.label }}</span><strong>{{ statusCounts?.[option.value] ?? '—' }}</strong></span>
        </button>
        <button v-if="!countsLoading && !statusCounts" class="counts-retry" type="button" aria-label="重试加载状态数量" title="重试加载状态数量" @click="loadCounts()"><ElIcon><Refresh /></ElIcon></button>
      </div>
        <div class="heading-actions">
          <ElPopover v-model:visible="scanPanelOpen" trigger="click" placement="bottom-end" :width="400" popper-class="transfer-scan-popover" @show="focusScanner">
            <template #reference><ElButton class="scan-trigger" :icon="FullScreen" aria-label="扫码查询">扫码查询</ElButton></template>
            <div class="scan-popover-content">
              <strong>批次查询</strong>
              <ElInput ref="scanInput" v-model="scanValue" clearable autocomplete="off" aria-label="转料批次号" placeholder="扫描或输入批次号" :disabled="scanning" @keyup.enter="scan()">
                <template #append><ElButton :icon="Search" :loading="scanning" :disabled="!scanValue.trim()" @click="scan()">查询</ElButton></template>
              </ElInput>
              <p v-if="scanError" class="scan-error" role="alert">{{ scanError }}</p>
            </div>
          </ElPopover>
          <ElButton v-if="canCreate" type="primary" :icon="Plus" @click="openCreate">新建转料</ElButton>
        </div>
      </div>
      <ElCard class="transfers-card" shadow="never">
        <form class="filter-bar" @submit.prevent="applyFilters">
          <div class="search-fields">
          <ElSelect v-model="searchFieldDraft" class="search-field-select" aria-label="搜索字段" @change="applyFilters"><ElOption v-for="field in materialSearchFields" :key="field.value" :value="field.value" :label="field.value === 'all' && searchModeDraft !== 'contains' ? '全部编号与材质' : field.label" /></ElSelect>
          <ElInput v-model="queryDraft" clearable :placeholder="searchPlaceholder" aria-label="搜索转料记录" @clear="applyFilters">
            <template #prefix><ElIcon><Search /></ElIcon></template>
            <template #suffix><ElButton v-if="queryDraft" class="search-action" text :icon="Search" aria-label="搜索" native-type="submit" /></template>
          </ElInput>
          <ElSelect v-model="searchModeDraft" class="search-mode-select" aria-label="搜索方式" @change="applyFilters"><ElOption v-for="mode in materialSearchModes" :key="mode.value" :label="mode.label" :value="mode.value" /></ElSelect>
          </div>
          <div class="filter-options">
          <RecordDateFilter v-model="dateDraft" @update:model-value="applyFilters" /><ElCheckbox v-model="urgentDraft" @change="applyFilters">仅看加急</ElCheckbox>
          <ElSelect v-model="materialTypeDraft" clearable class="material-type-filter" placeholder="全部物料类型" aria-label="筛选物料类型" @change="applyFilters"><ElOption v-for="type in materialTypeOptions" :key="type.value" :label="type.label" :value="type.value" /></ElSelect>
          <ElPopover trigger="click" placement="bottom-start" :width="320">
            <template #reference><ElButton class="team-filter-trigger" :class="{ 'is-filtered': sourceTeamDraft !== '' || nextTeamDraft !== '' }" text aria-label="筛选班组">{{ teamFilterLabel }}<ElIcon><ArrowDown /></ElIcon></ElButton></template>
            <div class="team-filter-fields">
              <label>转出班组</label>
              <ElSelect v-model="sourceTeamDraft" clearable filterable placeholder="全部转出班组" aria-label="转出班组" @change="applyFilters"><ElOption v-for="team in teamStore.items" :key="team.id" :label="team.name" :value="team.id" /></ElSelect>
              <label>接收班组</label>
              <ElSelect v-model="nextTeamDraft" clearable filterable placeholder="全部接收班组" aria-label="接收班组" @change="applyFilters"><ElOption v-for="team in teamStore.items" :key="team.id" :label="team.name" :value="team.id" /></ElSelect>
            </div>
          </ElPopover>
          <ElButton v-if="hasFilters" class="reset-filters" text :icon="Refresh" aria-label="重置" title="重置筛选" @click="resetFilters" />
          </div>
          <p v-if="searchModeDraft !== 'contains'" class="search-scope-hint">{{ searchModeDraft === 'exact' ? '完整内容相同才匹配' : '从内容开头匹配' }}<template v-if="searchFieldDraft === 'all'"> · 范围：批次号、流水号、原单批号、编号、客户代码、材质</template></p>
        </form>
        <div v-loading="loading && hasRows" class="table-pane" :aria-busy="loading" element-loading-text="正在更新记录" element-loading-background="rgba(255, 255, 255, 0.72)">
          <ElSkeleton v-if="loading && !hasRows" class="table-skeleton" :rows="8" animated aria-label="正在加载转料记录" />
          <StatePanel v-else-if="errorMessage" state="error" :description="errorMessage" @retry="loadRows" />
          <StatePanel v-else-if="!hasRows" state="empty" title="暂无转料记录" description="请调整筛选条件。"><ElButton v-if="canCreate" type="primary" plain :icon="Plus" @click="openCreate">新建转料</ElButton></StatePanel>
          <ElTable v-else :data="rows" class="business-table transfer-table" border row-key="batch_no" :current-row-key="drawerOpen ? selected?.batch_no : undefined" highlight-current-row @row-click="openDetail">
            <ElTableColumn label="批次号 / 流水号" min-width="250" align="center">
              <template #default="{ row }"><ElButton text class="batch-link" :aria-label="'查看转料单 ' + row.batch_no" @click.stop="openDetail(asTransfer(row))">{{ row.batch_no }}</ElButton><div class="transfer-serial"><RouterLink class="serial-number" :to="traceLink(row.serial_no)" @click.stop>{{ row.serial_no }}</RouterLink><SerialUrgencyBadge :urgency="row.urgency" @click.stop /></div></template>
            </ElTableColumn>
            <ElTableColumn label="材质" min-width="150" align="center" show-overflow-tooltip prop="material_name" />
            <ElTableColumn label="来源" min-width="156" align="center" class-name="transfer-source-cell" show-overflow-tooltip><template #default="{ row }">{{ isWarehouseReceipt(asTransfer(row)) ? '库房手工入库' : row.source_team.name }}</template></ElTableColumn>
            <ElTableColumn label="去向" min-width="110" align="center" class-name="transfer-destination-cell" show-overflow-tooltip prop="next_team.name" />
            <ElTableColumn label="数量 / 重量" min-width="150" align="center"><template #default="{ row }"><div class="amount-cell"><span>{{ numberText(row.quantity, row.quantity_unit) }}</span><span class="amount-weight">{{ numberText(row.weight, row.weight_unit) }}</span></div></template></ElTableColumn>
            <ElTableColumn label="状态" min-width="140" align="center" class-name="transfer-status-cell"><template #default="{ row }"><MaterialTransferStatus :status="row.status" :entry-kind="row.entry_kind" plain /></template></ElTableColumn>
            <ElTableColumn label="转出时间" min-width="140" align="center"><template #default="{ row }"><time class="transfer-time" :title="formatDateTime(row.transferred_at)"><span v-for="(part, index) in formatDateTime(row.transferred_at).split(' ')" :key="index">{{ part }}</span></time></template></ElTableColumn>
          </ElTable>
          <div v-if="hasRows" class="transfer-mobile-list">
            <ElButton v-for="transfer in rows" :key="transfer.batch_no" text class="transfer-mobile-row" @click="openDetail(transfer)">
              <span class="mobile-row-head"><strong>{{ transfer.batch_no }}</strong><MaterialTransferStatus :status="transfer.status" :entry-kind="transfer.entry_kind" plain /></span>
              <span class="mobile-transfer-parties"><span><small>来源</small><span>{{ isWarehouseReceipt(transfer) ? '库房手工入库' : transfer.source_team.name }}</span></span><span><small>去向</small><span>{{ transfer.next_team.name }}</span></span></span>
              <span class="mobile-material-brief">{{ materialTypeLabel(transfer.material_type) }}<template v-if="transfer.material_name"> · {{ transfer.material_name }}</template></span>
              <span class="mobile-row-meta"><span>{{ numberText(transfer.quantity, transfer.quantity_unit) }} · {{ numberText(transfer.weight, transfer.weight_unit) }}</span><span>{{ transfer.serial_no }}</span></span>
            </ElButton>
          </div>
        </div>
        <footer v-if="!errorMessage" class="pagination-bar"><span>共 {{ total }} 条</span><ElPagination background layout="sizes, prev, pager, next" :total="total" :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" @current-change="setPage" @size-change="setPageSize" /></footer>
      </ElCard>
    </div>
    <div class="detail-slot"><MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="selectedDispatchNo" :docked="docked" @changed="loadRows(); loadCounts()" @busy-change="detailBusy = $event" /><MaterialTransferDrawer v-model="drawerOpen" :batch-no="selected?.batch_no" :transfer="selected" :docked="docked" @changed="updateTransfer" @busy-change="detailBusy = $event" /></div>
    <MaterialTransferFormDialog v-model="createOpen" @saved="handleCreated" />
  </section>
</template>

<style scoped>
.mobile-material-brief { display: block; color: var(--muted); font-size: 12px; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.transfers-page { --detail-width: 900px; display: grid; grid-template-columns: minmax(0, 1fr) 0; grid-template-rows: minmax(0, 1fr); padding: 20px 24px; gap: 16px 0; background: var(--workspace-bg); transition: grid-template-columns var(--motion-panel) var(--motion-ease), column-gap var(--motion-panel) var(--motion-ease); }
.transfers-page--detail { grid-template-columns: minmax(0, 1fr) var(--detail-width); column-gap: 24px; }
.status-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
.status-toolbar .status-overview { flex: 1; min-width: 0; padding-bottom: 0; border-bottom: 0; }
.status-toolbar .heading-actions { padding-bottom: 8px; }
.heading-actions { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.heading-actions :deep(.el-button) { height: 32px; margin: 0; padding-inline: 12px; font-size: 14px; }
.transfers-main { container: workspace / inline-size; display: flex; grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; flex-direction: column; gap: 10px; }
.detail-slot { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; }
.status-overview { position: relative; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); flex-shrink: 0; min-height: 44px; padding: 0 18px; border: 1px solid var(--panel-line); border-radius: 8px; background: var(--surface); box-shadow: var(--panel-shadow); }
.status-filter { position: relative; display: flex; align-items: center; justify-content: center; gap: 16px; min-width: 0; padding: 8px; border: 0; border-radius: 8px; color: var(--text); background: transparent; transition: background-color var(--motion-fast) ease; }
.status-filter + .status-filter::before { position: absolute; top: 25%; bottom: 25%; left: 0; width: 1px; background: var(--line); content: ''; }
.status-filter.is-selected::after { position: absolute; bottom: 0; left: 14%; right: 14%; height: 3px; background: var(--primary); content: ''; }
.status-filter:hover { background: var(--surface-soft); }
.status-filter:focus-visible { outline-offset: -4px; }
.status-filter__icon { display: none; }
.status-filter--pending .status-filter__icon { display: none; }
.status-filter--received .status-filter__icon, .status-filter--dispatched .status-filter__icon { display: none; }
.status-filter--voided .status-filter__icon { display: none; }
.status-filter__copy { display: flex; align-items: center; gap: 8px; text-align: left; line-height: 1.4; white-space: nowrap; }
.status-filter__copy > span { font-size: 14px; }
.status-filter__copy strong { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.counts-retry { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 24px; height: 24px; border: 0; background: transparent; color: var(--subtle); }
.transfers-card { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--panel-line); border-radius: var(--card-radius); box-shadow: var(--panel-shadow); }
.transfers-card :deep(.el-card__body) { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 0; flex-direction: column; }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; flex: 0 0 auto; min-height: 60px; padding: 12px; gap: 8px 12px; border-bottom: 1px solid var(--line-light); }
.search-fields { display: flex; align-items: center; gap: 4px; flex: 1 1 470px; min-width: 0; }
.search-fields > .el-input { flex: 1; min-width: 0; }
.search-field-select { flex: 0 0 145px; }
.search-mode-select { flex: 0 0 114px; }
.filter-options { display: flex; align-items: center; gap: 4px; }
.material-type-filter { width: 140px; }
.search-scope-hint { flex-basis: 100%; margin: 0; padding: 2px 8px; color: var(--subtle); font-size: 12px; line-height: 1.5; }
.filter-bar :deep(.el-input__prefix-inner) { margin-right: 8px; font-size: 18px; }
.filter-bar > .el-button { margin: 0; }
.team-filter-trigger { flex-shrink: 0; color: var(--subtle); font-size: 14px; }
.team-filter-trigger > :deep(span) { display: flex; gap: 8px; }
.team-filter-trigger.is-filtered { color: var(--primary); background: var(--surface-soft); }
.team-filter-fields { display: grid; padding: 8px; gap: 10px; }
.team-filter-fields label { color: var(--subtle); font-size: 13px; }
.reset-filters { width: 30px; padding: 0; color: var(--subtle); }
.search-action { width: 26px; height: 26px; padding: 0; color: var(--subtle); }
.scan-trigger { color: var(--text); }
.scan-popover-content { padding: 4px; }
.scan-popover-content > strong { color: var(--text); font-size: 15px; }
.scan-popover-content > .el-input { margin-top: 12px; }
.scan-popover-content p { color: var(--subtle); font-size: 13px; }
.scan-popover-content .scan-error { color: var(--danger); }
.table-pane { flex: 1; min-height: 0; overflow: hidden; }
.table-skeleton { padding: 24px; }
.table-skeleton :deep(.el-skeleton__p) { height: 24px; margin-top: 24px; }
.transfer-table { font-size: 16px; }
.transfer-table :deep(.el-table__row) { cursor: pointer; }
.transfers-page .transfer-table :deep(th.el-table__cell) { height: 42px; padding-block: 10px; }
.transfers-page .transfer-table :deep(.el-table__body td.el-table__cell) { height: 64px; padding-block: 10px; }
.transfer-table :deep(.el-table__inner-wrapper::before) { display: none; }
.transfers-page .transfer-table :deep(.cell) { padding-inline: 12px; line-height: 22px; }
.transfer-time { display: flex; flex-direction: column; align-items: center; color: var(--muted); font-size: 14px; white-space: nowrap; }
.transfer-serial { justify-content: center; }
.transfers-page .transfer-table :deep(.transfer-status-text) { font-size: 14px; }
.transfers-page .transfer-table :deep(.transfer-status-text--pending) { color: #946200; }
.transfers-page .transfer-table :deep(.transfer-status-text--received), .transfers-page .transfer-table :deep(.transfer-status-text--dispatched) { color: #258058; }
.batch-link { justify-content: flex-start; height: auto; min-height: 20px; padding: 0 !important; color: var(--text); font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
.serial-number { color: var(--subtle); font-size: 12px; }
.serial-number:hover { color: var(--primary); text-decoration: underline; }
.amount-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.amount-weight { color: var(--reading-muted); font-size: 14px; }
.pagination-bar { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; min-height: 56px; padding: 12px 16px; gap: 12px; border-top: 1px solid var(--line-light); color: var(--subtle); font-size: 13px; }
.transfer-mobile-list { display: none; }
@container workspace (max-width: 820px) {
  .status-overview { padding-inline: 6px; }
  .status-filter { gap: 9px; }
  .status-filter__icon { display: none; }
}
@container workspace (max-width: 760px) {
  .status-toolbar { flex-wrap: wrap; gap: 8px; }
  .status-toolbar .status-overview { flex-basis: 100%; }
  .status-toolbar .heading-actions { margin-left: auto; }
  .transfer-table { display: none; }
  .table-pane { overflow-y: auto; }
  .transfer-mobile-list { display: block; }
  .transfer-mobile-row { display: block; width: 100%; height: auto; min-height: 132px; margin: 0; padding: 16px 8px; border-bottom: 1px solid var(--line-light); border-radius: 0; text-align: left; }
  .transfer-mobile-row :deep(> span) { display: grid; width: 100%; gap: 12px; }
  .mobile-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mobile-row-head strong { overflow: hidden; color: var(--text); font-size: 14px; font-weight: 500; text-overflow: ellipsis; }
  .mobile-row-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--subtle); font-size: 12px; }
  .mobile-transfer-parties { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; color: var(--reading-ink); font-size: 16px; }
  .mobile-transfer-parties > span { display: grid; gap: 4px; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .mobile-transfer-parties small { color: var(--reading-muted); font-size: 14px; }
  .pagination-bar { flex-wrap: wrap; padding-inline: 4px; }
}
@container workspace (max-width: 480px) {
  .status-overview { min-height: 44px; padding-inline: 2px; }
  .status-filter { gap: 0; padding: 12px 3px; }
  .status-filter__icon { display: none; }
  .status-filter__copy { text-align: center; }
  .status-filter__copy strong { font-size: 22px; }
  .status-filter__copy > span { font-size: 11px; white-space: normal; }
  .search-fields { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 4px; }
  .search-fields > .el-input { grid-column: 1 / -1; grid-row: 2; }
  .search-field-select, .search-mode-select { width: 100%; }
  .filter-options { width: 100%; }
  .filter-options .reset-filters { margin-left: auto; }
  .team-filter-trigger { padding-inline: 6px; font-size: 12px; }
}
@media (max-width: 1100px) {
  .transfers-page { padding: 14px; gap: 10px 0; }
  .transfers-page--detail { column-gap: 20px; }
}
@media (max-width: 640px) {
  .transfers-page { padding: 12px; row-gap: 10px; }
  .heading-actions { width: 100%; gap: 10px; }
  .heading-actions :deep(.el-button) { height: 40px; padding-inline: 14px; font-size: 14px; }
  .transfers-main { gap: 14px; }
  .transfers-card :deep(.el-card__body) { padding-inline: 10px; }
  .pagination-bar { gap: 5px; }
  .pagination-bar :deep(.el-pagination__sizes) { margin-right: 3px; }
}
</style>

<script setup lang="ts">
import FilterDialog from '@/components/FilterDialog.vue'
import TableExportButton from '@/components/TableExportButton.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { globalTransferExportFields } from '@/utils/teamTableExport'
import PageBackButton from '@/components/PageBackButton.vue'
import { CircleCheck, Clock, Collection, Plus, Refresh, Remove, Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElCard,
  ElIcon,
  ElInput,
  ElLoading,
  ElOption,
  ElPagination,
  ElSelect,
  ElSkeleton,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { isWarehouseReceipt, materialPurposeLabel, materialSearchFields, materialSearchModes, materialTypeLabel, materialTypeOptions } from '@/types/materialTransfer'
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
function exportSource() {
  const params = { ...filterParams.value, status: status.value }
  return tableExportSource('转料记录', total.value, globalTransferExportFields,
    (signal, progress) => loadExportPages((page, pageSize) => materialTransferApi.list({ ...params, page, page_size: pageSize }), signal, progress))
}
const searchPlaceholder = computed(() => searchFieldDraft.value !== 'all'
  ? `搜索${materialSearchFields.find(option => option.value === searchFieldDraft.value)?.label}`
  : searchModeDraft.value === 'contains' ? '搜索编号、材质、班组或转料人' : '搜索批次号、流水号、原单批号、编号、客户代码或材质')

const drawerOpen = ref(false)
const groupOpen = ref(false)
const selectedDispatchNo = ref('')
const selected = ref<MaterialTransfer | null>(null)
const createOpen = ref(false)
let requestVersion = 0
let linkedBatchVersion = 0
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
const detailBusy = ref(false)
const filtersOpen = ref(false)
const appliedFilterCount = computed(() => [dates.value.from || dates.value.to, urgentOnly.value, sourceTeamId.value, nextTeamId.value, materialType.value, status.value !== 'all', searchMode.value !== 'contains', searchField.value !== 'all'].filter(Boolean).length)
const queryBeforeFilters = ref('')
function openFilters() { queryBeforeFilters.value = queryDraft.value; syncFilterDrafts() }
function cancelFilters() { syncFilterDrafts(); queryDraft.value = queryBeforeFilters.value }
function syncFilterDrafts() {
  dateDraft.value = { ...dates.value }; urgentDraft.value = urgentOnly.value; sourceTeamDraft.value = sourceTeamId.value; nextTeamDraft.value = nextTeamId.value
  searchModeDraft.value = searchMode.value; searchFieldDraft.value = searchField.value; materialTypeDraft.value = materialType.value; statusDraft.value = status.value
}
function applyDialogFilters() { applyFilters(); filtersOpen.value = false }
function clearFilterDrafts() {
  dateDraft.value = { from: '', to: '' }; urgentDraft.value = false; sourceTeamDraft.value = nextTeamDraft.value = ''
  searchModeDraft.value = 'contains'; searchFieldDraft.value = 'all'; materialTypeDraft.value = ''; statusDraft.value = 'all'; queryDraft.value = ''
}

function numberText(value: number, unit: string): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value)} ${unit}`
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
  ++linkedBatchVersion
  rows.value = []
  total.value = 0
  statusCounts.value = null
  selected.value = null
  drawerOpen.value = false
  groupOpen.value = false
  selectedDispatchNo.value = ''
  createOpen.value = false
  detailBusy.value = false
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
  selected.value = transfer
  groupOpen.value = false
  drawerOpen.value = true
}

async function openLinkedBatch(batchNo: string): Promise<void> {
  if (detailBusy.value) return
  const version = ++linkedBatchVersion
  try {
    if (isDispatchNumber(batchNo)) {
      const group = await materialDispatchApi.get(batchNo)
      if (disposed || version !== linkedBatchVersion) return
      selectedDispatchNo.value = group.dispatch_no; drawerOpen.value = false; groupOpen.value = true
      return
    }
    const transfer = await materialTransferApi.get(batchNo)
    if (disposed || version !== linkedBatchVersion) return
    selected.value = transfer
    groupOpen.value = false
    drawerOpen.value = true
  } catch (error) {
    if (disposed || version !== linkedBatchVersion) return
    const message = error instanceof MaterialTransferApiError && error.status === 404
      ? `未找到转料单 ${batchNo}`
      : error instanceof Error ? error.message : '转料单查询失败'
    showToast(message, 'error')
  }
}

// Dashboard batch links still open documents; only the receiving page listens to scanners.
watch(() => route.query.batch_no, batchNo => {
  ++linkedBatchVersion
  if (typeof batchNo === 'string' && batchNo.trim()) void openLinkedBatch(batchNo.trim().toUpperCase())
}, { immediate: true })

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
  if (!teamStore.items.length) void teamStore.refreshTeamDirectory()
  void loadRows()
  void loadCounts()
})

onBeforeUnmount(() => {
  disposed = true
  ++requestVersion
  ++linkedBatchVersion
})
</script>

<template>
  <section class="page workspace-page transfers-page reading-workspace">
    <h1 class="sr-only">转料记录</h1>
    <div class="transfers-main">
      <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
      <div class="status-toolbar">
      <PageBackButton />
      <h2 class="transfer-heading">转料记录</h2>
        <div class="heading-actions"><TableExportButton :source="exportSource" :disabled="loading || !!errorMessage" :context="route.fullPath" />
          <ElButton v-if="canCreate" type="primary" :icon="Plus" @click="openCreate">新建转料</ElButton>
        </div>
      </div>
      <ElCard class="transfers-card" shadow="never">
        <form class="filter-bar" @submit.prevent="applyFilters">
          <div class="search-fields">
          <ElInput v-model="queryDraft" clearable :placeholder="searchPlaceholder" aria-label="搜索转料记录" @clear="applyFilters">
            <template #prefix><ElIcon><Search /></ElIcon></template>
            <template #suffix><ElButton v-if="queryDraft" class="search-action" text :icon="Search" aria-label="搜索" native-type="submit" /></template>
          </ElInput>
          </div>
          <div class="filter-options">
            <FilterDialog v-model="filtersOpen" title="转料记录筛选" :count="appliedFilterCount" @open="openFilters" @cancel="cancelFilters" @apply="applyDialogFilters" @reset="clearFilterDrafts">
              <label class="filter-wide">搜索内容<ElInput v-model="queryDraft" aria-label="转料筛选搜索内容" clearable placeholder="输入流水号、批次号等" /></label>
              <label>搜索字段<ElSelect v-model="searchFieldDraft" aria-label="搜索字段"><ElOption v-for="field in materialSearchFields" :key="field.value" :value="field.value" :label="field.label" /></ElSelect></label>
              <label>搜索方式<ElSelect v-model="searchModeDraft" aria-label="搜索方式"><ElOption v-for="mode in materialSearchModes" :key="mode.value" :label="mode.label" :value="mode.value" /></ElSelect></label>
              <label>登记日期<RecordDateFilter v-model="dateDraft" /></label>
              <label>状态<ElSelect v-model="statusDraft" aria-label="转料状态"><ElOption v-for="option in statusOptions" :key="option.value" :value="option.value" :label="`${option.label}（${statusCounts?.[option.value] ?? '—'}）`" /></ElSelect><ElButton v-if="!countsLoading && !statusCounts" text @click="loadCounts()">重试加载状态数量</ElButton></label>
              <label>物料类型<ElSelect v-model="materialTypeDraft" clearable placeholder="全部物料类型" aria-label="筛选物料类型"><ElOption v-for="type in materialTypeOptions" :key="type.value" :label="type.label" :value="type.value" /></ElSelect></label>
              <label>转出班组<ElSelect v-model="sourceTeamDraft" clearable filterable placeholder="全部转出班组" aria-label="转出班组"><ElOption v-for="team in teamStore.items" :key="team.id" :label="team.name" :value="team.id" /></ElSelect></label>
              <label>接收班组<ElSelect v-model="nextTeamDraft" clearable filterable placeholder="全部接收班组" aria-label="接收班组"><ElOption v-for="team in teamStore.items" :key="team.id" :label="team.name" :value="team.id" /></ElSelect></label>
              <ElCheckbox v-model="urgentDraft">仅看加急</ElCheckbox>
            </FilterDialog>
            <ElButton native-type="submit">查询</ElButton><ElButton :icon="Refresh" text aria-label="刷新转料记录" @click="liveRefresh.request" />
          </div>
        </form>
        <div v-loading="loading && hasRows" class="table-pane" :aria-busy="loading" element-loading-text="正在更新记录" element-loading-background="rgba(255, 255, 255, 0.72)">
          <ElSkeleton v-if="loading && !hasRows" class="table-skeleton" :rows="8" animated aria-label="正在加载转料记录" />
          <StatePanel v-else-if="errorMessage" state="error" :description="errorMessage" @retry="loadRows" />
          <StatePanel v-else-if="!hasRows" state="empty" title="暂无转料记录" description="请调整筛选条件。"><ElButton v-if="canCreate" type="primary" plain :icon="Plus" @click="openCreate">新建转料</ElButton></StatePanel>
          <ElTable v-else :data="rows" class="business-table transfer-table" border row-key="batch_no" :current-row-key="drawerOpen ? selected?.batch_no : undefined" highlight-current-row @row-click="openDetail">
            <ElTableColumn label="流水号" min-width="220" align="center" show-overflow-tooltip><template #default="{ row }"><div class="transfer-serial"><RouterLink class="serial-number" :to="traceLink(row.serial_no)" @click.stop>{{ row.serial_no }}</RouterLink><SerialUrgencyBadge :urgency="row.urgency" @click.stop /></div></template></ElTableColumn>
            <ElTableColumn label="转出时间" min-width="180" align="center"><template #default="{ row }"><time class="transfer-time" :title="formatDateTime(row.transferred_at)">{{ formatDateTime(row.transferred_at) }}</time></template></ElTableColumn>
            <ElTableColumn label="材质" min-width="150" align="center" show-overflow-tooltip prop="material_name" />
            <ElTableColumn label="来源" min-width="156" align="center" class-name="transfer-source-cell" show-overflow-tooltip><template #default="{ row }">{{ isWarehouseReceipt(asTransfer(row)) ? '库房手工入库' : row.source_team.name }}</template></ElTableColumn>
            <ElTableColumn label="去向" min-width="110" align="center" class-name="transfer-destination-cell" show-overflow-tooltip prop="next_team.name" />
            <ElTableColumn label="接收业务" min-width="125" align="center" class-name="transfer-purpose-cell" show-overflow-tooltip><template #default="{ row }">{{ materialPurposeLabel(asTransfer(row)) }}</template></ElTableColumn>
            <ElTableColumn label="数量" min-width="120" align="center" class-name="transfer-quantity-cell"><template #default="{ row }">{{ numberText(row.quantity, row.quantity_unit) }}</template></ElTableColumn>
            <ElTableColumn label="重量" min-width="140" align="center" class-name="transfer-weight-cell"><template #default="{ row }">{{ numberText(row.weight, row.weight_unit) }}</template></ElTableColumn>
            <ElTableColumn label="状态" min-width="140" align="center" class-name="transfer-status-cell"><template #default="{ row }"><MaterialTransferStatus :status="row.status" :entry-kind="row.entry_kind" plain /></template></ElTableColumn>
            <ElTableColumn label="批次号" min-width="210" align="center" show-overflow-tooltip>
              <template #default="{ row }"><ElButton text class="batch-link" :aria-label="'查看转料单 ' + row.batch_no" @click.stop="openDetail(asTransfer(row))">{{ row.batch_no }}</ElButton></template>
            </ElTableColumn>
          </ElTable>
          <div v-if="hasRows" class="transfer-mobile-list">
            <ElButton v-for="transfer in rows" :key="transfer.batch_no" text class="transfer-mobile-row" @click="openDetail(transfer)">
              <span class="mobile-row-head"><strong>{{ transfer.serial_no }}</strong><MaterialTransferStatus :status="transfer.status" :entry-kind="transfer.entry_kind" plain /></span>
              <time class="transfer-time" :title="formatDateTime(transfer.transferred_at)">{{ formatDateTime(transfer.transferred_at) }}</time>
              <span class="mobile-transfer-parties"><span><small>来源</small><span>{{ isWarehouseReceipt(transfer) ? '库房手工入库' : transfer.source_team.name }}</span></span><span><small>去向</small><span>{{ transfer.next_team.name }}</span></span><span><small>接收业务</small><span>{{ materialPurposeLabel(transfer) }}</span></span></span>
              <span class="mobile-material-brief">{{ materialTypeLabel(transfer.material_type) }}<template v-if="transfer.material_name"> · {{ transfer.material_name }}</template></span>
              <span class="mobile-row-meta"><span>{{ numberText(transfer.quantity, transfer.quantity_unit) }} · {{ numberText(transfer.weight, transfer.weight_unit) }}</span><span>{{ transfer.batch_no }}</span></span>
            </ElButton>
          </div>
        </div>
        <footer v-if="!errorMessage" class="pagination-bar"><span>共 {{ total }} 条</span><ElPagination background layout="sizes, prev, pager, next" :total="total" :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" @current-change="setPage" @size-change="setPageSize" /></footer>
      </ElCard>
    </div>
    <MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="selectedDispatchNo" @changed="loadRows(); loadCounts()" @busy-change="detailBusy = $event" />
    <MaterialTransferDrawer v-model="drawerOpen" :batch-no="selected?.batch_no" :transfer="selected" @changed="updateTransfer" @busy-change="detailBusy = $event" />
    <MaterialTransferFormDialog v-model="createOpen" @saved="handleCreated" />
  </section>
</template>

<style scoped>
.mobile-material-brief { display: block; color: var(--muted); font-size: 12px; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.transfers-page { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); padding: 20px 24px; gap: 16px 0; background: var(--workspace-bg); }
.status-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
.status-toolbar h2 { margin: 0; font-size: 20px; font-weight: 600; }
.heading-actions { display: flex; gap: 8px; margin-left: auto; align-items: center; }
.transfers-card { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--glass-border); border-radius: var(--card-radius); background: var(--glass-surface); box-shadow: var(--glass-shadow); }
.transfers-card :deep(.el-card__body) { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 0; flex-direction: column; }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; flex: 0 0 auto; min-height: 60px; padding: 12px; gap: 8px 12px; border-bottom: 1px solid var(--line-light); }
.search-fields { display: flex; align-items: center; gap: 4px; flex: 1 1 470px; min-width: 0; }
.search-fields > .el-input { flex: 1; min-width: 0; }
.filter-options { display: flex; align-items: center; gap: 4px; }
.filter-bar :deep(.el-input__prefix-inner) { margin-right: 8px; font-size: 18px; }
.filter-bar > .el-button { margin: 0; }
.search-action { width: 26px; height: 26px; padding: 0; color: var(--subtle); }
.table-pane { flex: 1; min-height: 0; overflow: hidden; }
.table-skeleton { padding: 24px; }
.table-skeleton :deep(.el-skeleton__p) { height: 24px; margin-top: 24px; }
.transfer-table { font-size: 16px; }
.transfer-table :deep(.el-table__row) { cursor: pointer; }
.transfers-page .transfer-table :deep(th.el-table__cell) { height: 42px; padding-block: 10px; }
.transfers-page .transfer-table :deep(.el-table__body td.el-table__cell) { height: 48px; padding-block: 10px; }
.transfer-table :deep(.el-table__inner-wrapper::before) { display: none; }
.transfers-page .transfer-table :deep(.cell) { padding-inline: 12px; line-height: 22px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.transfer-time { color: var(--muted); font-size: 14px; white-space: nowrap; }
.transfer-serial { justify-content: center; }
.transfers-page .transfer-table :deep(.transfer-status-text) { font-size: 14px; }
.transfers-page .transfer-table :deep(.transfer-status-text--pending) { color: var(--el-color-warning-dark-2); }
.transfers-page .transfer-table :deep(.transfer-status-text--received), .transfers-page .transfer-table :deep(.transfer-status-text--dispatched) { color: var(--el-color-success); }
.batch-link { justify-content: flex-start; height: auto; min-height: 20px; padding: 0 !important; color: var(--text); font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
.serial-number { color: var(--subtle); font-size: 12px; }
.serial-number:hover { color: var(--primary); text-decoration: underline; }
.pagination-bar { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; min-height: 56px; padding: 12px 16px; gap: 12px; border-top: 1px solid var(--line-light); color: var(--subtle); font-size: 13px; }
.transfer-mobile-list { display: none; }
@container workspace (max-width: 760px) {
  .status-toolbar { flex-wrap: wrap; gap: 8px; }
  .status-toolbar .heading-actions { margin-left: auto; }
  .transfer-table { display: none; }
  .table-pane { overflow-y: auto; }
  .transfer-mobile-list { display: block; }
  .transfer-mobile-row { display: block; width: 100%; height: auto; min-height: 132px; margin: 0; padding: 16px 8px; border-bottom: 1px solid var(--line-light); border-radius: 0; text-align: left; }
  .transfer-mobile-row :deep(> span) { display: grid; width: 100%; gap: 12px; }
  .mobile-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mobile-row-head strong { overflow: hidden; color: var(--text); font-size: 14px; font-weight: 500; text-overflow: ellipsis; }
  .mobile-row-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--subtle); font-size: 12px; }
  .mobile-transfer-parties { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; color: var(--reading-ink); font-size: 16px; }
  .mobile-transfer-parties > span { display: grid; gap: 4px; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .mobile-transfer-parties small { color: var(--reading-muted); font-size: 14px; }
  .pagination-bar { flex-wrap: wrap; padding-inline: 4px; }
}
@container workspace (max-width: 480px) {
  .search-fields { flex-basis: 100%; }
  .filter-options { width: 100%; }
}
@media (max-width: 1100px) {
  .transfers-page { padding: 14px; gap: 10px 0; }
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

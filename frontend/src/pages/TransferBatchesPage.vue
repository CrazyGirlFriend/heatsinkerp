<script setup lang="ts">
import { formatAmount } from '@/utils/format'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import FilterDialog from '@/components/FilterDialog.vue'
import InventoryColumnSettings from '@/components/InventoryColumnSettings.vue'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import TableColumnFilter from '@/components/TableColumnFilter.vue'
import { invalidNumberRange } from '@/utils/numberFilterRange'
import TableExportButton from '@/components/TableExportButton.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { globalTransferExportFields } from '@/utils/teamTableExport'
import { transferRecordColumns as displayColumns } from '@/utils/transferRecordColumns'
import PageBackButton from '@/components/PageBackButton.vue'
import {
  CircleCheck,
  Clock,
  Collection,
  Plus,
  Refresh,
  Remove,
  Search,
} from '@element-plus/icons-vue'
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
import type {
  MaterialSearchField,
  MaterialSearchMode,
  MaterialTransfer,
  MaterialTransferFilterParams,
  MaterialTransferStatusCounts,
  MaterialTransferStatus as TransferStatusValue,
  MaterialTransferSummary,
} from '@/types/materialTransfer'
import {
  materialSourceLabel,
  materialPurposeLabel,
  materialSearchFields,
  materialSearchModes,
  materialTypeLabel,
  materialTypeOptions,
} from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const route = useRoute()
const vLoading = ElLoading.directive
const router = useRouter()
const authStore = useAuthStore()
const teamStore = useTeamDirectoryStore()
type DisplayColumnKey = (typeof displayColumns)[number]['key']
const columnChoices = ref<InventoryColumnChoice<DisplayColumnKey>[]>(
  displayColumns.map((column) => ({ key: column.key, visible: column.defaultVisible })),
)
const columnStorageKey = computed(() =>
  authStore.currentUser?.id ? `heatsink.transfer-columns.v1:${authStore.currentUser.id}` : null,
)
const visibleColumns = computed(() =>
  columnChoices.value
    .filter((choice) => choice.visible)
    .flatMap((choice) => displayColumns.filter((column) => column.key === choice.key)),
)
const rows = ref<MaterialTransfer[]>([])
const loading = ref(true)
const errorMessage = ref('')
const total = ref(0)
const summary = ref<MaterialTransferSummary | null>(null)
const summaryStates = [
  { key: 'received', label: '已签收' },
  { key: 'pending', label: '待签收' },
] as const
const statusCounts = ref<MaterialTransferStatusCounts | null>(null)
const countsLoading = ref(true)
const statusOptions = [
  { value: 'all', label: '全部', icon: Collection },
  { value: 'pending', label: '待确认', icon: Clock },
  { value: 'received', label: '已接收 / 入库', icon: CircleCheck },
  { value: 'dispatched', label: '已出库 / 发货', icon: CircleCheck },
  { value: 'voided', label: '已作废', icon: Remove },
] as const
const columnKeys = [
  'serial_query',
  'material_query',
  'batch_query',
  'purpose_query',
  'quantity_min',
  'quantity_max',
  'weight_min',
  'weight_max',
] as const
type ColumnKey = (typeof columnKeys)[number]
function readChoices(value: string, allowed?: readonly string[]) {
  return [
    ...new Set(
      value
        .split(',')
        .filter((item) => (allowed ? allowed.includes(item) : /^[1-9]\d*$/.test(item))),
    ),
  ].join(',')
}
let countsVersion = 0
function readRouteFilters() {
  const text = (key: string) =>
    typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  const requestedPage = Number(text('page'))
  return {
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: [10, 20, 50, 100].includes(Number(text('page_size')))
      ? Number(text('page_size'))
      : 10,
    query: text('query'),
    dateFrom: text('date_from'),
    dateTo: text('date_to'),
    urgentOnly: text('urgent_only') === 'true',
    status:
      readChoices(
        text('statuses') || text('status'),
        statusOptions.filter((item) => item.value !== 'all').map((item) => item.value),
      ) || 'all',
    sourceTeamId: readChoices(text('source_team_ids') || text('source_team_id')),
    nextTeamId: readChoices(text('next_team_ids') || text('next_team_id')),
    searchMode:
      materialSearchModes.find((option) => option.value === text('search_mode'))?.value ??
      'contains',
    searchField:
      materialSearchFields.find((option) => option.value === text('search_field'))?.value ?? 'all',
    materialType: readChoices(
      text('material_types') || text('material_type'),
      materialTypeOptions.map((item) => item.value),
    ),
    columns: Object.fromEntries(columnKeys.map((key) => [key, text(key)])) as Record<
      ColumnKey,
      string
    >,
  }
}
const initialFilters = readRouteFilters()
const dateDraft = ref({ from: initialFilters.dateFrom, to: initialFilters.dateTo }),
  urgentDraft = ref(initialFilters.urgentOnly)
const dates = ref({ ...dateDraft.value }),
  urgentOnly = ref(urgentDraft.value)
const page = ref(initialFilters.page)
const pageSize = ref(initialFilters.pageSize)
const queryDraft = ref(initialFilters.query)
const statusDraft = ref(initialFilters.status)
const sourceTeamDraft = ref<string | number>(initialFilters.sourceTeamId)
const nextTeamDraft = ref<string | number>(initialFilters.nextTeamId)
const searchModeDraft = ref<MaterialSearchMode>(initialFilters.searchMode)
const searchFieldDraft = ref<MaterialSearchField>(initialFilters.searchField)
const materialTypeDraft = ref(initialFilters.materialType)
const query = ref(queryDraft.value)
const status = ref(statusDraft.value)
const sourceTeamId = ref(sourceTeamDraft.value)
const nextTeamId = ref(nextTeamDraft.value)
const searchMode = ref(searchModeDraft.value)
const searchField = ref(searchFieldDraft.value)
const materialType = ref(materialTypeDraft.value)
const columns = ref({ ...initialFilters.columns })
const columnDraft = ref({ ...columns.value })
const quantityRangeInvalid = computed(() =>
  invalidNumberRange(columnDraft.value.quantity_min, columnDraft.value.quantity_max, true),
)
const weightRangeInvalid = computed(() =>
  invalidNumberRange(columnDraft.value.weight_min, columnDraft.value.weight_max),
)
function selections(model: { value: string | number }, empty = '') {
  return computed({
    get: () =>
      String(model.value) === empty ? [] : String(model.value).split(',').filter(Boolean),
    set: (values: string[] | string | number) => {
      model.value = Array.isArray(values)
        ? values.includes('all')
          ? empty
          : values.join(',') || empty
        : String(values) || empty
    },
  })
}
const sourceChoices = selections(sourceTeamDraft),
  nextChoices = selections(nextTeamDraft)
const typeChoices = selections(materialTypeDraft),
  statusChoices = selections(statusDraft, 'all')
const teamOptions = computed(() =>
  teamStore.items.map((team) => ({ value: String(team.id), label: team.name })),
)
const columnStatusOptions = computed(() =>
  statusOptions
    .filter((option) => option.value !== 'all')
    .map((option) => ({ value: option.value, label: option.label })),
)
function choiceParams(single: string, multiple: string, value: string | number) {
  const text = String(value)
  return text && text !== 'all' ? { [text.includes(',') ? multiple : single]: text } : {}
}
const statusParams = computed(() =>
  status.value.includes(',')
    ? { statuses: status.value, status: 'all' as const }
    : { status: status.value as TransferStatusValue | 'all' },
)
const filterParams = computed<MaterialTransferFilterParams>(() => ({
  query: query.value || undefined,
  date_from: dates.value.from || undefined,
  date_to: dates.value.to || undefined,
  urgent_only: urgentOnly.value || undefined,
  search_mode: searchMode.value,
  search_field: searchField.value,
  material_type: undefined,
  source_team_id: undefined,
  next_team_id: undefined,
  ...choiceParams('material_type', 'material_types', materialType.value),
  ...choiceParams('source_team_id', 'source_team_ids', sourceTeamId.value),
  ...choiceParams('next_team_id', 'next_team_ids', nextTeamId.value),
  ...Object.fromEntries(Object.entries(columns.value).filter(([, value]) => value !== '')),
}))
function exportSource() {
  const params = { ...filterParams.value, ...statusParams.value }
  return tableExportSource(
    '转料记录',
    total.value,
    globalTransferExportFields,
    (signal, progress) =>
      loadExportPages(
        (page, pageSize) => materialTransferApi.list({ ...params, page, page_size: pageSize }),
        signal,
        progress,
      ),
  )
}
const searchPlaceholder = computed(() =>
  searchFieldDraft.value !== 'all'
    ? `搜索${materialSearchFields.find((option) => option.value === searchFieldDraft.value)?.label}`
    : searchModeDraft.value === 'contains'
      ? '搜索编号、材质、班组或转料人'
      : '搜索批次号、流水号、原单批号、编号、客户代码或材质',
)

const drawerOpen = ref(false)
const groupOpen = ref(false)
const selectedDispatchNo = ref('')
const selected = ref<MaterialTransfer | null>(null)
const createOpen = ref(false)
let requestVersion = 0
let linkedBatchVersion = 0
let disposed = false

const hasRows = computed(() => rows.value.length > 0)
const canCreate = computed(
  () =>
    authStore.isTeamAccount &&
    Boolean(authStore.currentUser?.team_id) &&
    !authStore.currentUserError,
)
async function openCreate(): Promise<void> {
  try {
    await authStore.refreshCurrentUser()
    if (canCreate.value) createOpen.value = true
    else showToast('当前账号不能从此班组发出转料', 'error')
  } catch {
    showToast('账号信息刷新失败，请重试', 'error')
  }
}
watch(
  () =>
    `${authStore.currentUser?.id ?? ''}:${authStore.currentUser?.team_id ?? ''}:${authStore.isTeamAccount}`,
  () => {
    clearWorkspace()
    void loadRows()
    void loadCounts()
  },
)
const detailBusy = ref(false)
const filtersOpen = ref(false)
const appliedFilterCount = computed(
  () =>
    [
      dates.value.from || dates.value.to,
      urgentOnly.value,
      sourceTeamId.value,
      nextTeamId.value,
      materialType.value,
      status.value !== 'all',
      searchMode.value !== 'contains',
      searchField.value !== 'all',
      columns.value.serial_query,
      columns.value.material_query,
      columns.value.batch_query,
      columns.value.purpose_query,
      columns.value.quantity_min || columns.value.quantity_max,
      columns.value.weight_min || columns.value.weight_max,
    ].filter(Boolean).length,
)
const queryBeforeFilters = ref('')
function openFilters() {
  queryBeforeFilters.value = queryDraft.value
  syncFilterDrafts()
}
function cancelFilters() {
  syncFilterDrafts()
  queryDraft.value = queryBeforeFilters.value
}
function syncFilterDrafts() {
  dateDraft.value = { ...dates.value }
  urgentDraft.value = urgentOnly.value
  sourceTeamDraft.value = sourceTeamId.value
  nextTeamDraft.value = nextTeamId.value
  searchModeDraft.value = searchMode.value
  searchFieldDraft.value = searchField.value
  materialTypeDraft.value = materialType.value
  statusDraft.value = status.value
  columnDraft.value = { ...columns.value }
}
function applyDialogFilters() {
  if (quantityRangeInvalid.value || weightRangeInvalid.value) return
  applyFilters()
  filtersOpen.value = false
}
function clearFilterDrafts() {
  dateDraft.value = { from: '', to: '' }
  urgentDraft.value = false
  sourceTeamDraft.value = nextTeamDraft.value = ''
  searchModeDraft.value = 'contains'
  searchFieldDraft.value = 'all'
  materialTypeDraft.value = ''
  statusDraft.value = 'all'
  queryDraft.value = ''
  columnDraft.value = Object.fromEntries(columnKeys.map((key) => [key, ''])) as Record<
    ColumnKey,
    string
  >
}

function numberText(value: number, unit: string): string {
  return `${formatAmount(value)} ${unit}`
}

function asTransfer(row: unknown): MaterialTransfer {
  return row as MaterialTransfer
}

function traceLink(serialNo: string) {
  if (authStore.isTeamAccount && authStore.currentUser?.team_id)
    return {
      path: `/team-workspaces/${authStore.currentUser.team_id}`,
      query: { serial_no: serialNo, tab: 'history' },
    }
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

watch(
  () => JSON.stringify(filterParams.value),
  () => {
    statusCounts.value = null
    void loadCounts()
  },
)

function updateRoute(): void {
  void router.replace({
    path: route.path,
    query: {
      ...(dates.value.from ? { date_from: dates.value.from } : {}),
      ...(dates.value.to ? { date_to: dates.value.to } : {}),
      ...(urgentOnly.value ? { urgent_only: 'true' } : {}),
      ...(query.value ? { query: query.value } : {}),
      ...(searchMode.value !== 'contains' ? { search_mode: searchMode.value } : {}),
      ...(searchField.value !== 'all' ? { search_field: searchField.value } : {}),
      ...choiceParams('material_type', 'material_types', materialType.value),
      ...(status.value !== 'all' ? statusParams.value : {}),
      ...choiceParams('source_team_id', 'source_team_ids', sourceTeamId.value),
      ...choiceParams('next_team_id', 'next_team_ids', nextTeamId.value),
      ...Object.fromEntries(Object.entries(columns.value).filter(([, value]) => value !== '')),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
      ...(pageSize.value !== 10 ? { page_size: String(pageSize.value) } : {}),
    },
  })
}

async function loadRows(background = false): Promise<void> {
  const version = ++requestVersion
  if (!background) {
    loading.value = true
    summary.value = null
  }
  errorMessage.value = ''
  try {
    const result = await materialTransferApi.list({
      ...filterParams.value,
      ...statusParams.value,
      page: page.value,
      page_size: pageSize.value,
      include_summary: true,
    })
    if (disposed || version !== requestVersion) return
    rows.value = result.items
    total.value = result.total
    summary.value = result.summary ?? null
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

const liveRefresh = useLiveRefresh(
  async () => {
    // Wait for both requests, including on failure, before draining another event.
    const results = await Promise.allSettled([loadRows(true), loadCounts(true)])
    if (results.some((result) => result.status === 'rejected')) throw new Error('同步失败')
  },
  { busy: () => loading.value || countsLoading.value },
)

function applyFilters(): void {
  if (quantityRangeInvalid.value || weightRangeInvalid.value) return
  if (dates.value.from !== dateDraft.value.from || dates.value.to !== dateDraft.value.to)
    dates.value = { ...dateDraft.value }
  urgentOnly.value = urgentDraft.value
  query.value = queryDraft.value.trim()
  status.value = statusDraft.value
  sourceTeamId.value = sourceTeamDraft.value
  nextTeamId.value = nextTeamDraft.value
  searchMode.value = searchModeDraft.value
  searchField.value = searchFieldDraft.value
  materialType.value = materialTypeDraft.value
  columns.value = Object.fromEntries(
    Object.entries(columnDraft.value).map(([key, value]) => [key, value.trim()]),
  ) as Record<ColumnKey, string>
  page.value = 1
  updateRoute()
  void loadRows()
}

function applyColumn(
  key: ColumnKey | 'date' | 'source' | 'next' | 'type' | 'status',
  value: string,
  end = '',
) {
  if (key === 'date') dates.value = { from: value, to: end }
  else if (key === 'source') sourceTeamId.value = value
  else if (key === 'next') nextTeamId.value = value
  else if (key === 'type') materialType.value = value
  else if (key === 'status') status.value = value || 'all'
  else {
    columns.value = { ...columns.value, [key]: value }
    if (key === 'quantity_min') columns.value.quantity_max = end
    if (key === 'weight_min') columns.value.weight_max = end
  }
  syncFilterDrafts()
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
  summary.value = null
  statusCounts.value = null
  selected.value = null
  drawerOpen.value = false
  groupOpen.value = false
  selectedDispatchNo.value = ''
  createOpen.value = false
  detailBusy.value = false
  errorMessage.value = ''
}

watch(
  () => route.query,
  () => {
    const restored = readRouteFilters()
    const current = {
      page: page.value,
      pageSize: pageSize.value,
      query: query.value,
      dateFrom: dates.value.from,
      dateTo: dates.value.to,
      urgentOnly: urgentOnly.value,
      status: status.value,
      sourceTeamId: String(sourceTeamId.value),
      nextTeamId: String(nextTeamId.value),
      searchMode: searchMode.value,
      searchField: searchField.value,
      materialType: materialType.value,
      columns: columns.value,
    }
    if (JSON.stringify(restored) === JSON.stringify(current)) return
    page.value = restored.page
    pageSize.value = restored.pageSize
    dates.value = dateDraft.value = { from: restored.dateFrom, to: restored.dateTo }
    urgentOnly.value = urgentDraft.value = restored.urgentOnly
    query.value = queryDraft.value = restored.query
    status.value = statusDraft.value = restored.status
    sourceTeamId.value = sourceTeamDraft.value = restored.sourceTeamId
    nextTeamId.value = nextTeamDraft.value = restored.nextTeamId
    searchMode.value = searchModeDraft.value = restored.searchMode
    searchField.value = searchFieldDraft.value = restored.searchField
    materialType.value = materialTypeDraft.value = restored.materialType
    columns.value = { ...restored.columns }
    columnDraft.value = { ...restored.columns }
    void loadRows()
  },
)

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
      selectedDispatchNo.value = group.dispatch_no
      drawerOpen.value = false
      groupOpen.value = true
      return
    }
    const transfer = await materialTransferApi.get(batchNo)
    if (disposed || version !== linkedBatchVersion) return
    selected.value = transfer
    groupOpen.value = false
    drawerOpen.value = true
  } catch (error) {
    if (disposed || version !== linkedBatchVersion) return
    const message =
      error instanceof MaterialTransferApiError && error.status === 404
        ? `未找到转料单 ${batchNo}`
        : error instanceof Error
          ? error.message
          : '转料单查询失败'
    showToast(message, 'error')
  }
}

// Dashboard batch links still open documents; only the receiving page listens to scanners.
watch(
  () => route.query.batch_no,
  (batchNo) => {
    ++linkedBatchVersion
    if (typeof batchNo === 'string' && batchNo.trim())
      void openLinkedBatch(batchNo.trim().toUpperCase())
  },
  { immediate: true },
)

function updateTransfer(transfer: MaterialTransfer): void {
  const index = rows.value.findIndex((item) => item.batch_no === transfer.batch_no)
  if (index >= 0) rows.value.splice(index, 1, transfer)
  selected.value = transfer
  void loadRows()
  void loadCounts()
}

function handleCreated(transfer: MaterialTransfer): void {
  if (String(transfer.source_team.id) !== String(authStore.currentUser?.team_id)) {
    void loadRows()
    void loadCounts()
    return
  }
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
        <div class="page-heading-start">
          <PageBackButton />
          <h2 class="transfer-heading">转料记录</h2>
        </div>
        <div class="heading-actions">
          <TableExportButton
            :source="exportSource"
            :disabled="loading || !!errorMessage"
            :context="route.fullPath"
          />
          <ElButton v-if="canCreate" type="primary" :icon="Plus" @click="openCreate"
            >新建转料</ElButton
          >
        </div>
      </div>
      <ElCard class="transfers-card" shadow="never">
        <form class="filter-bar" @submit.prevent="applyFilters">
          <div class="search-fields">
            <ElInput
              v-model="queryDraft"
              clearable
              :placeholder="searchPlaceholder"
              aria-label="搜索转料记录"
              @clear="applyFilters"
            >
              <template #prefix
                ><ElIcon><Search /></ElIcon
              ></template>
              <template #suffix
                ><ElButton
                  v-if="queryDraft"
                  class="search-action"
                  text
                  :icon="Search"
                  aria-label="搜索"
                  native-type="submit"
              /></template>
            </ElInput>
          </div>
          <div class="filter-options">
            <FilterDialog
              v-model="filtersOpen"
              title="转料记录筛选"
              :count="appliedFilterCount"
              @open="openFilters"
              @cancel="cancelFilters"
              @apply="applyDialogFilters"
              @reset="clearFilterDrafts"
            >
              <label class="filter-wide"
                >搜索内容<ElInput
                  v-model="queryDraft"
                  aria-label="转料筛选搜索内容"
                  clearable
                  placeholder="输入流水号、批次号等"
              /></label>
              <label
                >搜索字段<ElSelect v-model="searchFieldDraft" aria-label="搜索字段"
                  ><ElOption
                    v-for="field in materialSearchFields"
                    :key="field.value"
                    :value="field.value"
                    :label="field.label" /></ElSelect
              ></label>
              <label
                >搜索方式<ElSelect v-model="searchModeDraft" aria-label="搜索方式"
                  ><ElOption
                    v-for="mode in materialSearchModes"
                    :key="mode.value"
                    :label="mode.label"
                    :value="mode.value" /></ElSelect
              ></label>
              <label>登记日期<RecordDateFilter v-model="dateDraft" /></label>
              <label
                >状态<ElSelect
                  v-model="statusChoices"
                  multiple
                  collapse-tags
                  clearable
                  aria-label="转料状态"
                  ><ElOption
                    v-for="option in statusOptions"
                    :key="option.value"
                    :value="option.value"
                    :label="`${option.label}（${statusCounts?.[option.value] ?? '—'}）`" /></ElSelect
                ><ElButton v-if="!countsLoading && !statusCounts" text @click="loadCounts()"
                  >重试加载状态数量</ElButton
                ></label
              >
              <label
                >物料类型<ElSelect
                  v-model="typeChoices"
                  multiple
                  collapse-tags
                  clearable
                  placeholder="全部物料类型"
                  aria-label="筛选物料类型"
                  ><ElOption
                    v-for="type in materialTypeOptions"
                    :key="type.value"
                    :label="type.label"
                    :value="type.value" /></ElSelect
              ></label>
              <label
                >转出班组<ElSelect
                  v-model="sourceChoices"
                  multiple
                  collapse-tags
                  clearable
                  filterable
                  placeholder="全部转出班组"
                  aria-label="转出班组"
                  ><ElOption
                    v-for="team in teamStore.items"
                    :key="team.id"
                    :label="team.name"
                    :value="String(team.id)" /></ElSelect
              ></label>
              <label
                >接收班组<ElSelect
                  v-model="nextChoices"
                  multiple
                  collapse-tags
                  clearable
                  filterable
                  placeholder="全部接收班组"
                  aria-label="接收班组"
                  ><ElOption
                    v-for="team in teamStore.items"
                    :key="team.id"
                    :label="team.name"
                    :value="String(team.id)" /></ElSelect
              ></label>
              <label
                >流水号关键词<ElInput v-model="columnDraft.serial_query" maxlength="160" clearable
              /></label>
              <label
                >材质关键词<ElInput v-model="columnDraft.material_query" maxlength="160" clearable
              /></label>
              <label
                >接收业务关键词<ElInput
                  v-model="columnDraft.purpose_query"
                  maxlength="160"
                  clearable
              /></label>
              <label
                >批次号关键词<ElInput v-model="columnDraft.batch_query" maxlength="160" clearable
              /></label>
              <label
                >数量范围
                <div class="transfer-filter-range" :class="{ 'is-invalid': quantityRangeInvalid }">
                  <ElInput
                    v-model="columnDraft.quantity_min"
                    inputmode="numeric"
                    placeholder="最少件数"
                    aria-label="最少件数"
                    :aria-invalid="quantityRangeInvalid"
                    clearable
                  /><span>至</span
                  ><ElInput
                    v-model="columnDraft.quantity_max"
                    inputmode="numeric"
                    placeholder="最多件数"
                    aria-label="最多件数"
                    :aria-invalid="quantityRangeInvalid"
                    clearable
                  /></div
              ></label>
              <label
                >重量范围 (kg)
                <div class="transfer-filter-range" :class="{ 'is-invalid': weightRangeInvalid }">
                  <ElInput
                    v-model="columnDraft.weight_min"
                    inputmode="decimal"
                    placeholder="最小重量"
                    aria-label="最小重量"
                    :aria-invalid="weightRangeInvalid"
                    clearable
                  /><span>至</span
                  ><ElInput
                    v-model="columnDraft.weight_max"
                    inputmode="decimal"
                    placeholder="最大重量"
                    aria-label="最大重量"
                    :aria-invalid="weightRangeInvalid"
                    clearable
                  /></div
              ></label>
              <ElCheckbox v-model="urgentDraft">仅看加急</ElCheckbox>
            </FilterDialog>
            <ElButton class="action-warm" native-type="submit">查询</ElButton>
            <div class="transfer-column-settings">
              <InventoryColumnSettings
                :storage-key="columnStorageKey"
                :columns="displayColumns"
                description="流水号、转出时间、批次号始终显示。仅保存在当前浏览器。"
                choices-label="转料记录可选列"
                @change="columnChoices = $event"
              />
            </div>
            <ElButton :icon="Refresh" aria-label="刷新转料记录" @click="liveRefresh.request" />
          </div>
        </form>
        <div
          v-loading="loading && hasRows"
          class="table-pane"
          :aria-busy="loading"
          element-loading-text="正在更新记录"
          element-loading-background="rgba(255, 255, 255, 0.72)"
        >
          <ElSkeleton
            v-if="loading && !hasRows"
            class="table-skeleton"
            :rows="8"
            animated
            aria-label="正在加载转料记录"
          />
          <StatePanel
            v-else-if="errorMessage"
            state="error"
            :description="errorMessage"
            @retry="loadRows"
          />
          <StatePanel
            v-else-if="!hasRows && !appliedFilterCount && !query"
            state="empty"
            title="暂无转料记录"
            description="请调整筛选条件。"
            ><ElButton v-if="canCreate" type="primary" plain :icon="Plus" @click="openCreate"
              >新建转料</ElButton
            ></StatePanel
          >
          <ElTable
            v-else
            :data="rows"
            class="business-table transfer-table"
            border
            row-key="batch_no"
            empty-text="暂无转料记录"
            :current-row-key="drawerOpen ? selected?.batch_no : undefined"
            highlight-current-row
            @row-click="openDetail"
          >
            <ElTableColumn label="流水号" min-width="220" align="center" show-overflow-tooltip
              ><template #header
                ><TableColumnFilter
                  label="流水号"
                  :context="route.fullPath"
                  :value="columns.serial_query"
                  @apply="(value) => applyColumn('serial_query', value)" /></template
              ><template #default="{ row }"
                ><div class="transfer-serial">
                  <RouterLink class="serial-number" :to="traceLink(row.serial_no)" @click.stop>{{
                    sharedSerialLabel(row)
                  }}</RouterLink
                  ><SerialUrgencyBadge :urgency="row.urgency" @click.stop /></div></template
            ></ElTableColumn>
            <ElTableColumn label="转出时间" min-width="180" align="center"
              ><template #header
                ><TableColumnFilter
                  label="转出时间"
                  :context="route.fullPath"
                  kind="date"
                  :value="dates.from"
                  :end="dates.to"
                  @apply="(value, end) => applyColumn('date', value, end)" /></template
              ><template #default="{ row }"
                ><time class="transfer-time" :title="formatDateTime(row.transferred_at)">{{
                  formatDateTime(row.transferred_at)
                }}</time></template
              ></ElTableColumn
            >
            <ElTableColumn
              v-for="column in visibleColumns"
              :key="column.key"
              :label="column.label"
              :min-width="column.minWidth"
              :class-name="column.className"
              align="center"
              :show-overflow-tooltip="!['quantity', 'weight', 'status'].includes(column.key)"
            >
              <template #header>
                <TableColumnFilter
                  v-if="column.key === 'material'"
                  label="材质"
                  :context="route.fullPath"
                  :value="columns.material_query"
                  @apply="(value) => applyColumn('material_query', value)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'source'"
                  label="来源"
                  :context="route.fullPath"
                  kind="select"
                  :value="String(sourceTeamId)"
                  :options="teamOptions"
                  @apply="(value) => applyColumn('source', value)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'destination'"
                  label="去向"
                  :context="route.fullPath"
                  kind="select"
                  :value="String(nextTeamId)"
                  :options="teamOptions"
                  @apply="(value) => applyColumn('next', value)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'purpose'"
                  label="接收业务"
                  :context="route.fullPath"
                  :value="columns.purpose_query"
                  @apply="(value) => applyColumn('purpose_query', value)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'material_type'"
                  label="物料类型"
                  :context="route.fullPath"
                  kind="select"
                  :value="materialType"
                  :options="materialTypeOptions"
                  @apply="(value) => applyColumn('type', value)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'quantity'"
                  label="数量"
                  :context="route.fullPath"
                  kind="number"
                  integer
                  :value="columns.quantity_min"
                  :end="columns.quantity_max"
                  @apply="(value, end) => applyColumn('quantity_min', value, end)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'weight'"
                  label="重量"
                  :context="route.fullPath"
                  kind="number"
                  :value="columns.weight_min"
                  :end="columns.weight_max"
                  @apply="(value, end) => applyColumn('weight_min', value, end)"
                />
                <TableColumnFilter
                  v-else-if="column.key === 'status'"
                  label="状态"
                  :context="route.fullPath"
                  kind="select"
                  :value="status === 'all' ? '' : status"
                  :options="columnStatusOptions"
                  @apply="(value) => applyColumn('status', value)"
                />
                <span v-else>{{ column.label }}</span>
              </template>
              <template #default="{ row }">
                <template v-if="column.key === 'quantity'">{{
                  numberText(row.quantity, row.quantity_unit)
                }}</template>
                <template v-else-if="column.key === 'weight'">{{
                  numberText(row.weight, row.weight_unit)
                }}</template>
                <MaterialTransferStatus
                  v-else-if="column.key === 'status'"
                  :status="row.status"
                  :entry-kind="row.entry_kind"
                  plain
                />
                <template v-else>{{ column.value(asTransfer(row)) }}</template>
              </template>
            </ElTableColumn>
            <ElTableColumn label="批次号" min-width="210" align="center" show-overflow-tooltip
              ><template #header
                ><TableColumnFilter
                  label="批次号"
                  :context="route.fullPath"
                  :value="columns.batch_query"
                  @apply="(value) => applyColumn('batch_query', value)"
              /></template>
              <template #default="{ row }"
                ><ElButton
                  text
                  class="batch-link"
                  :aria-label="'查看转料单 ' + row.batch_no"
                  @click.stop="openDetail(asTransfer(row))"
                  >{{ row.batch_no }}</ElButton
                ></template
              >
            </ElTableColumn>
          </ElTable>
          <div v-if="hasRows" class="transfer-mobile-list">
            <ElButton
              v-for="transfer in rows"
              :key="transfer.batch_no"
              text
              class="transfer-mobile-row"
              @click="openDetail(transfer)"
            >
              <span class="mobile-row-head"
                ><strong>{{ sharedSerialLabel(transfer) }}</strong
                ><MaterialTransferStatus
                  :status="transfer.status"
                  :entry-kind="transfer.entry_kind"
                  plain
              /></span>
              <time class="transfer-time" :title="formatDateTime(transfer.transferred_at)">{{
                formatDateTime(transfer.transferred_at)
              }}</time>
              <span class="mobile-transfer-parties"
                ><span
                  ><small>来源</small><span>{{ materialSourceLabel(transfer) }}</span></span
                ><span
                  ><small>去向</small><span>{{ transfer.next_team.name }}</span></span
                ><span
                  ><small>接收业务</small><span>{{ materialPurposeLabel(transfer) }}</span></span
                ></span
              >
              <span class="mobile-material-brief"
                >{{ materialTypeLabel(transfer.material_type)
                }}<template v-if="transfer.material_name">
                  · {{ transfer.material_name }}</template
                ></span
              >
              <span class="mobile-row-meta"
                ><span
                  >{{ numberText(transfer.quantity, transfer.quantity_unit) }} ·
                  {{ numberText(transfer.weight, transfer.weight_unit) }}</span
                ><span>{{ transfer.batch_no }}</span></span
              >
            </ElButton>
          </div>
        </div>
        <div
          v-if="!errorMessage"
          class="transfer-summary"
          aria-label="全部筛选结果汇总"
          :aria-busy="loading"
        >
          <span class="summary-caption">全部筛选合计</span>
          <div
            v-for="state in summaryStates"
            :key="state.key"
            class="summary-group"
            :data-status="state.key"
          >
            <span class="summary-status">{{ state.label }}</span>
            <span class="summary-amount"
              ><small>件数</small><strong>{{ formatAmount(summary?.[state.key].quantity) }}</strong
              ><small>件</small></span
            >
            <span class="summary-amount"
              ><small>重量</small><strong>{{ formatAmount(summary?.[state.key].weight) }}</strong
              ><small>kg</small></span
            >
          </div>
        </div>
        <footer v-if="!errorMessage" class="pagination-bar">
          <span>共 {{ total }} 条</span
          ><ElPagination
            background
            layout="sizes, prev, pager, next"
            :total="total"
            :current-page="page"
            :page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            @current-change="setPage"
            @size-change="setPageSize"
          />
        </footer>
      </ElCard>
    </div>
    <MaterialDispatchDrawer
      v-model="groupOpen"
      :dispatch-no="selectedDispatchNo"
      @changed="
        () => {
          loadRows()
          loadCounts()
        }
      "
      @busy-change="detailBusy = $event"
    />
    <MaterialTransferDrawer
      v-model="drawerOpen"
      :batch-no="selected?.batch_no"
      :transfer="selected"
      @changed="updateTransfer"
      @busy-change="detailBusy = $event"
    />
    <MaterialTransferFormDialog v-model="createOpen" @saved="handleCreated" />
  </section>
</template>

<style scoped>
.transfer-filter-range.is-invalid :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
.transfer-filter-range {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mobile-material-brief {
  display: block;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}
.transfers-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  padding: 20px 24px;
  gap: 16px 0;
  background: var(--workspace-bg);
}
.status-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.status-toolbar h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.heading-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  align-items: center;
}
.transfers-card {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--card-radius);
  background: var(--surface);
  box-shadow: var(--glass-shadow);
}
.transfers-card :deep(.el-card__body) {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 0;
  flex-direction: column;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 0 0 auto;
  min-height: 60px;
  padding: 12px;
  gap: 8px 12px;
  border-bottom: 1px solid var(--line-light);
}
.search-fields {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 470px;
  min-width: 0;
}
.search-fields > .el-input {
  flex: 1;
  min-width: 0;
}
.filter-options {
  display: flex;
  align-items: center;
  gap: 4px;
}
.transfer-column-settings {
  display: flex;
}
.filter-bar :deep(.el-input__prefix-inner) {
  margin-right: 8px;
  font-size: 18px;
}
.filter-bar > .el-button {
  margin: 0;
}
.search-action {
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--subtle);
}
.table-pane {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.table-skeleton {
  padding: 24px;
}
.table-skeleton :deep(.el-skeleton__p) {
  height: 24px;
  margin-top: 24px;
}
.transfer-table {
  font-size: 16px;
}
.transfer-table :deep(.el-table__row) {
  cursor: pointer;
}
.transfers-page .transfer-table :deep(th.el-table__cell) {
  height: 42px;
  padding-block: 10px;
}
.transfers-page .transfer-table :deep(.el-table__body td.el-table__cell) {
  height: 48px;
  padding-block: 10px;
}
.transfer-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}
.transfers-page .transfer-table :deep(.cell) {
  padding-inline: 12px;
  line-height: 22px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.transfer-time {
  color: var(--muted);
  font-size: 14px;
  white-space: nowrap;
}
.transfer-serial {
  justify-content: center;
}
.transfers-page .transfer-table :deep(.transfer-status-text) {
  font-size: 14px;
}
.transfers-page .transfer-table :deep(.transfer-status-text--pending) {
  color: var(--el-color-warning-dark-2);
}
.transfers-page .transfer-table :deep(.transfer-status-text--received),
.transfers-page .transfer-table :deep(.transfer-status-text--dispatched) {
  color: var(--el-color-success);
}
.batch-link {
  justify-content: flex-start;
  height: auto;
  min-height: 20px;
  padding: 0 !important;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.serial-number {
  color: var(--subtle);
  font-size: 12px;
}
.serial-number:hover {
  color: var(--primary);
  text-decoration: underline;
}
.transfer-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px 24px;
  padding: 10px 16px;
  border-top: 1px solid var(--line-light);
  font-size: 13px;
}
.summary-caption,
.summary-amount small {
  color: var(--subtle);
  font-size: inherit;
}
.summary-group {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 16px;
}
.summary-status {
  color: var(--primary);
  font-weight: 500;
}
.summary-group[data-status='pending'] .summary-status {
  color: var(--el-color-warning-dark-2);
}
.summary-amount {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}
.summary-amount strong {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  min-height: 56px;
  padding: 12px 16px;
  gap: 12px;
  border-top: 1px solid var(--line-light);
  color: var(--subtle);
  font-size: 13px;
}
.transfer-mobile-list {
  display: none;
}
@container workspace (max-width: 760px) {
  .status-toolbar {
    flex-wrap: wrap;
    gap: 8px;
  }
  .status-toolbar .heading-actions {
    margin-left: auto;
  }
  .transfer-table,
  .transfer-column-settings {
    display: none;
  }
  .table-pane {
    overflow-y: auto;
  }
  .transfer-mobile-list {
    display: block;
  }
  .transfer-mobile-row {
    display: block;
    width: 100%;
    height: auto;
    min-height: 132px;
    margin: 0;
    padding: 16px 8px;
    border-bottom: 1px solid var(--line-light);
    border-radius: 0;
    text-align: left;
  }
  .transfer-mobile-row :deep(> span) {
    display: grid;
    width: 100%;
    gap: 12px;
  }
  .mobile-row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .mobile-row-head strong {
    overflow: hidden;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    text-overflow: ellipsis;
  }
  .mobile-row-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    color: var(--subtle);
    font-size: 12px;
  }
  .mobile-transfer-parties {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    color: var(--reading-ink);
    font-size: 16px;
  }
  .mobile-transfer-parties > span {
    display: grid;
    gap: 4px;
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .mobile-transfer-parties small {
    color: var(--reading-muted);
    font-size: 14px;
  }
  .pagination-bar {
    flex-wrap: wrap;
    padding-inline: 4px;
  }
}
@container workspace (max-width: 480px) {
  .search-fields {
    flex-basis: 100%;
  }
  .filter-options {
    width: 100%;
  }
}
@media (max-width: 1100px) {
  .transfers-page {
    padding: 14px;
    gap: 10px 0;
  }
}
@media (max-width: 640px) {
  .transfers-page {
    padding: 12px;
    row-gap: 10px;
  }
  .heading-actions {
    width: 100%;
    gap: 10px;
  }
  .heading-actions :deep(.el-button) {
    height: 40px;
    padding-inline: 14px;
    font-size: 14px;
  }
  .transfers-main {
    gap: 14px;
  }
  .transfers-card :deep(.el-card__body) {
    padding-inline: 10px;
  }
  .pagination-bar {
    gap: 5px;
  }
  .pagination-bar :deep(.el-pagination__sizes) {
    margin-right: 3px;
  }
}
</style>

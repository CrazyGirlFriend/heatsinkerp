<script setup lang="ts">
import { useTableQuery } from '@/composables/useTableQuery'
import { useInventorySchedules } from '@/composables/useInventorySchedules'
import { useBatchSelection } from '@/composables/useBatchSelection'
import { inventoryQueryColumns } from '@/utils/tableQueryColumns'
import ElAlert from '@/components/AppAlert.vue'
import ElDatePicker from '@/components/AppDatePicker.vue'
import ElInput from '@/components/AppInput.vue'
import ElSelect from '@/components/AppSelect.vue'
import WorkspaceDataPanel from './WorkspaceDataPanel.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Operation, Search } from '@element-plus/icons-vue'
import { ElCheckbox, ElOption, ElOptionGroup, ElTableColumn, ElTag, ElTooltip } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import FilterDialog from './FilterDialog.vue'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import InventoryScheduleDetails from './InventoryScheduleDetails.vue'
import InventoryPendingDialog from './InventoryPendingDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StockSourcePicker from './StockSourcePicker.vue'
import InventoryShipmentDialog from './InventoryShipmentDialog.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import {
  inventoryProcessingStateOptions,
  stockProcessingState,
  processingStateLabels,
  processingRoleLabels,
} from '@/types/materialProcessing'
import StatePanel from './StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import {
  materialTypeLabel,
  materialTypeOptions,
  isScrapType as isScrapMaterialType,
  isWeightOnlyType,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import {
  warehouseColumns,
  warehouseLegacyColumnKeys,
  warehousePreviousDefaults,
  warehouseSearchColumns,
  warehouseSearchKind,
  warehouseSerialColumn,
  inventorySourceLabel,
  warehouseSourceNames,
  inventoryAmount,
  inventoryDispatchable,
  inventoryCanDispatch,
  inventoryHasPending,
  type WarehouseColumnKey,
  type TeamInventoryParams,
  type TeamInventoryRow,
  type WarehouseSearchField,
  type WarehouseSource,
} from '@/types/teamInventory'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import type { CalendarRange } from '@/types/recordFilters'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'
import type { TeamPurpose } from '@/types/teamBusiness'
import type { AgeBand } from '@/types/materialAnalytics'
import { formatDateTime } from '@/utils/format'
import { stockSelectable } from '@/utils/materialStock'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { inventoryScheduleBaseline, inventoryScheduleTone } from '@/utils/inventorySchedule'
import { scheduleBatchSearch } from '@/utils/scheduleBatch'

const columnSettings = ref<{ open: (anchor?: HTMLElement) => void }>()
const WarehouseReceiptDialog = defineAsyncComponent(() => import('./WarehouseReceiptDialog.vue'))
const props = defineProps<{
  teamId: number
  overview: TeamMaterialOverview
  canWrite?: boolean
  canReallocate?: boolean
  warehouse?: boolean
  fullscreen?: boolean
  processing?: boolean
  inspection?: boolean
  processingLoadingGroupId?: number
}>()
const emit = defineEmits<{
  changed: []
  refresh: []
  action: [mode: 'dispatch', sources: StockBatch[]]
  reallocate: [source: StockBatch]
  process: [groupId: number]
}>()
const route = useRoute(),
  router = useRouter(),
  auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const text = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() =>
  [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10,
)
const rows = ref<TeamInventoryRow[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref(''),
  refreshError = ref('')
const asOf = ref('')
const batchSelection = useBatchSelection(
  rows,
  (row) => String(row.group_id),
  (row) =>
    row.batch_count === 1 &&
    !row.inspection_hold_count &&
    (inventoryCanDispatch(row) || (props.processing === true && !!processingAction(row))),
)
const preparingDispatch = ref(false)
watch(rows, batchSelection.reconcile)
const expandedScheduleGroups = ref<number[]>([])
const {
  loading: scheduleLoading,
  error: scheduleError,
  load: loadSchedules,
  reset: resetSchedules,
  withSchedules,
} = useInventorySchedules(
  rows,
  () => props.teamId,
  'groups',
  (row) => ({
    id: row.group_id,
    materialType: row.material_type,
  }),
)
let scheduleClock: ReturnType<typeof setInterval> | undefined
function refreshVisibleSchedules() {
  if (document.hidden || loading.value || scheduleLoading.value || picker.value || pending.value)
    return
  void loadSchedules()
}
function syncScheduleClock(refresh = false) {
  clearInterval(scheduleClock)
  scheduleClock = undefined
  if (document.hidden) return
  if (refresh) refreshVisibleSchedules()
  scheduleClock = setInterval(refreshVisibleSchedules, 60_000)
}
function resumeScheduleClock() {
  syncScheduleClock(true)
}
function toggleSchedule(row: TeamInventoryRow) {
  if (!row.delivery_schedule?.count) return
  expandedScheduleGroups.value = expandedScheduleGroups.value.includes(row.group_id)
    ? []
    : [row.group_id]
}
function viewSchedule(id?: number, serialNo?: string) {
  void router.push({
    path: route.path,
    query: {
      tab: 'delivery-schedule',
      ...(id ? { schedule_id: String(id) } : {}),
      ...(serialNo ? { serial_no: serialNo } : {}),
    },
  })
}
const queryDraft = ref(''),
  sourceDraft = ref<WarehouseSource | ''>(''),
  typeDraft = ref(''),
  materialDraft = ref('')
const fieldDraft = ref<WarehouseSearchField>('all'),
  operatorDraft = ref<'eq' | 'gte' | 'lte'>('eq'),
  inputError = ref('')
const reworkDraft = ref<'pending' | 'worked' | ''>('')
const availabilityDraft = ref<TeamInventoryParams['availability']>('current'),
  sourceTeamDraft = ref<number | undefined>()
const purposeDraft = ref<number | undefined>(),
  purposes = ref<TeamPurpose[]>([]),
  purposesLoading = ref(false),
  purposesError = ref('')
let purposeVersion = 0
async function loadPurposes() {
  const current = ++purposeVersion
  purposesError.value = ''
  if (props.warehouse) {
    purposesLoading.value = false
    return
  }
  purposesLoading.value = true
  try {
    const result = await teamMaterialApi.purposes(props.teamId)
    if (current === purposeVersion) purposes.value = result
  } catch {
    if (current === purposeVersion) purposesError.value = '加工任务选项加载失败，请重试。'
  } finally {
    if (current === purposeVersion) purposesLoading.value = false
  }
}
const filtersOpen = ref(false),
  filterResetRequested = ref(false)
const dateDraft = ref<CalendarRange>({ from: '', to: '' }),
  locationDraft = ref(false),
  analysisDraft = ref(''),
  daysDraft = ref<7 | 30>(30)
const processingStateDraft = ref<TeamInventoryParams['processing_state']>()
const routeStatusDraft = ref<TeamInventoryParams['route_status']>()
const processingStates = { ...processingStateLabels, mixed: '部分批次有加工记录' }
const processingStateOptions = [
  ...inventoryProcessingStateOptions,
  { value: 'mixed', label: processingStates.mixed },
]
watch(typeDraft, (value) => {
  if (isScrapMaterialType(value)) processingStateDraft.value = undefined
})
const filterCount = computed(
  () =>
    activeFilters.value.length +
    Number(Boolean(searchedColumn.value)) +
    Number(Boolean(dates.value.from || dates.value.to)) +
    Number(Boolean(analysisChoice.value)),
)
const searchKind = computed(() => warehouseSearchKind(fieldDraft.value))
const searchTerm = computed(() =>
  fieldDraft.value === 'task_batch_number'
    ? scheduleBatchSearch(queryDraft.value)
    : queryDraft.value.trim(),
)
const days = computed<7 | 30>(() => (text('days') === '7' ? 7 : 30))
const ages: [AgeBand, string][] = [
  ['lt1', '不足1天'],
  ['1_3', '1–3天'],
  ['3_7', '3–7天'],
  ['ge7', '7天及以上'],
]
const analysisChoice = computed(() =>
  text('stock_age')
    ? `age:${text('stock_age')}`
    : text('waiting_direction')
      ? `${text('waiting_direction')}:${text('waiting_age')}`
      : text('has_loss') === 'true'
        ? 'loss'
        : '',
)
const analysisLabel = computed(
  () =>
    text('filter_label') ||
    (text('stock_age')
      ? `库存停留：${ages.find(([key]) => key === text('stock_age'))?.[1] || text('stock_age')}`
      : text('waiting_direction')
        ? `${text('waiting_direction') === 'incoming' ? '来料待签收' : '转出待确认'}：${ages.find(([key]) => key === text('waiting_age'))?.[1] || ''}`
        : text('has_loss') === 'true'
          ? `近${days.value}天有丢失记录`
          : ''),
)
const dates = computed(() => ({
  from: text('date_from') || text('activity_day'),
  to: text('date_to') || text('activity_day'),
}))
const sourceOptions = computed(() =>
  Object.entries(warehouseSourceNames).filter(([key]) => props.processing || key !== 'processing'),
)
const sourceTeams = computed(() => directory.items.filter((team) => team.id !== props.teamId))
const sourceLabel = (row: TeamInventoryRow) => inventorySourceLabel(row, props.warehouse)
const columns = computed(() =>
  warehouseColumns
    .filter(
      (column) =>
        !['processing_role', 'owned_quantity', 'owned_weight'].includes(column.key) &&
        (!props.warehouse || column.key !== 'purpose_name') &&
        (props.warehouse || column.key !== 'warehouse_location') &&
        (column.key !== 'process_route' || props.processing),
    )
    .map((column) => ({
      ...column,
      label:
        props.processing && column.key === 'stock_status'
          ? '加工状态'
          : column.key === 'source'
            ? props.warehouse
              ? '来源'
              : '上序班组'
            : column.label,
      width:
        (
          {
            batch_no: 245,
            material_name: 120,
            material_type: 110,
            transfer_specification: 155,
            purpose_name: 120,
            source: 120,
            on_hand_quantity: 110,
            on_hand_weight: 120,
            stock_status: 135,
            process_route: 150,
          } as Partial<Record<WarehouseColumnKey, number>>
        )[column.key] || column.width,
      format: (row: TeamInventoryRow) =>
        column.key === 'source'
          ? sourceLabel(row)
          : column.key === 'stock_status' && props.processing
            ? isScrapMaterialType(row.material_type)
              ? '—'
              : row.processing_state && row.processing_state !== 'not_required'
                ? processingStates[row.processing_state]
                : column.format(row)
            : column.format(row),
    })),
)
const requiredColumnKeys = computed(() =>
  props.processing
    ? ['batch_no', 'on_hand_quantity', 'process_route', 'rework', 'stock_status', 'material_name']
    : props.warehouse
      ? ['batch_no', 'warehouse_location', 'on_hand_quantity', 'material_name']
      : ['batch_no', 'on_hand_quantity', 'material_name'],
)
const selectableColumns = computed(() =>
  columns.value.filter((column) => !requiredColumnKeys.value.includes(column.key)),
)
const searchColumns = computed(() =>
  warehouseSearchColumns
    .filter((column) => !['owned_quantity', 'owned_weight'].includes(column.key))
    .filter((column) => !props.warehouse || column.key !== 'purpose_name')
    .filter((column) => props.warehouse || column.key !== 'warehouse_location')
    .map((column) =>
      column.key === 'source'
        ? { ...column, label: props.warehouse ? '来源' : '上序班组' }
        : column,
    ),
)
const fixedColumns = ref<string[] | null>(null)
const fixedColumnOptions = ref<{ key: string; label: string }[]>([])
const columnChoices = ref<InventoryColumnChoice<WarehouseColumnKey>[]>(
  warehouseColumns
    .filter((column) => column.key !== 'material_name')
    .map((column) => ({ key: column.key, visible: column.defaultVisible })),
)
const storageKey = computed(() =>
  auth.currentUser?.id
    ? `heatsink.${props.warehouse ? 'warehouse' : 'classified'}-columns.v1:${auth.currentUser.id}:${props.teamId}`
    : null,
)
const searchedColumn = computed(() =>
  text('query').trim()
    ? searchColumns.value
        .filter((column) => 'format' in column)
        .find((column) => column.key === text('search_field'))
    : undefined,
)
const visibleColumns = computed(() => {
  const saved = [
    columns.value.find((column) => column.key === 'batch_no')!,
    { ...warehouseSerialColumn, width: 200 },
    ...(columnChoices.value.some((choice) => choice.key === 'task_batch_number' && choice.visible)
      ? [columns.value.find((column) => column.key === 'task_batch_number')!]
      : []),
    ...requiredColumnKeys.value
      .filter((key) => key !== 'batch_no')
      .map((key) => columns.value.find((column) => column.key === key)!),
    ...columnChoices.value
      .filter(
        (choice) =>
          choice.visible &&
          choice.key !== 'task_batch_number' &&
          !requiredColumnKeys.value.includes(choice.key) &&
          columns.value.some((column) => column.key === choice.key),
      )
      .map((choice) => columns.value.find((column) => column.key === choice.key)!),
  ]
  return searchedColumn.value
    ? [searchedColumn.value, ...saved.filter((column) => column.key !== searchedColumn.value!.key)]
    : saved
})
const separateSpecification = computed(() =>
  visibleColumns.value.some((column) => column.key === 'transfer_specification'),
)
const hasPending = computed(() => rows.value.some(inventoryHasPending))
const actionWidth = computed(
  () =>
    32 +
    (props.canWrite ? 42 : 0) +
    (hasPending.value ? 72 : 0) +
    (props.processing && props.canWrite ? 64 : 0) +
    (props.inspection && props.canWrite ? 80 : 0) +
    (props.canWrite && props.canReallocate ? 48 : 0) +
    (props.warehouse && props.canWrite && rows.value.some((row) => row.receipt_editable) ? 80 : 0),
)
function ownershipHint(row: TeamInventoryRow) {
  const available = inventoryDispatchable(row)
  const external =
    Number(row.external_pending_quantity) > 0 || Number(row.external_pending_weight) > 0
  const amount = (quantity: number | null | undefined, weight: number | null | undefined) =>
    `${isWeightOnlyType(row.material_type) ? '' : `${inventoryAmount(quantity)} 件 / `}${inventoryAmount(weight)} kg`
  return `当前剩余 ${amount(row.on_hand_quantity, row.on_hand_weight)}\n转出待签收 ${amount(row.in_transit_quantity, row.in_transit_weight)}${external ? `\n对外待确认 ${amount(row.external_pending_quantity, row.external_pending_weight)}` : ''}\n${isScrapMaterialType(row.material_type) ? '可处理量' : '可转出量'} ${amount(available.quantity, available.weight)}`
}
const tableQuery = useTableQuery(
  inventoryQueryColumns,
  () => {
    if (page.value !== 1) apply({ ...filters.value, page: 1 })
  },
  (table_query) =>
    teamMaterialApi.inventoryFilterOptions(props.teamId, { ...filters.value, table_query }),
)
const filters = computed<TeamInventoryParams>(() => {
  const params: Record<string, string | number | boolean> = {
    page: page.value,
    page_size: pageSize.value,
    availability: ['current', 'owned', 'all', 'available', 'scrap'].includes(text('availability'))
      ? text('availability')
      : 'current',
  }
  for (const key of [
    'query',
    'search_field',
    'search_operator',
    'serial_no',
    'material_name',
    'material_type',
    'source_team_id',
    'date_from',
    'date_to',
    'stock_age',
    'waiting_age',
    'waiting_direction',
    'activity_day',
    'activity_kind',
    'flow_direction',
    'peer',
    'days',
  ])
    if (text(key)) params[key] = text(key)
  if (
    params.search_field === 'urgency' ||
    (props.warehouse && params.search_field === 'purpose_name')
  ) {
    delete params.query
    delete params.search_field
    delete params.search_operator
  }
  if (text('rework')) params.rework = text('rework')
  for (const key of ['processing_state', 'processing_role', 'route_status'])
    if (text(key)) params[key] = text(key)
  if (props.warehouse && text('receipt_source')) params.receipt_source = text('receipt_source')
  if (props.warehouse && text('location_status') === 'unassigned')
    params.location_status = 'unassigned'
  if (!props.warehouse && text('purpose_id')) params.purpose_id = Number(text('purpose_id'))
  if (text('source_team_id')) params.source_team_id = Number(text('source_team_id'))
  if (text('has_loss') === 'true') params.has_loss = true
  return { ...params, ...tableQuery.params.value } as TeamInventoryParams
})
function exportSource() {
  const id = props.teamId,
    params = { ...filters.value }
  const fields = [
    columns.value.find((column) => column.key === 'batch_no')!,
    warehouseSerialColumn,
    ...columns.value.filter(
      (column) => column.key !== 'batch_no' && !column.key.startsWith('shortage_'),
    ),
  ].map((column) => ({
    key: column.key,
    label: column.label,
    selected:
      column.key === 'material_name' ||
      visibleColumns.value.some((item) => item.key === column.key),
    value: (row: TeamInventoryRow) => {
      const value = column.format(row)
      if (value === '—') return null
      const numeric =
        'numeric' in column && column.numeric ? Number(value.replaceAll(',', '')) : NaN
      return Number.isFinite(numeric) ? numeric : value
    },
  }))
  return tableExportSource('库存明细', total.value, fields, (signal, progress) =>
    loadExportPages(
      async (page, pageSize) => {
        const result = await teamMaterialApi.teamInventory(id, {
          ...params,
          page,
          page_size: pageSize,
        })
        return { ...result, items: await withSchedules(result.items, id) }
      },
      signal,
      progress,
    ),
  )
}
defineExpose({ exportSource, dispatchSelected, clearBatchSelection, preparingDispatch })
const activeFilters = computed(() => {
  const chips: { key: keyof TeamInventoryParams; label: string }[] = []
  if (props.warehouse && text('location_status'))
    chips.push({ key: 'location_status', label: '有未分配仓位的物料' })
  if (props.warehouse && text('receipt_source'))
    chips.push({
      key: 'receipt_source',
      label: `来源：${warehouseSourceNames[text('receipt_source') as WarehouseSource] || text('receipt_source')}`,
    })
  if (filters.value.processing_state)
    chips.push({
      key: 'processing_state',
      label:
        processingStates[filters.value.processing_state as keyof typeof processingStates] ||
        '无需加工',
    })
  if (filters.value.processing_role)
    chips.push({
      key: 'processing_role',
      label: processingRoleLabels[filters.value.processing_role],
    })
  if (filters.value.route_status)
    chips.push({
      key: 'route_status',
      label: filters.value.route_status === 'linked' ? '已关联工艺' : '未关联工艺',
    })
  if (text('rework'))
    chips.push({ key: 'rework', label: text('rework') === 'pending' ? '待返工' : '有返工历史' })
  if (text('source_team_id'))
    chips.push({
      key: 'source_team_id',
      label: `${props.warehouse ? '来源' : '上序'}：${sourceTeams.value.find((team) => team.id === Number(text('source_team_id')))?.name || text('source_team_id')}`,
    })
  if (text('material_type'))
    chips.push({
      key: 'material_type',
      label: `类型：${text('material_type') === 'unknown' ? '未分类' : materialTypeLabel(text('material_type'))}`,
    })
  if (text('material_name'))
    chips.push({ key: 'material_name', label: `材质：${text('material_name')}` })
  if (!props.warehouse && text('purpose_id'))
    chips.push({
      key: 'purpose_id',
      label: `加工任务：${text('purpose_id') === '0' ? '未指定任务' : purposes.value.find((purpose) => purpose.id === Number(text('purpose_id')))?.name || text('purpose_id')}`,
    })
  const availabilityLabels = {
    owned: '含已转出待确认',
    available: '正常料可转出',
    scrap: '废料可处理',
    all: '全部（含零库存）',
  }
  if (filters.value.availability && filters.value.availability !== 'current')
    chips.push({ key: 'availability', label: availabilityLabels[filters.value.availability] })
  return chips
})
function apply(params: TeamInventoryParams = {}, label = text('filter_label')) {
  void router.replace({
    path: route.path,
    query: {
      tab: 'stock',
      ...(label ? { filter_label: label } : {}),
      ...Object.fromEntries(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => [key, String(value)]),
      ),
    },
  })
}
function selectAnalysis(value: string) {
  if (!validSearch()) return
  const [kind, age] = value.split(':')
  apply(
    {
      ...draftFilters(),
      stock_age: kind === 'age' ? (age as AgeBand) : undefined,
      waiting_direction: kind === 'incoming' || kind === 'outgoing' ? kind : undefined,
      waiting_age: kind === 'incoming' || kind === 'outgoing' ? (age as AgeBand) : undefined,
      has_loss: kind === 'loss' || undefined,
      activity_day: undefined,
      activity_kind: undefined,
      flow_direction: undefined,
      peer: undefined,
    },
    '',
  )
}
function draftFilters(): TeamInventoryParams {
  const query = searchTerm.value
  return {
    ...(filterResetRequested.value ? { page_size: pageSize.value } : filters.value),
    page: 1,
    query: query || undefined,
    search_field: query && fieldDraft.value !== 'all' ? fieldDraft.value : undefined,
    search_operator: query && searchKind.value === 'number' ? operatorDraft.value : undefined,
    rework: reworkDraft.value || undefined,
    processing_state: isScrapMaterialType(typeDraft.value)
      ? undefined
      : processingStateDraft.value || undefined,
    processing_role:
      isScrapMaterialType(typeDraft.value) || filterResetRequested.value
        ? undefined
        : filters.value.processing_role,
    route_status: routeStatusDraft.value || undefined,
    receipt_source: props.warehouse ? sourceDraft.value || undefined : undefined,
    source_team_id:
      !props.warehouse || sourceDraft.value === 'internal' ? sourceTeamDraft.value : undefined,
    purpose_id:
      !props.warehouse && typeof purposeDraft.value === 'number' ? purposeDraft.value : undefined,
    material_type: typeDraft.value || undefined,
    material_name: materialDraft.value || undefined,
    availability: availabilityDraft.value,
  }
}
function validSearch() {
  inputError.value = ''
  if (queryDraft.value.trim() && searchKind.value === 'number') {
    const term = searchTerm.value,
      value = Number(term)
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1e15 ||
      !(fieldDraft.value.endsWith('weight') ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(term)
    ) {
      inputError.value =
        fieldDraft.value === 'task_batch_number'
          ? '请输入排期批次，例如第2批。'
          : '请输入非负数字，件数为整数，重量最多三位小数。'
      return false
    }
  }
  return true
}
function search() {
  if (validSearch()) apply(draftFilters())
}
function applyDialogFilters() {
  if (!validSearch()) return
  const [kind, age] = analysisDraft.value.split(':')
  const params: TeamInventoryParams = {
    ...draftFilters(),
    date_from: dateDraft.value.from || undefined,
    date_to: dateDraft.value.to || undefined,
    activity_day: undefined,
    activity_kind: undefined,
    location_status: props.warehouse && locationDraft.value ? 'unassigned' : undefined,
    days: daysDraft.value === 7 ? 7 : undefined,
    stock_age: kind === 'age' ? (age as AgeBand) : undefined,
    waiting_direction: kind === 'incoming' || kind === 'outgoing' ? kind : undefined,
    waiting_age: kind === 'incoming' || kind === 'outgoing' ? (age as AgeBand) : undefined,
    has_loss: kind === 'loss' || undefined,
  }
  if (filterResetRequested.value) {
    delete params.page
    if (params.availability === 'current') delete params.availability
  }
  apply(params, '')
  filtersOpen.value = false
}
function resetDialogFilters() {
  filterResetRequested.value = true
  daysDraft.value = 30
  reworkDraft.value = ''
  processingStateDraft.value = routeStatusDraft.value = undefined
  sourceDraft.value = ''
  sourceTeamDraft.value = undefined
  typeDraft.value = ''
  materialDraft.value = ''
  purposeDraft.value = undefined
  availabilityDraft.value = 'current'
  fieldDraft.value = 'all'
  operatorDraft.value = 'eq'
  queryDraft.value = ''
  inputError.value = ''
  dateDraft.value = { from: '', to: '' }
  locationDraft.value = false
  analysisDraft.value = ''
}
function paginate(value: number, size = pageSize.value) {
  apply({ ...filters.value, page: value, page_size: size })
}
let version = 0
async function load(background = false) {
  const current = ++version
  resetSchedules()
  if (!background) {
    loading.value = true
    error.value = ''
  }
  refreshError.value = ''
  try {
    const result = await teamMaterialApi.teamInventory(props.teamId, filters.value)
    if (current !== version) return
    if (
      page.value > 1 &&
      !result.items.length &&
      result.total <= (page.value - 1) * pageSize.value
    ) {
      paginate(Math.max(1, Math.ceil(result.total / pageSize.value)))
      return
    }
    rows.value = result.items.map((row) => ({
      ...row,
      delivery_schedule: inventoryScheduleBaseline(row.material_type),
    }))
    expandedScheduleGroups.value = expandedScheduleGroups.value.filter((id) =>
      result.items.some((row) => row.group_id === id),
    )
    void loadSchedules()
    total.value = result.total
    asOf.value = result.as_of || ''
    error.value = ''
  } catch (e) {
    if (current === version) {
      if (background) refreshError.value = '库存更新失败，当前保留上次结果，请刷新重试。'
      else {
        rows.value = []
        total.value = 0
        error.value = e instanceof Error ? e.message : '库存加载失败'
      }
    }
  } finally {
    if (current === version) loading.value = false
  }
}
const picker = ref<TeamInventoryRow | null>(null),
  pending = ref<TeamInventoryRow | null>(null)
const shipment = ref<TeamInventoryRow | null>(null)
const pickerMode = ref<'dispatch' | 'reallocate'>('dispatch')
const openingSource = ref<{ groupId: number; mode: 'dispatch' | 'reallocate' | 'edit' } | null>(
  null,
)
const editingReceipt = ref<MaterialTransfer | null>(null)
let sourceVersion = 0
async function openReceiptEdit(row: TeamInventoryRow) {
  if (
    !props.canWrite ||
    !row.receipt_editable ||
    !row.batch_no ||
    openingSource.value ||
    preparingDispatch.value
  )
    return
  const current = ++sourceVersion
  openingSource.value = { groupId: row.group_id, mode: 'edit' }
  try {
    const receipt = await materialTransferApi.get(row.batch_no)
    if (current !== sourceVersion || !props.canWrite) return
    if (!receipt.allowed_actions.includes('edit_receipt')) {
      showToast('此批已不能修改，请查看入库和流转记录', 'error')
      void load(true)
      return
    }
    editingReceipt.value = receipt
  } catch (failure) {
    if (current === sourceVersion)
      showToast(failure instanceof Error ? failure.message : '入库单读取失败，请重试', 'error')
  } finally {
    if (current === sourceVersion) openingSource.value = null
  }
}
function receiptEdited() {
  editingReceipt.value = null
  emit('changed')
}
async function openPicker(row: TeamInventoryRow, mode: 'dispatch' | 'reallocate') {
  if (
    !props.canWrite ||
    openingSource.value ||
    preparingDispatch.value ||
    (mode === 'reallocate' && (!props.canReallocate || row.shared_unallocated))
  )
    return
  pickerMode.value = mode
  if (row.batch_count !== 1) {
    picker.value = row
    return
  }
  const current = ++sourceVersion
  openingSource.value = { groupId: row.group_id, mode }
  try {
    const result = await teamMaterialApi.inventorySources(props.teamId, row.group_id, {
      current_only: false,
      page: 1,
      page_size: 2,
    })
    if (current !== sourceVersion) return
    const source = result.items[0]
    if (
      result.total === 1 &&
      result.items.length === 1 &&
      source &&
      stockSelectable(source) &&
      (mode !== 'reallocate' || !source.transfer.shared_unallocated)
    ) {
      if (mode === 'reallocate') reallocate(source)
      else dispatch([source])
    } else picker.value = row
  } catch (e) {
    if (current === sourceVersion)
      showToast(e instanceof Error ? e.message : '来源批次加载失败，请重试', 'error')
  } finally {
    if (current === sourceVersion) openingSource.value = null
  }
}
function clearBatchSelection(sourceId?: number) {
  if (sourceId == null) batchSelection.selected.clear()
  else batchSelection.selected.delete(String(sourceId))
}
function processingAction(row: TeamInventoryRow) {
  if (
    row.inspection_hold_count ||
    isScrapMaterialType(row.material_type) ||
    !(Number(row.on_hand_quantity) > 0 || Number(row.on_hand_weight) > 0)
  )
    return ''
  if (stockProcessingState(row) === 'complete')
    return row.has_next_processing_task ? '登记下一工序' : ''
  return '加工登记'
}
const selectedProcessingRow = computed(() =>
  batchSelection.selected.size === 1 ? batchSelection.selected.values().next().value : undefined,
)
const selectedProcessingAction = computed(() => {
  if (selectedProcessingRow.value) return processingAction(selectedProcessingRow.value)
  return batchSelection.selected.size ? '' : '加工登记'
})
function processSelected() {
  if (!props.processing || !props.canWrite || props.processingLoadingGroupId != null) return
  if (!selectedProcessingAction.value) return
  if (selectedProcessingRow.value) emit('process', selectedProcessingRow.value.group_id)
  else showToast('请在库存列表勾选一个批次后登记加工', 'info')
}
async function dispatchSelected() {
  if (!props.canWrite || loading.value || openingSource.value || preparingDispatch.value) return
  const ids = [...batchSelection.selected.keys()]
  if (!ids.length) {
    showToast('请先在库存列表勾选要出库的批次', 'info')
    return
  }
  const current = ++sourceVersion
  preparingDispatch.value = true
  try {
    const result = await teamMaterialApi.stock(props.teamId, {
      source_ids: ids.join(','),
      availability: 'dispatchable',
      page_size: 100,
    })
    if (current !== sourceVersion || !props.canWrite) return
    const available = new Map(
      result.items.filter(stockSelectable).map((batch) => [String(batch.transfer.id), batch]),
    )
    const sources = ids.flatMap((id) => {
      const batch = available.get(id)
      if (batch) return [batch]
      batchSelection.selected.delete(id)
      return []
    })
    if (sources.length !== ids.length) {
      showToast('部分批次已无法出库，请核对勾选后重试', 'warning')
      void load(true)
      return
    }
    dispatch(sources)
  } catch (failure) {
    if (current === sourceVersion)
      showToast(failure instanceof Error ? failure.message : '来源批次加载失败，请重试', 'error')
  } finally {
    if (current === sourceVersion) preparingDispatch.value = false
  }
}
function selectedSources(sources: StockBatch[]) {
  if (pickerMode.value === 'reallocate') {
    if (sources.length === 1) reallocate(sources[0]!)
  } else dispatch(sources)
}
function asRow(row: unknown) {
  return row as TeamInventoryRow
}
function dispatch(sources: StockBatch[]) {
  if (props.canWrite) {
    picker.value = null
    emit('action', 'dispatch', sources)
  }
}
function reallocate(source: StockBatch) {
  if (props.canWrite && props.canReallocate) {
    picker.value = null
    emit('reallocate', source)
  }
}
function resetDetails() {
  ++sourceVersion
  openingSource.value = null
  preparingDispatch.value = false
  clearBatchSelection()
  editingReceipt.value = null
  picker.value = pending.value = null
  expandedScheduleGroups.value = []
}
const searchBeforeFilters = ref({
  query: '',
  field: 'all' as WarehouseSearchField,
  operator: 'eq' as 'eq' | 'gte' | 'lte',
})
function openFilters() {
  searchBeforeFilters.value = {
    query: queryDraft.value,
    field: fieldDraft.value,
    operator: operatorDraft.value,
  }
  syncFilterDrafts()
  restoreSearchDraft()
}
function restoreSearchDraft() {
  queryDraft.value = searchBeforeFilters.value.query
  fieldDraft.value = searchBeforeFilters.value.field
  operatorDraft.value = searchBeforeFilters.value.operator
}
function cancelFilters() {
  syncFilterDrafts()
  restoreSearchDraft()
}
function syncFilterDrafts() {
  filterResetRequested.value = false
  queryDraft.value = filters.value.query || ''
  reworkDraft.value = text('rework') as 'pending' | 'worked' | ''
  sourceDraft.value = text('receipt_source') as WarehouseSource | ''
  typeDraft.value = text('material_type')
  materialDraft.value = text('material_name')
  fieldDraft.value = searchColumns.value.some((column) => column.key === text('search_field'))
    ? (text('search_field') as WarehouseSearchField)
    : 'all'
  operatorDraft.value =
    text('search_operator') === 'gte' ? 'gte' : text('search_operator') === 'lte' ? 'lte' : 'eq'
  availabilityDraft.value = filters.value.availability
  sourceTeamDraft.value = Number(text('source_team_id')) || undefined
  inputError.value = ''
  purposeDraft.value = filters.value.purpose_id
  processingStateDraft.value = filters.value.processing_state
  routeStatusDraft.value = filters.value.route_status
  dateDraft.value = { ...dates.value }
  locationDraft.value = text('location_status') === 'unassigned'
  analysisDraft.value = analysisChoice.value
  daysDraft.value = days.value
}
watch(() => props.teamId, tableQuery.reset, { flush: 'sync' })
watch(
  [() => props.teamId, filters],
  () => {
    syncFilterDrafts()
    void load()
  },
  { immediate: true },
)
watch(
  [() => props.teamId, () => props.warehouse],
  () => {
    purposes.value = []
    void loadPurposes()
  },
  { immediate: true },
)
watch(
  () => props.overview,
  () => {
    void load(true)
    void loadPurposes()
  },
)
watch(
  [() => props.teamId, () => props.canWrite, () => props.canReallocate, () => auth.currentUser?.id],
  resetDetails,
)
onMounted(() => {
  syncScheduleClock()
  document.addEventListener('visibilitychange', resumeScheduleClock)
})
onBeforeUnmount(() => {
  clearInterval(scheduleClock)
  document.removeEventListener('visibilitychange', resumeScheduleClock)
  ++version
  ++purposeVersion
  ++sourceVersion
})
</script>

<template>
  <WorkspaceDataPanel class="warehouse-inventory serial-ledger workspace-data-panel">
    <ElAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <WorkspaceDataToolbar
      :loading="loading"
      columns
      aria-label="库存查询"
      @search="search"
      @refresh="emit('refresh')"
      @columns="columnSettings?.open($event)"
    >
      <template #search>
        <ElSelect
          v-if="searchKind === 'number'"
          v-model="operatorDraft"
          class="numeric-operator"
          aria-label="库存数值比较"
          ><ElOption value="eq" label="等于" /><ElOption value="gte" label="不少于" /><ElOption
            value="lte"
            label="不多于"
        /></ElSelect>
        <ElDatePicker
          v-if="searchKind === 'date'"
          :model-value="queryDraft || null"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          aria-label="库存日期搜索"
          @update:model-value="queryDraft = $event || ''"
          @clear="
            () => {
              queryDraft = ''
              search()
            }
          " />
        <ElInput
          v-else
          v-model="queryDraft"
          :prefix-icon="searchKind === 'text' ? Search : undefined"
          aria-label="库存明细搜索"
          :placeholder="
            fieldDraft === 'all'
              ? warehouse
                ? '批次号、流水号、仓库或材质'
                : '批次号、流水号或材质'
              : `搜索${searchColumns.find((column) => column.key === fieldDraft)?.label}`
          "
          clearable
          @keydown.enter.prevent
          @keyup.enter="search"
          @clear="search"
      /></template>
      <template #filters
        ><FilterDialog
          v-model="filtersOpen"
          #default="{ appendTo }"
          title="库存筛选"
          :count="filterCount"
          @open="openFilters"
          @cancel="cancelFilters"
          @apply="applyDialogFilters"
          @reset="resetDialogFilters"
        >
          <div class="filter-fields">
            <label
              >搜索字段<ElSelect
                :append-to="appendTo"
                v-model="fieldDraft"
                aria-label="库存搜索字段"
                filterable
                @change="
                  () => {
                    queryDraft = ''
                    operatorDraft = 'eq'
                    inputError = ''
                  }
                "
                ><ElOption value="all" label="综合搜索" /><ElOption
                  v-for="column in searchColumns"
                  :key="column.key"
                  :value="column.key"
                  :label="column.label" /></ElSelect
            ></label>
            <label v-if="fieldDraft === 'task_batch_number'"
              >比较方式<ElSelect
                :append-to="appendTo"
                v-model="operatorDraft"
                aria-label="排期批次比较方式"
              >
                <ElOption value="eq" label="等于" />
                <ElOption value="gte" label="不少于" />
                <ElOption value="lte" label="不多于" />
              </ElSelect>
            </label>
            <label
              >搜索内容<ElInput
                v-model="queryDraft"
                aria-label="库存筛选搜索内容"
                clearable
                :placeholder="
                  fieldDraft === 'task_batch_number' ? '例如 第2批' : '输入要查询的内容'
                "
            /></label>
            <label v-if="warehouse"
              >来源<ElSelect
                :append-to="appendTo"
                v-model="sourceDraft"
                class="warehouse-source-filter"
                aria-label="库存来源筛选"
                placeholder="全部来源"
                clearable
                ><ElOption
                  v-for="[value, label] in sourceOptions"
                  :key="value"
                  :value="value"
                  :label="label" /></ElSelect
            ></label>
            <label v-else
              >上序班组<ElSelect
                :append-to="appendTo"
                v-model="sourceTeamDraft"
                class="warehouse-source-filter"
                aria-label="库存上序班组筛选"
                placeholder="全部上序"
                clearable
                filterable
                ><ElOption
                  v-for="team in sourceTeams"
                  :key="team.id"
                  :value="team.id"
                  :label="team.name" /></ElSelect
            ></label>
            <label
              >返工属性<ElSelect
                :append-to="appendTo"
                v-model="reworkDraft"
                clearable
                placeholder="全部"
                aria-label="库存返工筛选"
                ><ElOption label="待返工" value="pending" /><ElOption
                  label="有返工历史"
                  value="worked" /></ElSelect
            ></label>
            <label v-if="warehouse && sourceDraft === 'internal'"
              >来源班组<ElSelect
                :append-to="appendTo"
                v-model="sourceTeamDraft"
                aria-label="库房来源班组"
                placeholder="全部来源班组"
                clearable
                filterable
                ><ElOption
                  v-for="team in sourceTeams"
                  :key="team.id"
                  :value="team.id"
                  :label="team.name" /></ElSelect
            ></label>
            <label
              >物料类型<ElSelect
                :append-to="appendTo"
                v-model="typeDraft"
                class="warehouse-type-filter"
                aria-label="库存物料类型筛选"
                placeholder="全部类型"
                clearable
                ><ElOption
                  v-for="item in materialTypeOptions"
                  :key="item.value"
                  :value="item.value"
                  :label="item.label" /><ElOption value="unknown" label="未分类" /></ElSelect
            ></label>
            <label v-if="processing && !isScrapMaterialType(typeDraft)"
              >加工状态<ElSelect
                :append-to="appendTo"
                v-model="processingStateDraft"
                clearable
                aria-label="库存加工状态筛选"
                placeholder="全部状态"
                ><ElOption
                  v-for="option in processingStateOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value" /></ElSelect
            ></label>
            <label
              >关联工艺<ElSelect
                :append-to="appendTo"
                v-model="routeStatusDraft"
                clearable
                aria-label="库存关联工艺筛选"
                placeholder="全部"
                ><ElOption label="已关联" value="linked" /><ElOption
                  label="未关联"
                  value="unlinked" /></ElSelect
            ></label>
            <label v-if="!warehouse"
              >加工任务<ElSelect
                :append-to="appendTo"
                v-model="purposeDraft"
                class="inventory-purpose-filter"
                aria-label="库存加工任务筛选"
                placeholder="全部加工任务"
                clearable
                filterable
                :loading="purposesLoading"
                ><ElOption :value="0" label="未指定任务" /><ElOption
                  v-for="purpose in purposes"
                  :key="purpose.id"
                  :value="purpose.id"
                  :label="`${purpose.name}${purpose.active ? '' : '（已停用）'}`" /></ElSelect
            ></label>
            <label
              >材质<ElSelect
                :append-to="appendTo"
                v-model="materialDraft"
                aria-label="库存材质筛选"
                clearable
                filterable
                placeholder="全部材质"
                ><ElOption
                  v-for="item in overview.materials"
                  :key="item.material_name || '未填写材质'"
                  :value="item.material_name || '未填写材质'"
                  :label="item.material_name || '未填写材质'" /></ElSelect
            ></label>
            <label
              >库存范围<ElSelect
                :append-to="appendTo"
                v-model="availabilityDraft"
                aria-label="库存范围"
                ><ElOption value="current" label="当前有料" /><ElOption
                  value="owned"
                  label="含已转出待确认" /><ElOption
                  value="available"
                  label="正常料可转出" /><ElOption value="scrap" label="废料可处理" /><ElOption
                  value="all"
                  label="全部（含零库存）" /></ElSelect
            ></label>
            <label
              >分析条件<ElSelect
                :append-to="appendTo"
                v-model="analysisDraft"
                aria-label="库存分析条件"
                placeholder="库存与流转条件"
                clearable
                ><ElOptionGroup label="库存停留"
                  ><ElOption
                    v-for="[key, label] in ages"
                    :key="key"
                    :value="`age:${key}`"
                    :label="`库存停留 ${label}`" /></ElOptionGroup
                ><ElOptionGroup
                  v-for="direction in ['incoming', 'outgoing']"
                  :key="direction"
                  :label="direction === 'incoming' ? '来料待签收' : '转出待确认'"
                  ><ElOption
                    v-for="[key, label] in ages"
                    :key="key"
                    :value="`${direction}:${key}`"
                    :label="`${direction === 'incoming' ? '来料待签收' : '转出待确认'} ${label}`" /></ElOptionGroup
                ><ElOption value="loss" :label="`近${daysDraft}天有丢失记录`" /></ElSelect
            ></label>
            <label
              >事件周期<ElSelect
                :append-to="appendTo"
                v-model="daysDraft"
                aria-label="库存事件筛选周期"
                ><ElOption :value="7" label="近7天" /><ElOption
                  :value="30"
                  label="近30天" /></ElSelect
            ></label>
            <ElCheckbox v-if="warehouse" v-model="locationDraft">有未分配仓位的物料</ElCheckbox>
            <label
              >流转日期<RecordDateFilter :append-to="appendTo" v-model="dateDraft" label="流转日期"
            /></label>
            <ElAlert
              v-if="inputError"
              :title="inputError"
              type="warning"
              :closable="false"
              class="filter-wide"
            />
          </div> </FilterDialog
      ></template>
      <template #tools>
        <InventoryColumnSettings
          ref="columnSettings"
          :key="`${teamId}:${Boolean(processing)}`"
          :previous-defaults="warehousePreviousDefaults"
          :show-trigger="false"
          :storage-key="storageKey"
          :description="
            processing
              ? '批次号、流水号、数量、工艺工序、返工情况、加工状态、材质和操作始终显示。'
              : '批次号、流水号、数量、材质和操作始终显示。'
          "
          :columns="selectableColumns"
          :new-visible-keys="['task_batch_number']"
          :fixed-column-options="fixedColumnOptions"
          @fixed-change="fixedColumns = $event"
          :legacy-keys="warehouseLegacyColumnKeys"
          @change="columnChoices = $event"
      /></template>
      <template #primary-actions>
        <ElButton
          v-if="canWrite && batchSelection.selected.size"
          text
          :disabled="preparingDispatch"
          @click="clearBatchSelection()"
          >清空勾选</ElButton
        >
        <ElButton
          v-if="fullscreen && canWrite && batchSelection.selected.size"
          :loading="preparingDispatch"
          @click="dispatchSelected"
          >新建出库</ElButton
        >
        <ElButton
          v-if="processing && canWrite && selectedProcessingAction"
          class="inventory-process"
          :icon="Operation"
          :disabled="processingLoadingGroupId != null"
          @click="processSelected"
          >{{ selectedProcessingAction }}</ElButton
        >
      </template>
      <template v-if="!fullscreen && $slots.actions" #actions><slot name="actions" /></template>
    </WorkspaceDataToolbar>

    <ElAlert v-if="inputError" :title="inputError" type="warning" :closable="false" />
    <ElAlert v-if="!warehouse && purposesError" type="warning" :closable="false"
      ><span>{{ purposesError }}</span
      ><ElButton link type="primary" @click="loadPurposes">重试</ElButton></ElAlert
    >
    <div v-if="analysisLabel" class="warehouse-search-context">
      <ElTag closable @close="selectAnalysis('')">{{ analysisLabel }}</ElTag
      ><span v-if="!text('stock_age')"> 符合条件流水号的分类库存</span>
    </div>
    <div v-if="searchedColumn" class="warehouse-search-context">
      <ElTag
        closable
        @close="
          apply({
            ...filters,
            query: undefined,
            search_field: undefined,
            search_operator: undefined,
            page: 1,
          })
        "
        >按{{ searchedColumn.label }}查询 · 首列显示</ElTag
      >
    </div>
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取库存" />
    <WorkspaceTable
      columns-key="TeamInventory-1"
      :column-query="tableQuery.controller.value"
      :column-settings="false"
      :fixed-columns="fixedColumns"
      @fixed-options-change="fixedColumnOptions = $event"
      v-else
      class="serial-table warehouse-table"
      :data="rows"
      row-key="group_id"
      :expand-row-keys="expandedScheduleGroups.map(String)"
      empty-text="暂无符合条件的库存"
    >
      <ElTableColumn
        v-for="column in visibleColumns"
        :key="column.key"
        :prop="column.key"
        :label="column.label"
        :min-width="column.width"
        :fixed="['batch_no', searchedColumn?.key].includes(column.key) ? 'left' : undefined"
        align="center"
        show-overflow-tooltip
        :label-class-name="column.key === searchedColumn?.key ? 'searched-column' : ''"
        :class-name="
          column.key === 'serial_no'
            ? 'table-identity'
            : 'numeric' in column
              ? 'inventory-number-cell'
              : ''
        "
      >
        <template v-if="canWrite && column.key === 'batch_no'" #header>
          <ElCheckbox
            aria-label="选择本页可用批次"
            title="选择本页可用批次"
            :model-value="batchSelection.allChecked.value"
            :indeterminate="
              batchSelection.checkedCount.value > 0 && !batchSelection.allChecked.value
            "
            :disabled="preparingDispatch || !batchSelection.availableRows.value.length"
            @change="batchSelection.toggleAll"
          />
        </template>
        <template #default="{ row }">
          <div v-if="column.key === 'batch_no'" class="inventory-inline">
            <ElCheckbox
              v-if="canWrite && batchSelection.available(asRow(row))"
              :aria-label="`勾选批次 ${row.batch_no}`"
              :model-value="batchSelection.selected.has(String(row.group_id))"
              :disabled="
                preparingDispatch ||
                (batchSelection.selected.size >= 100 &&
                  !batchSelection.selected.has(String(row.group_id)))
              "
              @change="batchSelection.toggle(asRow(row), $event)"
            />
            <span>{{ column.format(asRow(row)) }}</span>
          </div>
          <ElTooltip
            v-else-if="column.key === 'material_name'"
            :content="`尺寸：${row.transfer_specification}`"
            :disabled="!row.transfer_specification || separateSpecification"
            :trigger="['hover', 'focus']"
            placement="top"
            ><span
              class="inventory-material"
              :title="row.material_name || '未填写材质'"
              :tabindex="row.transfer_specification && !separateSpecification ? 0 : undefined"
              >{{ column.format(asRow(row)) }}</span
            ></ElTooltip
          >
          <div v-else-if="column.key === 'material_type'" class="inventory-material-kind">
            <ElTag
              effect="light"
              :type="
                isScrapMaterialType(row.material_type)
                  ? 'warning'
                  : row.material_type === 'finished'
                    ? 'success'
                    : 'primary'
              "
              >{{ column.format(asRow(row)) }}</ElTag
            >
          </div>
          <ElTag
            v-else-if="column.key === 'rework' && !isScrapMaterialType(row.material_type)"
            :type="row.rework_route_id || row.rework_pending ? 'warning' : 'info'"
            effect="light"
            >{{ column.format(asRow(row)) }}</ElTag
          >
          <template v-else-if="column.key === 'delivery_due_at'">
            <ElButton
              v-if="row.delivery_schedule?.count"
              link
              type="primary"
              class="inventory-schedule-link"
              :class="`inventory-schedule-link--${inventoryScheduleTone(row.delivery_schedule)}`"
              :aria-expanded="expandedScheduleGroups.includes(row.group_id)"
              :aria-label="`查看${row.serial_no}交货排期`"
              @click="toggleSchedule(asRow(row))"
              >{{ column.format(asRow(row)) }}</ElButton
            ><span v-else>{{ column.format(asRow(row)) }}</span>
          </template>
          <template v-else-if="column.key === 'delivery_schedule_status'">
            <span v-if="!row.delivery_schedule && scheduleLoading" class="inventory-schedule-muted"
              >读取中</span
            >
            <ElTag v-else :type="inventoryScheduleTone(row.delivery_schedule)" effect="light">
              {{ column.format(asRow(row)) }}
            </ElTag>
          </template>
          <ElTag
            v-else-if="column.key === 'stock_status' && row.inspection_hold_count && !processing"
            type="danger"
            effect="light"
            >{{ column.format(asRow(row)) }}</ElTag
          >
          <span v-else-if="column.key === 'stock_status' && processing" class="inventory-inline">
            <ProcessingStockStatus
              compact
              :summary="asRow(row)"
              :material-type="row.material_type"
              :pending="inventoryHasPending(asRow(row))"
            />
            <ElTag v-if="row.inspection_hold_count" type="danger" effect="light">巡检待处理</ElTag>
          </span>
          <ElTooltip
            v-else-if="column.key === 'stock_status'"
            :content="ownershipHint(asRow(row))"
            :trigger="['hover', 'focus']"
            popper-class="inventory-balance-tooltip"
            placement="top"
            ><ElTag
              :type="
                column.format(asRow(row)) === '重量差异'
                  ? 'danger'
                  : inventoryHasPending(asRow(row))
                    ? 'warning'
                    : inventoryCanDispatch(asRow(row))
                      ? 'success'
                      : 'info'
              "
              effect="light"
              tabindex="0"
              >{{ column.format(asRow(row)) }}</ElTag
            ></ElTooltip
          >
          <div v-else-if="column.key === 'source' && warehouse" class="inventory-inline">
            <span class="inventory-source-name">{{
              row.receipt_source === 'opening' ? '初始库存' : row.source_name || '—'
            }}</span>
          </div>
          <span
            v-else-if="
              column.key === 'dispatchable_quantity' || column.key === 'dispatchable_weight'
            "
            :title="
              isScrapMaterialType(row.material_type) ? '废料可处理的库存' : '正常料可转出的库存'
            "
            >{{ column.format(asRow(row)) }}</span
          >
          <template
            v-else-if="column.key === 'in_transit_quantity' || column.key === 'in_transit_weight'"
          >
            <ElButton
              v-if="row.in_transit_quantity > 0 || row.in_transit_weight > 0"
              link
              type="primary"
              :aria-label="`查看${row.serial_no}转出待签收批次`"
              @click="pending = asRow(row)"
              >{{ column.format(asRow(row)) }}</ElButton
            >
            <span v-else>{{ column.format(asRow(row)) }}</span>
          </template>
          <ElTooltip
            v-else-if="column.key === 'on_hand_quantity' || column.key === 'on_hand_weight'"
            :content="'本班组尚未转出的数量和重量'"
            :trigger="['hover', 'focus']"
            popper-class="inventory-balance-tooltip"
            placement="top"
          >
            <span
              class="inventory-balance"
              :class="{ 'inventory-balance--shortage': column.format(asRow(row)).startsWith('-') }"
              :data-field="column.key"
              tabindex="0"
              ><strong>{{ column.format(asRow(row)) }}</strong></span
            >
          </ElTooltip>
          <span v-else-if="column.key === 'purpose_name'">{{ row.purpose_name || '—' }}</span>
          <span v-else>{{ column.format(asRow(row)) }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn
        v-if="
          visibleColumns.some((column) => column.key === 'delivery_due_at') &&
          rows.some((row) => row.delivery_schedule?.count)
        "
        type="expand"
        width="1"
        class-name="inventory-schedule-toggle"
        label-class-name="inventory-schedule-toggle"
        :resizable="false"
        ><template #default="{ row }">
          <InventoryScheduleDetails
            v-if="row.delivery_schedule?.count"
            :summary="row.delivery_schedule"
            :serial-no="row.serial_no"
            @close="expandedScheduleGroups = []"
            @view="viewSchedule"
            @view-all="viewSchedule(undefined, row.serial_no)"
          /> </template
      ></ElTableColumn>
      <ElTableColumn
        v-if="canWrite || hasPending"
        label="操作"
        :width="actionWidth"
        align="center"
        fixed="right"
        ><template #default="{ row }"
          ><div class="inventory-row-actions">
            <ElButton
              v-if="warehouse && canWrite && row.receipt_editable"
              link
              type="primary"
              :loading="openingSource?.groupId === row.group_id && openingSource?.mode === 'edit'"
              :disabled="!!openingSource"
              @click="openReceiptEdit(asRow(row))"
              >修改入库</ElButton
            ><ElButton
              v-if="processing && canWrite && processingAction(asRow(row))"
              link
              class="action-cool"
              :loading="processingLoadingGroupId === row.group_id"
              :disabled="processingLoadingGroupId != null"
              @click="emit('process', row.group_id)"
              >{{ processingAction(asRow(row)) }}</ElButton
            ><ElButton
              v-if="canWrite && inventoryCanDispatch(asRow(row))"
              link
              class="action-warm"
              :loading="
                openingSource?.groupId === row.group_id && openingSource?.mode === 'dispatch'
              "
              :disabled="!!openingSource"
              @click="openPicker(asRow(row), 'dispatch')"
              >出库</ElButton
            ><ElButton
              v-if="
                inspection &&
                canWrite &&
                inventoryCanDispatch(asRow(row)) &&
                !isScrapMaterialType(row.material_type) &&
                !row.shared_unallocated
              "
              link
              class="action-warm"
              @click="shipment = asRow(row)"
              >汇总发货</ElButton
            ><ElButton
              v-if="canWrite && canReallocate && inventoryCanDispatch(asRow(row))"
              link
              type="primary"
              :loading="
                openingSource?.groupId === row.group_id && openingSource?.mode === 'reallocate'
              "
              :disabled="!!openingSource || row.shared_unallocated"
              :title="row.shared_unallocated ? '共投料请通过加工登记拆分归属' : undefined"
              @click="openPicker(asRow(row), 'reallocate')"
              >转投</ElButton
            ><ElButton
              v-if="inventoryHasPending(asRow(row))"
              link
              type="primary"
              @click="pending = asRow(row)"
              >{{
                Number(row.external_pending_quantity) > 0 || Number(row.external_pending_weight) > 0
                  ? '查看转出'
                  : '在途转出'
              }}</ElButton
            >
          </div></template
        ></ElTableColumn
      >
    </WorkspaceTable>
    <div
      v-if="
        scheduleError &&
        !error &&
        visibleColumns.some((column) =>
          ['delivery_due_at', 'delivery_schedule_status'].includes(column.key),
        )
      "
      class="inventory-schedule-error"
      role="status"
    >
      <span>{{ scheduleError }}</span
      ><ElButton link type="primary" :loading="scheduleLoading" @click="loadSchedules()"
        >重试排期</ElButton
      >
    </div>
    <WorkspacePagination
      v-if="!error"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="paginate($event)"
      @size-change="paginate(1, $event)"
      >共 {{ total }} 条库存记录<small v-if="asOf" class="inventory-as-of"
        >系统记录 · {{ formatDateTime(asOf) }}</small
      ></WorkspacePagination
    >
    <WarehouseReceiptDialog
      v-if="editingReceipt"
      :model-value="true"
      :team-id="teamId"
      :receipt="editingReceipt"
      @update:model-value="editingReceipt = null"
      @saved="receiptEdited"
    />
    <InventoryPendingDialog
      v-if="pending"
      :team-id="teamId"
      :group="pending"
      @close="pending = null"
      @changed="
        () => {
          load(true)
          emit('changed')
        }
      "
    />
    <StockSourcePicker
      v-if="picker && canWrite"
      :team-id="teamId"
      :processing="processing"
      :group-id="picker.group_id"
      :mode="pickerMode"
      :group-label="
        [
          picker.serial_no,
          materialTypeLabel(picker.material_type || null),
          picker.purpose_name,
          sourceLabel(picker),
        ]
          .filter(Boolean)
          .join(' · ')
      "
      @close="picker = null"
      @selected="selectedSources"
    />
    <InventoryShipmentDialog
      v-if="shipment && canWrite && inspection"
      :team-id="teamId"
      :group-id="shipment.group_id"
      :serial-no="shipment.serial_no"
      @close="shipment = null"
      @saved="
        () => {
          load(true)
          emit('changed')
        }
      "
    />
  </WorkspaceDataPanel>
</template>

<style scoped>
.warehouse-inventory {
  container-type: inline-size;
}
.warehouse-search-context {
  padding-bottom: 12px;
}
.warehouse-table {
  container-type: inline-size;
}

.inventory-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
  line-height: 24px;
}
.inventory-material {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inventory-source-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inventory-inline .el-tag {
  flex-shrink: 0;
}
.inventory-balance {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inventory-balance strong {
  font-size: var(--workspace-number-size, 15px);
  font-weight: 550;
  color: var(--text);
}
.inventory-material:focus-visible,
.inventory-balance:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  border-radius: 3px;
}
:global(.inventory-balance-tooltip) {
  white-space: pre-line;
  line-height: 1.7;
}
.inventory-row-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.inventory-row-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.inventory-as-of {
  font-size: var(--font-size-meta);
}
.warehouse-table :deep(.searched-column) {
  color: var(--primary);
}

@media (max-width: 760px) {
  .warehouse-inventory {
    container-type: inline-size;
  }

  .warehouse-table :deep(.el-table-fixed-column--right) {
    position: relative !important;
    right: auto !important;
  }
  .warehouse-table :deep(.el-table-fixed-column--right::before) {
    box-shadow: none;
  }
  .warehouse-table :deep(.el-scrollbar__bar.is-horizontal) {
    opacity: 1;
  }
}
.inventory-balance--shortage strong {
  color: var(--el-color-danger);
}
.inventory-material-kind {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.inventory-schedule-muted {
  color: var(--muted);
}
.inventory-schedule-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  padding-block: 8px;
}
.inventory-schedule-link--danger {
  color: var(--el-color-danger);
}
.inventory-schedule-link--warning {
  color: var(--el-color-warning);
}
.warehouse-table :deep(.inventory-schedule-toggle) {
  padding: 0;
  border-right: 0;
}
.warehouse-table :deep(.inventory-schedule-toggle .cell) {
  display: none;
}
.warehouse-table :deep(.el-table__expanded-cell) {
  padding: 0;
}
</style>

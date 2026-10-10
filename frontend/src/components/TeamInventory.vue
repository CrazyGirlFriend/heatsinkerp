<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Close, Flag, Refresh, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElCheckbox, ElDatePicker, ElInput, ElOption, ElOptionGroup, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag, ElTooltip } from 'element-plus'
import FilterDialog from './FilterDialog.vue'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import InventoryPendingDialog from './InventoryPendingDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import SerialUrgencyDialog from './SerialUrgencyDialog.vue'
import StockSourcePicker from './StockSourcePicker.vue'
import TeamInventoryDetail from './TeamInventoryDetail.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import StatePanel from './StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTypeLabel, materialTypeOptions, isScrapType as isScrapMaterialType } from '@/types/materialTransfer'
import { warehouseColumns, warehouseLegacyColumnKeys, warehouseSearchColumns, warehouseSearchKind, warehouseSerialColumn, inventorySourceLabel, warehouseSourceNames, inventoryAmount, inventoryDispatchable, inventoryCanDispatch, inventoryHasPending, type WarehouseColumnKey, type TeamInventoryParams, type TeamInventoryRow, type WarehouseSearchField, type WarehouseSource } from '@/types/teamInventory'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import type { CalendarRange } from '@/types/recordFilters'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'
import type { TeamPurpose } from '@/types/teamBusiness'
import type { AgeBand } from '@/types/materialAnalytics'
import { formatDateTime } from '@/utils/format'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'

const props = defineProps<{ teamId: number; overview: TeamMaterialOverview; canWrite?: boolean; canReallocate?: boolean; warehouse?: boolean; fullscreen?: boolean; processing?: boolean }>()
const emit = defineEmits<{ changed: []; refresh: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]]; reallocate: [source: StockBatch]; process: [groupId: number] }>()
const route = useRoute(), router = useRouter(), auth = useAuthStore(), directory = useTeamDirectoryStore()
const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const summarySection = computed(() => ['materials', 'material-types'].includes(text('summary')) ? text('summary') : '')
const summaryLabel = computed(() => summarySection.value === 'material-types' ? '类型库存' : '材质库存')
function returnToSummary() {
  void router.push({ path: route.path, query: { tab: summarySection.value, ...(text('summary_page') ? { page: text('summary_page') } : {}), ...(text('summary_page_size') ? { page_size: text('summary_page_size') } : {}) } })
}
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10)
const rows = ref<TeamInventoryRow[]>([]), total = ref(0), loading = ref(false), error = ref(''), refreshError = ref('')
const asOf = ref('')
const queryDraft = ref(''), sourceDraft = ref<WarehouseSource | ''>(''), typeDraft = ref(''), materialDraft = ref('')
const fieldDraft = ref<WarehouseSearchField>('all'), operatorDraft = ref<'eq' | 'gte' | 'lte'>('eq'), inputError = ref('')
const availabilityDraft = ref<TeamInventoryParams['availability']>('owned'), sourceTeamDraft = ref<number | undefined>()
const purposeDraft = ref<number | undefined>(), purposes = ref<TeamPurpose[]>([]), purposesLoading = ref(false), purposesError = ref('')
let purposeVersion = 0
async function loadPurposes() {
  const current = ++purposeVersion
  purposesError.value = ''
  if (props.warehouse) { purposesLoading.value = false; return }
  purposesLoading.value = true
  try {
    const result = await teamMaterialApi.purposes(props.teamId)
    if (current === purposeVersion) purposes.value = result
  } catch {
    if (current === purposeVersion) purposesError.value = '本组业务选项加载失败，请重试。'
  } finally { if (current === purposeVersion) purposesLoading.value = false }
}
const filtersOpen = ref(false), filterResetRequested = ref(false)
const dateDraft = ref<CalendarRange>({ from: '', to: '' }), urgentDraft = ref(false), locationDraft = ref(false), analysisDraft = ref(''), daysDraft = ref<7 | 30>(30)
const filterCount = computed(() => activeFilters.value.length + Number(Boolean(dates.value.from || dates.value.to)) + Number(Boolean(analysisChoice.value)))
const searchKind = computed(() => warehouseSearchKind(fieldDraft.value))
const days = computed<7 | 30>(() => text('days') === '7' ? 7 : 30)
const ages: [AgeBand, string][] = [['lt1', '不足1天'], ['1_3', '1–3天'], ['3_7', '3–7天'], ['ge7', '7天及以上']]
const analysisChoice = computed(() => text('stock_age') ? `age:${text('stock_age')}` : text('waiting_direction') ? `${text('waiting_direction')}:${text('waiting_age')}` : text('has_loss') === 'true' ? 'loss' : '')
const analysisLabel = computed(() => text('filter_label') || (text('stock_age') ? `库存停留：${ages.find(([key]) => key === text('stock_age'))?.[1] || text('stock_age')}` : text('waiting_direction') ? `${text('waiting_direction') === 'incoming' ? '来料待签收' : '转出待确认'}：${ages.find(([key]) => key === text('waiting_age'))?.[1] || ''}` : text('has_loss') === 'true' ? `近${days.value}天有丢失记录` : ''))
const dates = computed(() => ({ from: text('date_from') || text('activity_day'), to: text('date_to') || text('activity_day') }))
const sourceTeams = computed(() => directory.items.filter(team => team.id !== props.teamId))
const sourceLabel = (row: TeamInventoryRow) => inventorySourceLabel(row, props.warehouse)
const columns = computed(() => warehouseColumns.map(column => ({ ...column,
  label: props.processing && column.key === 'stock_status' ? '加工状态' : column.key === 'source' ? props.warehouse ? '来源' : '上序班组' : column.label,
  width: props.processing ? ({ material_name: 100, material_type: 100, purpose_name: 130, source: 90, owned_quantity: 80, owned_weight: 110, stock_status: 170 } as Partial<Record<WarehouseColumnKey, number>>)[column.key] || column.width : column.key === 'owned_quantity' ? 100 : column.key === 'owned_weight' ? 130 : column.key === 'source' ? 120 : column.width,
  format: column.key === 'source' ? sourceLabel : column.format,
})))
const searchColumns = computed(() => warehouseSearchColumns.map(column => column.key === 'source' ? { ...column, label: props.warehouse ? '来源' : '上序班组' } : column))
const columnChoices = ref<InventoryColumnChoice<WarehouseColumnKey>[]>(warehouseColumns.map(column => ({ key: column.key, visible: column.defaultVisible })))
const storageKey = computed(() => auth.currentUser?.id ? `heatsink.${props.warehouse ? 'warehouse' : 'classified'}-columns.v1:${auth.currentUser.id}:${props.teamId}` : null)
const searchedColumn = computed(() => text('query').trim() ? searchColumns.value.find(column => column.key === text('search_field')) : undefined)
const visibleColumns = computed(() => {
  const saved = [{ ...warehouseSerialColumn, width: props.processing ? 130 : 210 }, ...columnChoices.value.filter(choice => choice.visible).map(choice => columns.value.find(column => column.key === choice.key)!)]
  return searchedColumn.value ? [searchedColumn.value, ...saved.filter(column => column.key !== searchedColumn.value!.key)] : saved
})
const separateSpecification = computed(() => visibleColumns.value.some(column => column.key === 'transfer_specification'))
const actionWidth = computed(() => (rows.value.some(row => inventoryHasPending(row) && props.canWrite && inventoryCanDispatch(row)) ? 185 : rows.value.some(inventoryHasPending) ? 150 : props.canWrite ? 112 : 88) + (props.processing && props.canWrite ? 65 : 0))
function ownershipHint(row: TeamInventoryRow) {
  const available = inventoryDispatchable(row)
  const external = Number(row.external_pending_quantity) > 0 || Number(row.external_pending_weight) > 0
  return `本班组库存 ${inventoryAmount(row.owned_quantity)} 件 / ${inventoryAmount(row.owned_weight)} kg\n其中转出待签收 ${inventoryAmount(row.in_transit_quantity)} 件 / ${inventoryAmount(row.in_transit_weight)} kg${external ? `\n其中对外待确认 ${inventoryAmount(row.external_pending_quantity)} 件 / ${inventoryAmount(row.external_pending_weight)} kg` : ''}\n${isScrapMaterialType(row.material_type) ? '可处理量' : '可转出量'} ${inventoryAmount(available.quantity)} 件 / ${inventoryAmount(available.weight)} kg`
}
const filters = computed<TeamInventoryParams>(() => {
  const params: Record<string, string | number | boolean> = { page: page.value, page_size: pageSize.value, availability: ['current', 'owned', 'all', 'available', 'scrap'].includes(text('availability')) ? text('availability') : 'owned' }
  for (const key of ['query', 'search_field', 'search_operator', 'serial_no', 'material_name', 'material_type', 'source_team_id', 'date_from', 'date_to', 'stock_age', 'waiting_age', 'waiting_direction', 'activity_day', 'activity_kind', 'flow_direction', 'peer', 'days']) if (text(key)) params[key] = text(key)
  if (props.warehouse && text('receipt_source')) params.receipt_source = text('receipt_source')
  if (props.warehouse && text('location_status') === 'unassigned') params.location_status = 'unassigned'
  if (!props.warehouse && text('purpose_id')) params.purpose_id = Number(text('purpose_id'))
  if (text('source_team_id')) params.source_team_id = Number(text('source_team_id'))
  for (const key of ['urgent_only', 'has_loss']) if (text(key) === 'true') params[key] = true
  return params as TeamInventoryParams
})
function exportSource() {
  const id = props.teamId, params = { ...filters.value }
  const fields = [warehouseSerialColumn, ...columns.value.filter(column => !column.key.startsWith('shortage_'))].map(column => ({ key: column.key, label: column.label,
    selected: visibleColumns.value.some(item => item.key === column.key),
    value: (row: TeamInventoryRow) => {
      const value = column.format(row)
      if (value === '—') return null
      const numeric = 'numeric' in column && column.numeric ? Number(value.replaceAll(',', '')) : NaN
      return Number.isFinite(numeric) ? numeric : value
    } }))
  return tableExportSource('库存明细', total.value, fields, (signal, progress) => loadExportPages((page, pageSize) => teamMaterialApi.teamInventory(id, { ...params, page, page_size: pageSize }), signal, progress))
}
defineExpose({ exportSource })
const activeFilters = computed(() => {
  const chips: { key: keyof TeamInventoryParams; label: string }[] = []
  if (props.warehouse && text('location_status')) chips.push({ key: 'location_status', label: '有未分配仓位的物料' })
  if (props.warehouse && text('receipt_source')) chips.push({ key: 'receipt_source', label: `来源：${warehouseSourceNames[text('receipt_source') as WarehouseSource] || text('receipt_source')}` })
  if (text('source_team_id')) chips.push({ key: 'source_team_id', label: `${props.warehouse ? '来源' : '上序'}：${sourceTeams.value.find(team => team.id === Number(text('source_team_id')))?.name || text('source_team_id')}` })
  if (text('material_type')) chips.push({ key: 'material_type', label: `类型：${text('material_type') === 'unknown' ? '未分类' : materialTypeLabel(text('material_type'))}` })
  if (text('material_name')) chips.push({ key: 'material_name', label: `材质：${text('material_name')}` })
  if (!props.warehouse && text('purpose_id')) chips.push({ key: 'purpose_id', label: `业务：${text('purpose_id') === '0' ? '未指定业务' : purposes.value.find(purpose => purpose.id === Number(text('purpose_id')))?.name || text('purpose_id')}` })
  const availabilityLabels = { current: '有未转出库存', available: '正常料可转出', scrap: '废料可处理', all: '全部（含零库存）' }
  if (filters.value.availability && filters.value.availability !== 'owned') chips.push({ key: 'availability', label: availabilityLabels[filters.value.availability] })
  if (text('urgent_only') === 'true') chips.push({ key: 'urgent_only', label: '仅看加急' })
  return chips
})
function apply(params: TeamInventoryParams = {}, label = text('filter_label')) {
  void router.replace({ path: route.path, query: { tab: 'stock', ...(summarySection.value ? { summary: summarySection.value, ...(text('summary_page') ? { summary_page: text('summary_page') } : {}), ...(text('summary_page_size') ? { summary_page_size: text('summary_page_size') } : {}) } : {}), ...(label ? { filter_label: label } : {}), ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])) } })
}
function selectAnalysis(value: string) {
  if (!validSearch()) return
  const [kind, age] = value.split(':')
  apply({ ...draftFilters(), stock_age: kind === 'age' ? age as AgeBand : undefined,
    waiting_direction: kind === 'incoming' || kind === 'outgoing' ? kind : undefined,
    waiting_age: kind === 'incoming' || kind === 'outgoing' ? age as AgeBand : undefined,
    has_loss: kind === 'loss' || undefined, activity_day: undefined, activity_kind: undefined,
    flow_direction: undefined, peer: undefined }, '')
}
function draftFilters(): TeamInventoryParams {
  return { ...(filterResetRequested.value ? { page_size: pageSize.value } : filters.value), page: 1, query: queryDraft.value.trim() || undefined, search_field: queryDraft.value.trim() && fieldDraft.value !== 'all' ? fieldDraft.value : undefined,
    search_operator: queryDraft.value.trim() && searchKind.value === 'number' ? operatorDraft.value : undefined,
    receipt_source: props.warehouse ? sourceDraft.value || undefined : undefined, source_team_id: !props.warehouse || sourceDraft.value === 'internal' ? sourceTeamDraft.value : undefined,
    purpose_id: !props.warehouse && typeof purposeDraft.value === 'number' ? purposeDraft.value : undefined,
    material_type: typeDraft.value || undefined, material_name: materialDraft.value || undefined, availability: availabilityDraft.value }
}
function validSearch() {
  inputError.value = ''
  if (queryDraft.value.trim() && searchKind.value === 'number') {
    const term = queryDraft.value.trim(), value = Number(term)
    if (!Number.isFinite(value) || value < 0 || value > 1e15 || !(fieldDraft.value.endsWith('weight') ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(term)) {
      inputError.value = '请输入非负数字，件数为整数，重量最多三位小数。'; return false
    }
  }
  return true
}
function search() { if (validSearch()) apply(draftFilters()) }
function applyDialogFilters() {
  if (!validSearch()) return
  const [kind, age] = analysisDraft.value.split(':')
  const params: TeamInventoryParams = { ...draftFilters(), date_from: dateDraft.value.from || undefined, date_to: dateDraft.value.to || undefined,
    activity_day: undefined, activity_kind: undefined, urgent_only: urgentDraft.value || undefined,
    location_status: props.warehouse && locationDraft.value ? 'unassigned' : undefined, days: daysDraft.value === 7 ? 7 : undefined,
    stock_age: kind === 'age' ? age as AgeBand : undefined,
    waiting_direction: kind === 'incoming' || kind === 'outgoing' ? kind : undefined,
    waiting_age: kind === 'incoming' || kind === 'outgoing' ? age as AgeBand : undefined, has_loss: kind === 'loss' || undefined }
  if (filterResetRequested.value) { delete params.page; if (params.availability === 'owned') delete params.availability }
  apply(params, '')
  filtersOpen.value = false
}
function resetDialogFilters() {
  filterResetRequested.value = true; daysDraft.value = 30
  sourceDraft.value = ''; sourceTeamDraft.value = undefined; typeDraft.value = ''; materialDraft.value = ''; purposeDraft.value = undefined
  availabilityDraft.value = 'owned'; fieldDraft.value = 'all'; operatorDraft.value = 'eq'; queryDraft.value = ''; inputError.value = ''
  dateDraft.value = { from: '', to: '' }; urgentDraft.value = locationDraft.value = false; analysisDraft.value = ''
}
function paginate(value: number, size = pageSize.value) { apply({ ...filters.value, page: value, page_size: size }) }
let version = 0
async function load(background = false) {
  const current = ++version
  if (!background) { loading.value = true; error.value = '' }
  refreshError.value = ''
  try {
    const result = await teamMaterialApi.teamInventory(props.teamId, filters.value)
    if (current !== version) return
    if (page.value > 1 && !result.items.length && result.total <= (page.value - 1) * pageSize.value) { paginate(Math.max(1, Math.ceil(result.total / pageSize.value))); return }
    rows.value = result.items; total.value = result.total; asOf.value = result.as_of || ''; error.value = ''
    if (detail.value) detail.value = rows.value.find(row => row.group_id === detail.value?.group_id) || detail.value
  } catch (e) {
    if (current === version) {
      if (background) refreshError.value = '库存更新失败，当前保留上次结果，请刷新重试。'
      else { rows.value = []; total.value = 0; error.value = e instanceof Error ? e.message : '库存加载失败' }
    }
  } finally { if (current === version) loading.value = false }
}
function span({ rowIndex, column }: { rowIndex: number; column: { property: string } }) {
  if (!['serial_no', 'material_name'].includes(column.property)) return { rowspan: 1, colspan: 1 }
  const same = (a: TeamInventoryRow, b: TeamInventoryRow) => a.serial_no === b.serial_no && (column.property === 'serial_no' || (a.material_name === b.material_name && (separateSpecification.value || a.transfer_specification === b.transfer_specification)))
  if (rowIndex > 0 && same(rows.value[rowIndex - 1]!, rows.value[rowIndex]!)) return { rowspan: 0, colspan: 0 }
  let end = rowIndex + 1
  while (end < rows.value.length && same(rows.value[rowIndex]!, rows.value[end]!)) ++end
  return { rowspan: end - rowIndex, colspan: 1 }
}
function rowClass({ rowIndex }: { rowIndex: number }) { return rowIndex > 0 && rows.value[rowIndex - 1]!.serial_no !== rows.value[rowIndex]!.serial_no ? 'serial-group-start' : '' }
const detail = ref<TeamInventoryRow | null>(null), picker = ref<TeamInventoryRow | null>(null), pending = ref<TeamInventoryRow | null>(null)
const serialOpen = ref(false), serialNo = ref(''), urgencyOpen = ref(false), urgencySerial = ref('')
const canManageUrgency = computed(() => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError)
function asRow(row: unknown) { return row as TeamInventoryRow }
function openSerial(value: unknown) { serialNo.value = asRow(value).serial_no; serialOpen.value = true }
function flag(value: unknown) { urgencySerial.value = asRow(value).serial_no; urgencyOpen.value = true }
function action(mode: 'dispatch' | 'loss', sources: StockBatch[]) { if (props.canWrite) { picker.value = detail.value = null; serialOpen.value = false; emit('action', mode, sources) } }
function reallocate(source: StockBatch) { if (props.canWrite && props.canReallocate) { detail.value = null; emit('reallocate', source) } }
function resetDetails() { detail.value = picker.value = pending.value = null; serialOpen.value = urgencyOpen.value = false }
const searchBeforeFilters = ref({ query: '', field: 'all' as WarehouseSearchField, operator: 'eq' as 'eq' | 'gte' | 'lte' })
function openFilters() {
  searchBeforeFilters.value = { query: queryDraft.value, field: fieldDraft.value, operator: operatorDraft.value }
  syncFilterDrafts()
  restoreSearchDraft()
}
function restoreSearchDraft() { queryDraft.value = searchBeforeFilters.value.query; fieldDraft.value = searchBeforeFilters.value.field; operatorDraft.value = searchBeforeFilters.value.operator }
function cancelFilters() { syncFilterDrafts(); restoreSearchDraft() }
function syncFilterDrafts() {
  filterResetRequested.value = false
  queryDraft.value = text('query'); sourceDraft.value = text('receipt_source') as WarehouseSource | ''; typeDraft.value = text('material_type'); materialDraft.value = text('material_name')
  fieldDraft.value = warehouseSearchColumns.some(column => column.key === text('search_field')) ? text('search_field') as WarehouseSearchField : 'all'
  operatorDraft.value = text('search_operator') === 'gte' ? 'gte' : text('search_operator') === 'lte' ? 'lte' : 'eq'
  availabilityDraft.value = filters.value.availability; sourceTeamDraft.value = Number(text('source_team_id')) || undefined; inputError.value = ''
  purposeDraft.value = filters.value.purpose_id
  dateDraft.value = { ...dates.value }; urgentDraft.value = text('urgent_only') === 'true'; locationDraft.value = text('location_status') === 'unassigned'; analysisDraft.value = analysisChoice.value; daysDraft.value = days.value
}
watch([() => props.teamId, filters], () => {
  syncFilterDrafts()
  void load()
}, { immediate: true })
watch([() => props.teamId, () => props.warehouse], () => { purposes.value = []; void loadPurposes() }, { immediate: true })
watch(() => props.overview, () => { void load(true); void loadPurposes() })
watch([() => props.teamId, () => props.canWrite, () => auth.currentUser?.id], resetDetails)
onBeforeUnmount(() => { ++version; ++purposeVersion })
</script>

<template>
  <section class="warehouse-inventory serial-ledger workspace-data-panel">
    <div v-if="summarySection" class="warehouse-search-context"><ElButton link type="primary" @click="returnToSummary">返回{{ summaryLabel }}</ElButton><span>{{ summarySection === 'materials' ? text('material_name') || '全部材质' : text('material_type') === 'unknown' ? '未分类' : text('material_type') ? materialTypeLabel(text('material_type')) : '全部物料类型' }} · 库存明细</span></div>
    <ElAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <div class="warehouse-toolbar serial-toolbar workspace-data-toolbar" role="search" aria-label="库存查询">
      <div class="warehouse-search">
        <ElSelect v-if="searchKind === 'number'" v-model="operatorDraft" class="numeric-operator" aria-label="库存数值比较"><ElOption value="eq" label="等于" /><ElOption value="gte" label="不少于" /><ElOption value="lte" label="不多于" /></ElSelect>
        <ElDatePicker v-if="searchKind === 'date'" :model-value="queryDraft || null" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" aria-label="库存日期搜索" @update:model-value="queryDraft = $event || ''" @clear="queryDraft = ''; search()" />
        <ElSelect v-else-if="searchKind === 'status'" v-model="queryDraft" aria-label="库存加急状态" clearable @clear="queryDraft = ''; search()"><ElOption value="urgent" label="加急" /><ElOption value="normal" label="普通" /></ElSelect>
        <ElInput v-else v-model="queryDraft" :prefix-icon="searchKind === 'text' ? Search : undefined" aria-label="库存明细搜索" :placeholder="fieldDraft === 'all' ? '流水号、材质、业务或来源' : `搜索${searchColumns.find(column => column.key === fieldDraft)?.label}`" clearable @keyup.enter="search" @clear="search" />
      </div>
      <div class="inventory-filter-controls">
        <FilterDialog v-model="filtersOpen" title="库存筛选" :count="filterCount" @open="openFilters" @cancel="cancelFilters" @apply="applyDialogFilters" @reset="resetDialogFilters">
          <div class="filter-fields">
            <label>搜索字段<ElSelect v-model="fieldDraft" aria-label="库存搜索字段" filterable @change="queryDraft = ''; operatorDraft = 'eq'; inputError = ''"><ElOption value="all" label="综合搜索" /><ElOption v-for="column in searchColumns" :key="column.key" :value="column.key" :label="column.label" /></ElSelect></label>
            <label class="filter-wide">搜索内容<ElInput v-model="queryDraft" aria-label="库存筛选搜索内容" clearable placeholder="输入要查询的内容" /></label>
            <label v-if="warehouse">来源<ElSelect v-model="sourceDraft" class="warehouse-source-filter" aria-label="库存来源筛选" placeholder="全部来源" clearable><ElOption v-for="(label, value) in warehouseSourceNames" :key="value" :value="value" :label="label" /></ElSelect></label>
            <label v-else>上序班组<ElSelect v-model="sourceTeamDraft" class="warehouse-source-filter" aria-label="库存上序班组筛选" placeholder="全部上序" clearable filterable><ElOption v-for="team in sourceTeams" :key="team.id" :value="team.id" :label="team.name" /></ElSelect></label>
            <label>物料类型<ElSelect v-model="typeDraft" class="warehouse-type-filter" aria-label="库存物料类型筛选" placeholder="全部类型" clearable><ElOption v-for="item in materialTypeOptions" :key="item.value" :value="item.value" :label="item.label" /><ElOption value="unknown" label="未分类" /></ElSelect></label>
            <label v-if="!warehouse">本组业务<ElSelect v-model="purposeDraft" class="inventory-purpose-filter" aria-label="库存本组业务筛选" placeholder="全部本组业务" clearable filterable :loading="purposesLoading"><ElOption :value="0" label="未指定业务" /><ElOption v-for="purpose in purposes" :key="purpose.id" :value="purpose.id" :label="`${purpose.name}${purpose.active ? '' : '（已停用）'}`" /></ElSelect></label>
            <label>材质<ElSelect v-model="materialDraft" aria-label="库存材质筛选" clearable filterable placeholder="全部材质"><ElOption v-for="item in overview.materials" :key="item.material_name || '未填写材质'" :value="item.material_name || '未填写材质'" :label="item.material_name || '未填写材质'" /></ElSelect></label>
            <label>库存范围<ElSelect v-model="availabilityDraft" aria-label="库存范围"><ElOption value="owned" label="本班组库存（含转出待确认）" /><ElOption value="current" label="有未转出库存" /><ElOption value="available" label="正常料可转出" /><ElOption value="scrap" label="废料可处理" /><ElOption value="all" label="全部（含零库存）" /></ElSelect></label>
            <label v-if="warehouse && sourceDraft === 'internal'">来源班组<ElSelect v-model="sourceTeamDraft" aria-label="库房来源班组" clearable><ElOption v-for="team in sourceTeams" :key="team.id" :value="team.id" :label="team.name" /></ElSelect></label>
            <label>分析条件<ElSelect v-model="analysisDraft" aria-label="库存分析条件" placeholder="库存与流转条件" clearable ><ElOptionGroup label="库存停留"><ElOption v-for="[key, label] in ages" :key="key" :value="`age:${key}`" :label="`库存停留 ${label}`" /></ElOptionGroup><ElOptionGroup v-for="direction in ['incoming', 'outgoing']" :key="direction" :label="direction === 'incoming' ? '来料待签收' : '转出待确认'"><ElOption v-for="[key, label] in ages" :key="key" :value="`${direction}:${key}`" :label="`${direction === 'incoming' ? '来料待签收' : '转出待确认'} ${label}`" /></ElOptionGroup><ElOption value="loss" :label="`近${daysDraft}天有丢失记录`" /></ElSelect></label>
            <label>事件周期<ElSelect v-model="daysDraft" aria-label="库存事件筛选周期"><ElOption :value="7" label="近7天" /><ElOption :value="30" label="近30天" /></ElSelect></label>
            <ElCheckbox v-model="urgentDraft">仅看加急</ElCheckbox>
            <ElCheckbox v-if="warehouse" v-model="locationDraft">有未分配仓位的物料</ElCheckbox>
            <label>流转日期<RecordDateFilter v-model="dateDraft" label="流转日期" /></label>
            <ElAlert v-if="inputError" :title="inputError" type="warning" :closable="false" class="filter-wide" />
          </div>        </FilterDialog>
        <div class="inventory-query-actions"><ElButton @click="search">查询</ElButton></div>
      </div>
      <div class="inventory-table-tools" role="group" aria-label="表格工具">
        <InventoryColumnSettings :storage-key="storageKey" :columns="columns" :legacy-keys="warehouseLegacyColumnKeys" @change="columnChoices = $event" />
        <ElButton :icon="Refresh" :loading="loading" text aria-label="刷新工作台" title="刷新" @click="emit('refresh')" />
      </div>
      <div v-show="!fullscreen" class="workspace-toolbar-actions"><slot name="actions" /></div>
    </div>

    <ElAlert v-if="inputError" :title="inputError" type="warning" :closable="false" />
    <ElAlert v-if="!warehouse && purposesError" type="warning" :closable="false"><span>{{ purposesError }}</span><ElButton link type="primary" @click="loadPurposes">重试</ElButton></ElAlert>
    <div v-if="analysisLabel" class="warehouse-search-context"><ElTag closable @close="selectAnalysis('')">{{ analysisLabel }}</ElTag><span v-if="!text('stock_age')"> 符合条件流水号的分类库存</span></div>
    <div v-if="searchedColumn" class="warehouse-search-context"><ElTag closable @close="apply({ ...filters, query: undefined, search_field: undefined, search_operator: undefined, page: 1 })">按{{ searchedColumn.label }}查询 · 首列显示</ElTag></div>
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取库存" />
    <ElTable v-else class="business-table serial-table warehouse-table" :data="rows" height="100%" flexible row-key="group_id" :span-method="span" :row-class-name="rowClass" empty-text="暂无符合条件的库存">
      <ElTableColumn v-for="column in visibleColumns" :key="column.key" :prop="column.key" :label="column.label" :min-width="column.width" :align="'numeric' in column ? 'right' : 'left'" show-overflow-tooltip :label-class-name="column.key === searchedColumn?.key ? 'searched-column' : ''" :class-name="['serial_no', 'material_name'].includes(column.key) ? 'warehouse-group-cell' : 'numeric' in column ? 'inventory-number-cell' : ''">
        <template #default="{ row }">
          <div v-if="column.key === 'serial_no'" class="inventory-inline inventory-serial"><ElButton class="serial-number-link" :title="row.serial_no" link type="primary" @click="openSerial(row)"><strong>{{ row.serial_no }}</strong></ElButton><SerialUrgencyBadge :urgency="row.urgency" /><ElTooltip v-if="canManageUrgency" :content="row.urgency?.urgent ? '取消加急' : '标记加急'" placement="top"><ElButton class="warehouse-urgency-action" link type="primary" :icon="row.urgency?.urgent ? Close : Flag" :aria-label="row.urgency?.urgent ? '取消加急' : '标记加急'" @click="flag(row)" /></ElTooltip></div>
          <ElTooltip v-else-if="column.key === 'material_name'" :content="`规格：${row.transfer_specification}`" :disabled="!row.transfer_specification || separateSpecification" :trigger="['hover', 'focus']" placement="top"><span class="inventory-material" :tabindex="row.transfer_specification && !separateSpecification ? 0 : undefined">{{ row.material_name || '—' }}</span></ElTooltip>
          <ElTag v-else-if="column.key === 'material_type'" effect="light" :type="isScrapMaterialType(row.material_type) ? 'warning' : row.material_type === 'finished' ? 'success' : 'primary'">{{ column.format(asRow(row)) }}</ElTag>
          <ProcessingStockStatus v-else-if="column.key === 'stock_status' && processing" :summary="asRow(row)" :material-type="row.material_type" :pending="inventoryHasPending(asRow(row))" />
          <ElTooltip v-else-if="column.key === 'stock_status'" :content="ownershipHint(asRow(row))" :trigger="['hover', 'focus']" popper-class="inventory-balance-tooltip" placement="top"><ElTag :type="column.format(asRow(row)) === '重量差异' ? 'danger' : inventoryHasPending(asRow(row)) ? 'warning' : inventoryCanDispatch(asRow(row)) ? 'success' : 'info'" effect="light" tabindex="0">{{ column.format(asRow(row)) }}</ElTag></ElTooltip>
          <div v-else-if="column.key === 'source' && warehouse" class="inventory-inline"><span class="inventory-source-name">{{ row.receipt_source === 'opening' ? '初始库存' : row.source_name || '—' }}</span></div>
          <span v-else-if="column.key === 'dispatchable_quantity' || column.key === 'dispatchable_weight'" :title="isScrapMaterialType(row.material_type) ? '废料可处理的库存' : '正常料可转出的库存'">{{ column.format(asRow(row)) }}</span>
          <template v-else-if="column.key === 'in_transit_quantity' || column.key === 'in_transit_weight'">
            <ElButton v-if="row.in_transit_quantity > 0 || row.in_transit_weight > 0" link type="primary" :aria-label="`查看${row.serial_no}转出待签收批次`" @click="pending = asRow(row)">{{ column.format(asRow(row)) }}</ElButton>
            <span v-else>{{ column.format(asRow(row)) }}</span>
          </template>
          <ElTooltip v-else-if="column.key === 'owned_quantity' || column.key === 'owned_weight' || column.key === 'on_hand_quantity' || column.key === 'on_hand_weight'" :content="column.key.startsWith('owned_') ? ownershipHint(asRow(row)) : '尚未转出的库存，不含已转出待确认的物料'" :trigger="['hover', 'focus']" popper-class="inventory-balance-tooltip" placement="top">
            <span class="inventory-balance" :class="{ 'inventory-balance--shortage': column.format(asRow(row)).startsWith('-') }" :data-field="column.key" tabindex="0"><strong>{{ column.format(asRow(row)) }}</strong></span>
          </ElTooltip>
          <span v-else-if="column.key === 'purpose_name'">{{ row.purpose_name || '—' }}</span>
          <span v-else>{{ column.format(asRow(row)) }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" :width="actionWidth" align="right" fixed="right"><template #default="{ row }"><div class="inventory-row-actions"><ElButton link type="primary" @click="detail = asRow(row)">明细</ElButton><ElButton v-if="processing && canWrite && !isScrapMaterialType(row.material_type) && (row.on_hand_quantity > 0 || row.on_hand_weight > 0)" link class="action-cool" @click="emit('process', row.group_id)">加工登记</ElButton><ElButton v-if="canWrite && inventoryCanDispatch(asRow(row))" link class="action-warm" @click="picker = asRow(row)">出库</ElButton><ElButton v-if="inventoryHasPending(asRow(row))" link type="primary" @click="pending = asRow(row)">{{ Number(row.external_pending_quantity) > 0 || Number(row.external_pending_weight) > 0 ? '查看转出' : '在途转出' }}</ElButton></div></template></ElTableColumn>
    </ElTable>
    <footer v-if="!error"><span>共 {{ total }} 条库存记录<small v-if="asOf" class="inventory-as-of">系统记录 · {{ formatDateTime(asOf) }}</small></span><ElPagination background :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="paginate($event)" @size-change="paginate(1, $event)" /></footer>
    <TeamInventoryDetail :team-id="teamId" :group="detail" :warehouse="warehouse" :can-write="canWrite" :can-reallocate="canReallocate" :processing="processing" @reallocate="reallocate" @close="detail = null" @changed="emit('changed')" @action="action" @pending="pending = detail" />
    <InventoryPendingDialog v-if="pending" :team-id="teamId" :group="pending" @close="pending = null" @changed="load(true); emit('changed')" />
    <StockSourcePicker v-if="picker && canWrite" :team-id="teamId" :group-id="picker.group_id" :group-label="[picker.serial_no, materialTypeLabel(picker.material_type || null), picker.purpose_name, sourceLabel(picker)].filter(Boolean).join(' · ')" @close="picker = null" @selected="action('dispatch', $event)" />
    <SerialMaterialDrawer v-model="serialOpen" :team-id="teamId" :serial-no="serialNo" :can-write="canWrite" @changed="emit('changed')" @action="action" />
    <SerialUrgencyDialog v-model="urgencyOpen" :serial-no="urgencySerial" @changed="load(); emit('changed')" />
  </section>
</template>

<style scoped>
.warehouse-inventory { min-width: 0; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--card-radius); background: var(--surface); container-type: inline-size; }
.warehouse-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 0; }
.warehouse-search { display: flex; gap: 8px; flex: 1 1 220px; min-width: 200px; }
.warehouse-search > .el-select { min-width: 0; }
.warehouse-search > .el-input { min-width: 0; }
.warehouse-search > .numeric-operator { width: 98px; }
.warehouse-search > :last-child { flex: 1; min-width: 0; width: 100%; }
.inventory-filter-controls, .inventory-query-actions, .inventory-table-tools { display: flex; align-items: center; gap: 8px; }
.inventory-filter-controls { flex-wrap: wrap; }
.inventory-table-tools { margin-left: auto; flex-shrink: 0; padding-left: 12px; border-left: 1px solid var(--line); }
.warehouse-toolbar :deep(.record-date-trigger) { max-width: 260px; min-width: 0; }
.warehouse-toolbar :deep(.record-date-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warehouse-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.inventory-table-tools > .el-button { width: 36px; padding: 0; }
.warehouse-search-context { padding-bottom: 12px; }
.warehouse-table { --business-table-font: 14px; --business-table-padding: 11px; font-variant-numeric: tabular-nums; }
.warehouse-table.el-table.business-table :deep(th.el-table__cell) { height: 44px; }
.warehouse-table.el-table.business-table :deep(.cell) { white-space: nowrap; overflow-wrap: normal; }
.inventory-inline { display: flex; align-items: center; justify-content: flex-start; gap: 8px; min-width: 0; white-space: nowrap; line-height: 24px; }
.inventory-source-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.inventory-inline .el-tag { flex-shrink: 0; }
.inventory-balance { display: block; overflow: hidden; text-overflow: ellipsis; }
.inventory-balance strong { font-size: var(--workspace-number-size, 15px); font-weight: 550; color: var(--text); }
.inventory-material:focus-visible, .inventory-balance:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 3px; }
:global(.inventory-balance-tooltip) { white-space: pre-line; line-height: 1.7; }
.inventory-row-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; white-space: nowrap; }
.inventory-row-actions :deep(.el-button + .el-button) { margin-left: 0; }
.inventory-as-of { display: block; margin-top: 4px; font-size: 13px; }
.warehouse-table :deep(.searched-column) { color: var(--primary); }
.warehouse-table :deep(td.warehouse-group-cell) { border-right: 1px solid var(--line); }
.warehouse-table :deep(tr.serial-group-start > td) { border-top: 1px solid var(--table-header-line); }
.warehouse-table.el-table.business-table :deep(.el-tag) { font-size: 12px; border: 0; padding: 0 9px; height: 26px; line-height: 24px; }
.warehouse-table :deep(.serial-number-link) { min-width: 0; max-width: 100%; flex-shrink: 1; }
.warehouse-table :deep(.serial-number-link > span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warehouse-table :deep(.serial-number-link strong) { font-weight: 550; }
.warehouse-table :deep(.el-button.warehouse-urgency-action) { flex: 0 0 26px; width: 26px; height: 26px; margin: 0; font-size: 15px; }
.inventory-serial :deep(.serial-urgency-badge) { flex-shrink: 0; margin-left: 0; }
.warehouse-inventory > footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 56px; padding: 14px 12px; border-top: 1px solid var(--line); }
.warehouse-inventory > footer > span { color: var(--muted); font-size: 14px; }
@container (max-width: 680px) {
  .warehouse-search { flex-basis: 100%; }
  .inventory-filter-controls { flex: 1; }
}
@container (max-width: 560px) {
  .warehouse-toolbar { display: flex; gap: 8px; }
  .warehouse-search { flex-basis: 100%; min-width: 0; }
  .inventory-filter-controls { display: flex; flex: 0 0 auto; flex-wrap: nowrap; }
  .inventory-query-actions { flex: 0 0 auto; }
  .inventory-table-tools { margin-left: auto; padding-left: 0; border-left: 0; }
}
@media (max-width: 760px) {
  .warehouse-inventory { padding-inline: 12px; }
  .warehouse-search { min-width: 0; }
  .warehouse-inventory > footer { flex-wrap: wrap; overflow-x: auto; }
  .warehouse-table :deep(.el-table-fixed-column--right) { position: relative !important; right: auto !important; }
  .warehouse-table :deep(.el-table-fixed-column--right::before) { box-shadow: none; }
  .warehouse-table :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
}
.inventory-balance--shortage strong { color: var(--el-color-danger); }
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDatePicker, ElInput, ElOption, ElOptionGroup, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import SerialUrgencyDialog from './SerialUrgencyDialog.vue'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import { defaultInventoryColumns, inventoryColumns, inventorySearchColumns, inventorySearchKind, serialNumberColumn, type InventorySearchField } from '@/types/inventoryColumns'
import { ElCheckbox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import type { CalendarRange } from '@/types/recordFilters'
import StatePanel from './StatePanel.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTypeLabel, materialTypeOptions } from '@/types/materialTransfer'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'
import type { AgeBand, SerialParams, SerialSummary } from '@/types/materialAnalytics'
const props = defineProps<{ teamId: number; overview: TeamMaterialOverview; canWrite?: boolean }>()
const emit = defineEmits<{ changed: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]] }>()
const route = useRoute(), router = useRouter()
const auth = useAuthStore()
const columnChoices = ref(defaultInventoryColumns())
const columnStorageKey = computed(() => auth.currentUser?.id ? `heatsink.inventory-columns.v1:${auth.currentUser.id}:${props.teamId}` : null)
const activeSearchColumn = computed(() => text('query').trim() ? inventorySearchColumns.find(column => column.key === text('search_field')) : undefined)
const visibleColumns = computed(() => {
  const saved = [serialNumberColumn, ...columnChoices.value.filter(column => column.visible).map(choice => inventoryColumns.find(column => column.key === choice.key)!)]
  if (text('availability') === 'scrap') for (const column of inventoryColumns.filter(column => column.key.startsWith('scrap_'))) if (!saved.some(item => item.key === column.key)) saved.push(column)
  return activeSearchColumn.value ? [activeSearchColumn.value, ...saved.filter(column => column.key !== activeSearchColumn.value!.key)] : saved
})
const urgencyOpen = ref(false), urgencySerial = ref('')
const canManageUrgency = computed(() => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError)
const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const days = computed<7 | 30>(() => text('days') === '7' ? 7 : 30)
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10)
const filterLabel = computed(() => text('filter_label'))
const queryDraft = ref(''), analysisFilter = ref('')
const searchFieldDraft = ref<InventorySearchField>('all'), searchOperatorDraft = ref<'eq' | 'gte' | 'lte'>('eq')
const searchKind = computed(() => inventorySearchKind(searchFieldDraft.value))
const searchColumn = computed(() => inventorySearchColumns.find(column => column.key === searchFieldDraft.value))
const searchPlaceholder = computed(() => searchKind.value === 'number' ? `输入${searchColumn.value?.label}` : searchFieldDraft.value === 'all' ? '流水号、材质、客户编号等' : `搜索${searchColumn.value?.label}`)
const searchInputError = ref('')
function changeSearchField() { queryDraft.value = ''; searchOperatorDraft.value = 'eq'; searchInputError.value = '' }
const materialDraft = ref(''), availabilityDraft = ref<'all' | 'available' | 'scrap'>('available'), moreFilters = ref(false)
const materialNames = computed(() => props.overview.materials.map(item => item.material_name || '未填写材质'))
const rows = ref<SerialSummary[]>([]), total = ref(0)
const listError = ref(''), listLoading = ref(false)
const refreshError = ref('')
const detailOpen = ref(false), detailSerial = ref('')
const dateRange = computed(() => ({ from: text('date_from') || text('activity_day'), to: text('date_to') || text('activity_day') }))
function selectDate(value: CalendarRange) { applyFilter({ ...filters.value, ...basicFilters(), activity_day: undefined, activity_kind: undefined, date_from: value.from || undefined, date_to: value.to || undefined, page: 1 }) }
function flag(row: unknown) { urgencySerial.value = (row as SerialSummary).serial_no; urgencyOpen.value = true }
let listVersion = 0
const filters = computed<SerialParams>(() => {
  const params: Record<string, string | number | boolean> = { days: days.value, page: page.value, page_size: pageSize.value }
  for (const key of ['query', 'search_field', 'search_operator', 'serial_no', 'material_name', 'material_type', 'stock_age', 'waiting_age', 'waiting_direction', 'activity_day', 'activity_kind', 'flow_direction', 'peer']) if (text(key)) params[key] = text(key)
  if (text('has_loss') === 'true') params.has_loss = true
  if (text('date_from')) params.date_from = text('date_from')
  if (text('date_to')) params.date_to = text('date_to')
  if (text('urgent_only') === 'true') params.urgent_only = true
  params.availability = text('availability') === 'scrap' ? 'scrap' : text('availability') === 'all' ? 'all' : 'available'
  return params as SerialParams
})
function viewQuery() { return { tab: 'stock', ...(days.value === 7 ? { days: '7' } : {}), ...(pageSize.value !== 10 ? { page_size: String(pageSize.value) } : {}), ...(text('metric') === 'quantity' ? { metric: 'quantity' } : {}) } }
function changeView(values: Record<string, string>) { void router.replace({ path: route.path, query: { ...route.query, ...values } }) }
function applyFilter(params: SerialParams = {}, label = '') { void router.replace({ path: route.path, query: { ...viewQuery(), ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])), ...(label ? { filter_label: label } : {}) } }) }
function basicFilters(): SerialParams { return { date_from: text('date_from') || undefined, date_to: text('date_to') || undefined, urgent_only: text('urgent_only') === 'true' || undefined, query: queryDraft.value.trim() || undefined, search_field: queryDraft.value.trim() && searchFieldDraft.value !== 'all' ? searchFieldDraft.value : undefined, search_operator: queryDraft.value.trim() && searchKind.value === 'number' ? searchOperatorDraft.value : undefined, material_name: materialDraft.value || undefined, availability: availabilityDraft.value } }
function search() {
  searchInputError.value = ''
  const term = queryDraft.value.trim()
  if (term && searchKind.value === 'number') {
    const value = Number(term)
    if (!Number.isFinite(value) || value < 0 || value > 1e15 || (searchFieldDraft.value.endsWith('quantity') && !/^\d+$/.test(term)) || (searchFieldDraft.value.endsWith('weight') && !/^\d+(\.\d{1,3})?$/.test(term))) {
      searchInputError.value = searchFieldDraft.value.endsWith('weight') ? '请输入非负重量，最多三位小数。' : '请输入非负整数件数。'
      return
    }
  }
  applyFilter({ ...filters.value, ...basicFilters(), page: 1 }, filterLabel.value)
}
function clearFieldSearch() { applyFilter({ ...filters.value, query: undefined, search_field: undefined, search_operator: undefined, page: 1 }, filterLabel.value) }
function paginate(next: number, size = pageSize.value) { changeView({ page: String(next), page_size: String(size) }) }
const ages: [AgeBand, string][] = [['lt1', '不足1天'], ['1_3', '1–3天'], ['3_7', '3–7天'], ['ge7', '7天及以上']]
function selectAnalysis(value: string) {
  const [kind, age] = value.split(':')
  const label = ages.find(row => row[0] === age)?.[1]
  const basic = basicFilters()
  if (kind === 'age') applyFilter({ ...basic, stock_age: age as AgeBand }, `库存停留：${label}`)
  else if (kind === 'incoming' || kind === 'outgoing') applyFilter({ ...basic, waiting_direction: kind, waiting_age: age as AgeBand }, `${kind === 'incoming' ? '待接收' : '转出待确认'}：${label}`)
  else if (kind === 'type') applyFilter({ ...basic, material_type: age }, `物料类型：${materialTypeLabel(age)}`)
  else if (kind === 'loss') applyFilter({ ...basic, has_loss: true }, `近${days.value}天有丢失记录`)
  else applyFilter(basic)
}
async function loadRows(background = false) {
  const current = ++listVersion; if (!background) { listLoading.value = true; listError.value = '' }
  refreshError.value = ''
  try { const result = await teamMaterialApi.serials(props.teamId, filters.value); if (current === listVersion) { rows.value = result.items; total.value = result.total; listError.value = '' } }
  catch (e) { if (current === listVersion) { if (background) refreshError.value = '台账更新失败，保留上次结果，请刷新重试。'; else { rows.value = []; total.value = 0; listError.value = e instanceof Error ? e.message : '流水号列表加载失败' } } }
  finally { if (current === listVersion) listLoading.value = false }
}
function open(value: unknown) { detailSerial.value = (value as SerialSummary).serial_no; detailOpen.value = true }
watch([() => props.teamId, filters], () => { queryDraft.value = text('query'); searchFieldDraft.value = inventorySearchColumns.some(column => column.key === text('search_field')) ? text('search_field') as InventorySearchField : 'all'; searchOperatorDraft.value = text('search_operator') === 'gte' ? 'gte' : text('search_operator') === 'lte' ? 'lte' : 'eq'; searchInputError.value = ''; materialDraft.value = text('material_name'); availabilityDraft.value = text('availability') === 'scrap' ? 'scrap' : text('availability') === 'all' ? 'all' : 'available'; analysisFilter.value = ''; void loadRows() }, { immediate: true })
watch(() => props.overview, () => { void loadRows(true) })
watch(() => props.teamId, () => { detailOpen.value = false; rows.value = [] })
onBeforeUnmount(() => { ++listVersion })
function action(mode: 'dispatch' | 'loss', sources: StockBatch[]) {
  if (!props.canWrite) return
  detailOpen.value = false
  emit('action', mode, sources)
}
</script>
<template>
  <div class="serial-overview">
    <ElAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <section class="serial-ledger">
      <header class="serial-toolbar">
        <div class="serial-search">
          <ElSelect v-model="searchFieldDraft" aria-label="库存搜索字段" filterable @change="changeSearchField"><ElOption value="all" label="综合文字" /><ElOption v-for="column in inventorySearchColumns" :key="column.key" :value="column.key" :label="column.label" /></ElSelect>
          <ElSelect v-if="searchKind === 'number'" v-model="searchOperatorDraft" class="search-comparison" aria-label="数值比较方式"><ElOption value="eq" label="等于" /><ElOption value="gte" label="不少于" /><ElOption value="lte" label="不多于" /></ElSelect>
          <ElDatePicker v-if="searchKind === 'date'" :model-value="queryDraft || null" type="date" value-format="YYYY-MM-DD" placeholder="最近流转日期" aria-label="最近流转日期" @update:model-value="queryDraft = $event || ''" @clear="queryDraft = ''; search()" />
          <ElSelect v-else-if="searchKind === 'status'" v-model="queryDraft" aria-label="搜索加急状态" placeholder="选择状态" clearable @clear="search"><ElOption value="urgent" label="加急" /><ElOption value="normal" label="普通" /></ElSelect>
          <ElInput v-else v-model="queryDraft" :prefix-icon="searchKind === 'text' ? Search : undefined" :inputmode="searchKind === 'number' ? 'decimal' : 'text'" aria-label="库存明细搜索" :placeholder="searchPlaceholder" clearable @keyup.enter="search" @clear="search" />
        </div>
        <RecordDateFilter :model-value="dateRange" label="流转日期" @update:model-value="selectDate" />
        <ElCheckbox :model-value="text('urgent_only') === 'true'" @change="applyFilter({ ...filters, ...basicFilters(), urgent_only: $event === true || undefined, page: 1 }, filterLabel)">仅看加急</ElCheckbox>
        <ElButton @click="search">查询</ElButton><ElButton text @click="applyFilter()">重置</ElButton>
        <ElButton class="more-filters-button" text :icon="ArrowDown" :type="materialDraft || availabilityDraft === 'available' ? 'primary' : 'default'" :aria-expanded="moreFilters" aria-controls="serial-extra-filters" @click="moreFilters = !moreFilters">更多筛选</ElButton>
        <InventoryColumnSettings :storage-key="columnStorageKey" @change="columnChoices = $event" />
      </header>
      <ElAlert v-if="searchInputError" :title="searchInputError" type="warning" :closable="false" />
      <div v-if="activeSearchColumn" class="serial-search-context"><ElTag closable @close="clearFieldSearch">按{{ activeSearchColumn.label }}查询 · 首列显示</ElTag></div>
      <div v-if="moreFilters" id="serial-extra-filters" class="serial-extra-filters">
        <label class="filter-field"><span>材质</span><ElSelect v-model="materialDraft" aria-label="台账材质筛选" filterable clearable placeholder="全部" @change="search"><ElOption v-for="name in materialNames" :key="name" :value="name" :label="name" /></ElSelect></label>
        <label class="filter-field"><span>库存</span><ElSelect v-model="availabilityDraft" aria-label="台账库存筛选" @change="search"><ElOption value="all" label="全部" /><ElOption value="available" label="有正常可用库存" /><ElOption value="scrap" label="有废料库存" /></ElSelect></label>
        <label class="filter-field"><span>条件</span><ElSelect v-model="analysisFilter" aria-label="分析条件筛选" placeholder="库存与流转条件" clearable @change="selectAnalysis"><ElOptionGroup label="库存停留"><ElOption v-for="[key, label] in ages" :key="key" :value="`age:${key}`" :label="`库存停留 ${label}`" /></ElOptionGroup><ElOptionGroup v-for="direction in ['incoming','outgoing']" :key="direction" :label="direction === 'incoming' ? '待接收' : '转出待确认'"><ElOption v-for="[key, label] in ages" :key="key" :value="`${direction}:${key}`" :label="`${direction === 'incoming' ? '待接收' : '转出待确认'} ${label}`" /></ElOptionGroup><ElOptionGroup label="物料类型"><ElOption v-for="item in materialTypeOptions" :key="item.value" :value="`type:${item.value}`" :label="item.label" /></ElOptionGroup><ElOption value="loss" :label="`近${days}天有丢失记录`" /></ElSelect></label>
        <label class="filter-field"><span>事件周期</span><ElSelect :model-value="days" aria-label="台账事件筛选周期" @update:model-value="changeView({ days: String($event), page: '1' })"><ElOption :value="7" label="近7天" /><ElOption :value="30" label="近30天" /></ElSelect></label>
      </div>
      <div v-if="filterLabel" class="serial-filter-context"><ElTag size="small" closable @close="applyFilter(basicFilters())">{{ filterLabel }}</ElTag><span>显示符合条件流水号的完整余额</span></div>
      <StatePanel v-if="listError" state="error" :description="listError" @retry="loadRows" /><StatePanel v-else-if="listLoading" state="loading" title="正在读取库存明细" />
      <ElTable v-else :data="rows" row-key="serial_no" class="business-table serial-table" empty-text="暂无符合条件的流水号">
        <ElTableColumn v-for="(column, index) in visibleColumns" :key="column.key" :column-key="column.key" :label="column.label" :min-width="column.width" :fixed="index === 0 ? 'left' : undefined" align="center" :label-class-name="column.key === activeSearchColumn?.key ? 'searched-column' : ''" :class-name="'numeric' in column ? 'ledger-number' : ''" show-overflow-tooltip>
          <template #default="{ row }">
            <ElButton v-if="column.key === 'serial_no'" class="serial-number-link" link type="primary" @click="open(row)">{{ row.serial_no }}</ElButton>
            <SerialUrgencyBadge v-if="column.key === 'serial_no'" :urgency="row.urgency" />
            <span v-else>{{ column.format(row as SerialSummary) }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" :width="canManageUrgency ? 170 : 64" fixed="right" align="center"><template #default="{ row }"><ElButton link type="primary" @click="open(row)">详情</ElButton><ElButton v-if="canManageUrgency" link :type="row.urgency?.urgent ? 'danger' : 'primary'" @click="flag(row)">{{ row.urgency?.urgent ? '取消加急' : '标记加急' }}</ElButton></template></ElTableColumn>
      </ElTable>
      <footer v-if="!listError"><span>共 {{ total }} 个流水号</span><ElPagination background :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="paginate($event)" @size-change="paginate(1, $event)" /></footer>
    </section>
    <SerialMaterialDrawer v-model="detailOpen" :team-id="teamId" :serial-no="detailSerial" :can-write="canWrite" @changed="emit('changed')" @action="action" />
    <SerialUrgencyDialog v-model="urgencyOpen" :serial-no="urgencySerial" @changed="loadRows(); emit('changed')" />
  </div>
</template>
<style scoped>
.serial-overview { display: flex; flex-direction: column; gap: 10px; }
.serial-ledger { container-type: inline-size; display: flex; flex-direction: column; background: #fff; }
.serial-toolbar, .serial-extra-filters { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 16px 0; flex-wrap: wrap; }
.serial-toolbar { flex-wrap: nowrap; }
.serial-search { display: flex; flex: 1 1 420px; min-width: 300px; max-width: 590px; gap: 8px; }
.serial-search > .el-select { width: 150px; flex-shrink: 0; }
.serial-search > .search-comparison { width: 96px; }
.serial-search > .el-input { flex: 1; min-width: 120px; width: auto; }
.serial-search > .el-select:last-child { flex: 1; }
.serial-search-context { padding-bottom: 12px; }
.serial-table :deep(.searched-column) { color: var(--el-color-primary); font-weight: 600; }
.serial-toolbar :deep(.record-date-trigger) { flex-shrink: 0; max-width: 280px; }
.serial-toolbar :deep(.record-date-trigger > span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-field { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; white-space: nowrap; }
.filter-field > .el-select { width: 135px; }
.serial-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.serial-toolbar :deep(.el-button.inventory-columns-trigger) { margin-left: auto; }
.serial-toolbar .more-filters-button { font-size: 15px; }
.serial-extra-filters { padding-top: 0; }
.serial-filter-context { display: flex; flex-shrink: 0; gap: 12px; align-items: center; padding: 0 12px 10px; color: var(--subtle); font-size: 12px; }
.serial-table { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.serial-table :deep(.cell) { white-space: nowrap; }
.serial-table :deep(.el-button) { max-width: 100%; height: 20px; min-height: 0; border: 0; vertical-align: middle; font-size: 14px; line-height: 20px; padding: 0; }
.serial-table :deep(.el-button > span) { display: block; overflow: hidden; text-overflow: ellipsis; }
.serial-ledger footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; min-height: 60px; padding: 12px 16px; border-top: 1px solid var(--line); }
.serial-ledger footer > span { color: var(--muted); font-size: 13px; white-space: nowrap; }
@container (max-width: 1180px) { .serial-toolbar { flex-wrap: wrap; }.serial-search { max-width: none; } }
@media(max-width:760px) { .serial-search { flex-basis: 100%; min-width: 0; flex-wrap: wrap; }.serial-search > .el-input { flex-basis: 100%; }.filter-field { flex: 1; }.filter-field > .el-select { width: auto; min-width: 90px; flex: 1; }.serial-extra-filters { flex-wrap: wrap; }.serial-ledger footer { flex-wrap: wrap; }.serial-ledger footer > .el-pagination { max-width: 100%; overflow-x: auto; }.serial-table :deep(.el-table-fixed-column--left), .serial-table :deep(.el-table-fixed-column--right) { position: static !important; }.serial-table :deep(.el-table-fixed-column--left::before), .serial-table :deep(.el-table-fixed-column--right::before) { display: none; } }
</style>

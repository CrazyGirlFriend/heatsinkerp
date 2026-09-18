<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElCheckbox, ElDatePicker, ElInput, ElOption, ElPagination, ElPopover, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import SerialUrgencyDialog from './SerialUrgencyDialog.vue'
import StockSourcePicker from './StockSourcePicker.vue'
import WarehouseInventoryDetail from './WarehouseInventoryDetail.vue'
import StatePanel from './StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTypeOptions, isScrapType as isScrapMaterialType } from '@/types/materialTransfer'
import { warehouseColumns, warehouseSearchColumns, warehouseSearchKind, warehouseSerialColumn, warehouseSourceLabel, warehouseSourceNames, type WarehouseColumnKey, type WarehouseInventoryParams, type WarehouseInventoryRow, type WarehouseSearchField, type WarehouseSource } from '@/types/warehouseInventory'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import type { CalendarRange } from '@/types/recordFilters'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'

const props = defineProps<{ teamId: number; overview: TeamMaterialOverview; canWrite?: boolean }>()
const emit = defineEmits<{ changed: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]] }>()
const route = useRoute(), router = useRouter(), auth = useAuthStore(), directory = useTeamDirectoryStore()
const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10)
const rows = ref<WarehouseInventoryRow[]>([]), total = ref(0), loading = ref(false), error = ref(''), refreshError = ref('')
const queryDraft = ref(''), sourceDraft = ref<WarehouseSource | ''>(''), typeDraft = ref(''), materialDraft = ref('')
const fieldDraft = ref<WarehouseSearchField>('all'), operatorDraft = ref<'eq' | 'gte' | 'lte'>('eq'), inputError = ref('')
const availabilityDraft = ref<WarehouseInventoryParams['availability']>('current'), sourceTeamDraft = ref<number | undefined>()
const searchKind = computed(() => warehouseSearchKind(fieldDraft.value))
const dates = computed(() => ({ from: text('date_from'), to: text('date_to') }))
const sourceTeams = computed(() => directory.items.filter(team => team.id !== props.teamId && team.kind !== 'warehouse'))
const columnChoices = ref<InventoryColumnChoice<WarehouseColumnKey>[]>(warehouseColumns.map(column => ({ key: column.key, visible: column.defaultVisible })))
const storageKey = computed(() => auth.currentUser?.id ? `heatsink.warehouse-columns.v1:${auth.currentUser.id}:${props.teamId}` : null)
const searchedColumn = computed(() => text('query').trim() ? warehouseSearchColumns.find(column => column.key === text('search_field')) : undefined)
const visibleColumns = computed(() => {
  const saved = [warehouseSerialColumn, ...columnChoices.value.filter(choice => choice.visible).map(choice => warehouseColumns.find(column => column.key === choice.key)!)]
  return searchedColumn.value ? [searchedColumn.value, ...saved.filter(column => column.key !== searchedColumn.value!.key)] : saved
})
const filters = computed<WarehouseInventoryParams>(() => {
  const params: Record<string, string | number | boolean> = { page: page.value, page_size: pageSize.value, availability: ['current', 'all', 'available', 'scrap'].includes(text('availability')) ? text('availability') : 'current' }
  for (const key of ['query', 'search_field', 'search_operator', 'serial_no', 'material_name', 'material_type', 'receipt_source', 'source_team_id', 'date_from', 'date_to', 'stock_age', 'waiting_age', 'waiting_direction', 'activity_day', 'activity_kind', 'flow_direction', 'peer', 'days']) if (text(key)) params[key] = text(key)
  for (const key of ['urgent_only', 'has_loss']) if (text(key) === 'true') params[key] = true
  return params as WarehouseInventoryParams
})
function apply(params: WarehouseInventoryParams = {}) {
  void router.replace({ path: route.path, query: { tab: 'stock', ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])) } })
}
function draftFilters(): WarehouseInventoryParams {
  return { ...filters.value, page: 1, query: queryDraft.value.trim() || undefined, search_field: queryDraft.value.trim() && fieldDraft.value !== 'all' ? fieldDraft.value : undefined,
    search_operator: queryDraft.value.trim() && searchKind.value === 'number' ? operatorDraft.value : undefined,
    receipt_source: sourceDraft.value || undefined, source_team_id: sourceDraft.value === 'internal' ? sourceTeamDraft.value : undefined,
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
function selectDate(value: CalendarRange) { if (validSearch()) apply({ ...draftFilters(), date_from: value.from || undefined, date_to: value.to || undefined }) }
function paginate(value: number, size = pageSize.value) { apply({ ...filters.value, page: value, page_size: size }) }
let version = 0
async function load(background = false) {
  const current = ++version
  if (!background) { loading.value = true; error.value = '' }
  refreshError.value = ''
  try {
    const result = await teamMaterialApi.warehouseInventory(props.teamId, filters.value)
    if (current !== version) return
    if (page.value > 1 && !result.items.length && result.total <= (page.value - 1) * pageSize.value) { paginate(Math.max(1, Math.ceil(result.total / pageSize.value))); return }
    rows.value = result.items; total.value = result.total; error.value = ''
  } catch (e) {
    if (current === version) {
      if (background) refreshError.value = '库存更新失败，当前保留上次结果，请刷新重试。'
      else { rows.value = []; total.value = 0; error.value = e instanceof Error ? e.message : '库房库存加载失败' }
    }
  } finally { if (current === version) loading.value = false }
}
function span({ rowIndex, column }: { rowIndex: number; column: { property: string } }) {
  if (!['serial_no', 'material_name'].includes(column.property)) return { rowspan: 1, colspan: 1 }
  const same = (a: WarehouseInventoryRow, b: WarehouseInventoryRow) => a.serial_no === b.serial_no && (column.property === 'serial_no' || a.material_name === b.material_name)
  if (rowIndex > 0 && same(rows.value[rowIndex - 1]!, rows.value[rowIndex]!)) return { rowspan: 0, colspan: 0 }
  let end = rowIndex + 1
  while (end < rows.value.length && same(rows.value[rowIndex]!, rows.value[end]!)) ++end
  return { rowspan: end - rowIndex, colspan: 1 }
}
function rowClass({ rowIndex }: { rowIndex: number }) { return rowIndex > 0 && rows.value[rowIndex - 1]!.serial_no !== rows.value[rowIndex]!.serial_no ? 'serial-group-start' : '' }
const detail = ref<WarehouseInventoryRow | null>(null), picker = ref<WarehouseInventoryRow | null>(null)
const serialOpen = ref(false), serialNo = ref(''), urgencyOpen = ref(false), urgencySerial = ref('')
const canManageUrgency = computed(() => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError)
function asRow(row: unknown) { return row as WarehouseInventoryRow }
function openSerial(value: unknown) { serialNo.value = asRow(value).serial_no; serialOpen.value = true }
function flag(value: unknown) { urgencySerial.value = asRow(value).serial_no; urgencyOpen.value = true }
function action(mode: 'dispatch' | 'loss', sources: StockBatch[]) { if (props.canWrite) { picker.value = detail.value = null; serialOpen.value = false; emit('action', mode, sources) } }
function resetDetails() { detail.value = picker.value = null; serialOpen.value = urgencyOpen.value = false }
watch([() => props.teamId, filters], () => {
  queryDraft.value = text('query'); sourceDraft.value = text('receipt_source') as WarehouseSource | ''; typeDraft.value = text('material_type'); materialDraft.value = text('material_name')
  fieldDraft.value = warehouseSearchColumns.some(column => column.key === text('search_field')) ? text('search_field') as WarehouseSearchField : 'all'
  operatorDraft.value = text('search_operator') === 'gte' ? 'gte' : text('search_operator') === 'lte' ? 'lte' : 'eq'
  availabilityDraft.value = filters.value.availability; sourceTeamDraft.value = Number(text('source_team_id')) || undefined; inputError.value = ''
  void load()
}, { immediate: true })
watch(() => props.overview, () => { void load(true) })
watch([() => props.teamId, () => props.canWrite, () => auth.currentUser?.id], resetDetails)
onBeforeUnmount(() => { ++version })
</script>

<template>
  <section class="warehouse-inventory serial-ledger">
    <ElAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <header class="warehouse-toolbar serial-toolbar">
      <div class="warehouse-search">
        <ElSelect v-model="fieldDraft" aria-label="库房搜索字段" filterable @change="queryDraft = ''; operatorDraft = 'eq'; inputError = ''"><ElOption value="all" label="综合搜索" /><ElOption v-for="column in warehouseSearchColumns" :key="column.key" :value="column.key" :label="column.label" /></ElSelect>
        <ElSelect v-if="searchKind === 'number'" v-model="operatorDraft" class="numeric-operator" aria-label="库房数值比较"><ElOption value="eq" label="等于" /><ElOption value="gte" label="不少于" /><ElOption value="lte" label="不多于" /></ElSelect>
        <ElDatePicker v-if="searchKind === 'date'" v-model="queryDraft" type="date" value-format="YYYY-MM-DD" placeholder="最近流转日期" aria-label="库房最近流转日期" />
        <ElSelect v-else-if="searchKind === 'status'" v-model="queryDraft" aria-label="库房加急状态"><ElOption value="urgent" label="加急" /><ElOption value="normal" label="普通" /></ElSelect>
        <ElInput v-else v-model="queryDraft" :prefix-icon="searchKind === 'text' ? Search : undefined" aria-label="库房库存搜索" :placeholder="fieldDraft === 'all' ? '流水号、材质或来源' : `搜索${warehouseSearchColumns.find(column => column.key === fieldDraft)?.label}`" clearable @keyup.enter="search" @clear="search" />
      </div>
      <ElSelect v-model="sourceDraft" class="warehouse-source-filter" aria-label="库存来源筛选" placeholder="全部来源" clearable @change="search"><ElOption v-for="(label, value) in warehouseSourceNames" :key="value" :value="value" :label="label" /></ElSelect>
      <ElSelect v-model="typeDraft" class="warehouse-type-filter" aria-label="库存物料类型筛选" placeholder="全部类型" clearable @change="search"><ElOption v-for="item in materialTypeOptions" :key="item.value" :value="item.value" :label="item.label" /></ElSelect>
      <RecordDateFilter :model-value="dates" label="流转日期" @update:model-value="selectDate" />
      <ElButton type="primary" @click="search">查询</ElButton><ElButton text @click="apply()">重置</ElButton>
      <ElPopover trigger="click" placement="bottom-end" :width="280">
        <template #reference><ElButton text :icon="ArrowDown">更多</ElButton></template>
        <div class="warehouse-extra-filters">
          <label>材质<ElSelect v-model="materialDraft" aria-label="库房材质筛选" clearable filterable placeholder="全部材质" @change="search"><ElOption v-for="item in overview.materials" :key="item.material_name || ''" :value="item.material_name || ''" :label="item.material_name || '未填写材质'" /></ElSelect></label>
          <label>库存范围<ElSelect v-model="availabilityDraft" aria-label="库房库存范围" @change="search"><ElOption value="current" label="当前库存（含废料）" /><ElOption value="available" label="正常可用库存" /><ElOption value="scrap" label="废料库存" /><ElOption value="all" label="全部（含已出完）" /></ElSelect></label>
          <label v-if="sourceDraft === 'internal'">来源班组<ElSelect v-model="sourceTeamDraft" aria-label="库房来源班组" clearable @change="search"><ElOption v-for="team in sourceTeams" :key="team.id" :value="team.id" :label="team.name" /></ElSelect></label>
          <ElCheckbox :model-value="text('urgent_only') === 'true'" @change="apply({ ...draftFilters(), urgent_only: $event === true || undefined })">仅看加急</ElCheckbox>
        </div>
      </ElPopover>
      <InventoryColumnSettings :storage-key="storageKey" :columns="warehouseColumns" @change="columnChoices = $event" />
    </header>
    <ElAlert v-if="inputError" :title="inputError" type="warning" :closable="false" />
    <div v-if="searchedColumn" class="warehouse-search-context"><ElTag closable @close="apply({ ...filters, query: undefined, search_field: undefined, search_operator: undefined, page: 1 })">按{{ searchedColumn.label }}查询 · 首列显示</ElTag></div>
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取库房库存" />
    <ElTable v-else class="business-table serial-table warehouse-table" :data="rows" row-key="group_id" :span-method="span" :row-class-name="rowClass" empty-text="暂无符合条件的库存">
      <ElTableColumn v-for="column in visibleColumns" :key="column.key" :prop="column.key" :label="column.label" :min-width="column.width" align="center" :label-class-name="column.key === searchedColumn?.key ? 'searched-column' : ''" :class-name="['serial_no', 'material_name'].includes(column.key) ? 'warehouse-group-cell' : ''" show-overflow-tooltip>
        <template #default="{ row }">
          <template v-if="column.key === 'serial_no'"><ElButton class="serial-number-link" :title="row.serial_no" link type="primary" @click="openSerial(row)"><strong>{{ row.serial_no }}</strong></ElButton><SerialUrgencyBadge :urgency="row.urgency" /><ElButton v-if="canManageUrgency" class="warehouse-urgency-action" link type="primary" @click="flag(row)">{{ row.urgency?.urgent ? '取消加急' : '标记加急' }}</ElButton></template>
          <ElTag v-else-if="column.key === 'material_type'" effect="light" :type="isScrapMaterialType(row.material_type) ? 'warning' : row.material_type === 'finished' ? 'success' : 'primary'">{{ column.format(asRow(row)) }}</ElTag>
          <span v-else>{{ column.format(asRow(row)) }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" :width="canWrite ? 128 : 80" align="center" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="detail = asRow(row)">明细</ElButton><ElButton v-if="canWrite" link type="primary" :disabled="!(row.on_hand_quantity > 0 || row.on_hand_weight > 0)" @click="picker = asRow(row)">出库</ElButton></template></ElTableColumn>
    </ElTable>
    <footer v-if="!error"><span>共 {{ total }} 条库存明细</span><ElPagination background :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="paginate($event)" @size-change="paginate(1, $event)" /></footer>
    <WarehouseInventoryDetail :team-id="teamId" :group="detail" :can-write="canWrite" @close="detail = null" @changed="emit('changed')" @action="action" />
    <StockSourcePicker v-if="picker && canWrite" :team-id="teamId" :group-id="picker.group_id" :group-label="`${picker.serial_no} · ${warehouseColumns[2].format(picker)} · ${warehouseSourceLabel(picker)}`" @close="picker = null" @selected="action('dispatch', $event)" />
    <SerialMaterialDrawer v-model="serialOpen" :team-id="teamId" :serial-no="serialNo" :can-write="canWrite" @changed="emit('changed')" @action="action" />
    <SerialUrgencyDialog v-model="urgencyOpen" :serial-no="urgencySerial" @changed="load(); emit('changed')" />
  </section>
</template>

<style scoped>
.warehouse-inventory { min-width: 0; background: var(--surface); container-type: inline-size; }
.warehouse-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; padding: 16px 0; }
.warehouse-search { display: flex; gap: 8px; flex: 1 1 360px; min-width: 310px; max-width: 460px; }
.warehouse-search > .el-select { width: 118px; flex-shrink: 0; }
.warehouse-search > .el-input { min-width: 140px; }
.warehouse-search > .numeric-operator { width: 98px; }
.warehouse-search > :last-child { flex: 1; }
.warehouse-toolbar > .el-select { width: 138px; flex-shrink: 0; }
.warehouse-toolbar :deep(.record-date-trigger) { max-width: 240px; flex-shrink: 0; }
.warehouse-toolbar :deep(.record-date-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warehouse-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.warehouse-extra-filters { display: flex; flex-direction: column; gap: 14px; }
.warehouse-extra-filters label { display: flex; flex-direction: column; gap: 8px; color: var(--muted); }
.warehouse-search-context { padding-bottom: 12px; }
.warehouse-table { --business-table-font: 18px; --business-table-padding: 11px; font-variant-numeric: tabular-nums; }
.warehouse-table.el-table.business-table :deep(th.el-table__cell) { height: 60px; }
.warehouse-table :deep(.cell) { white-space: nowrap; }
.warehouse-table :deep(.searched-column) { color: var(--primary); }
.warehouse-table :deep(td.warehouse-group-cell) { border-right: 1px solid var(--line); }
.warehouse-table :deep(tr.serial-group-start > td) { border-top: 1px solid var(--table-header-line); }
.warehouse-table.el-table.business-table :deep(.el-tag) { font-size: 16px; border: 0; padding: 5px 12px; height: auto; line-height: 22px; }
.warehouse-table :deep(.serial-number-link) { max-width: 100%; }
.warehouse-table :deep(.serial-number-link > span) { display: block; white-space: normal; overflow-wrap: anywhere; }
.warehouse-table :deep(.serial-number-link strong) { font-weight: 600; }
.warehouse-table :deep(.el-button.warehouse-urgency-action) { display: block; margin: 5px auto 0; font-size: 13px; }
.warehouse-inventory > footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 68px; padding: 14px 12px; border-top: 1px solid var(--line); }
.warehouse-inventory > footer > span { color: var(--muted); font-size: 14px; }
@container (max-width: 1230px) { .warehouse-toolbar { flex-wrap: wrap; }.warehouse-search { max-width: none; }.warehouse-toolbar :deep(.inventory-columns-trigger) { margin-left: auto; } }
@media (max-width: 760px) { .warehouse-search { min-width: 0; flex-basis: 100%; }.warehouse-toolbar > .el-select { flex: 1; min-width: 120px; }.warehouse-inventory > footer { flex-wrap: wrap; overflow-x: auto; } }
</style>

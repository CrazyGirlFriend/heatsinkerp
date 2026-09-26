<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElCheckbox, ElDatePicker, ElInput, ElOption, ElOptionGroup, ElPagination, ElPopover, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import InventoryMovementSummary from './InventoryMovementSummary.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import SerialUrgencyDialog from './SerialUrgencyDialog.vue'
import StockSourcePicker from './StockSourcePicker.vue'
import TeamInventoryDetail from './TeamInventoryDetail.vue'
import StatePanel from './StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTypeLabel, materialTypeOptions, isScrapType as isScrapMaterialType } from '@/types/materialTransfer'
import { warehouseColumns, warehouseSearchColumns, warehouseSearchKind, warehouseSerialColumn, inventorySourceLabel, warehouseSourceNames, inventoryAmount, inventoryAge, inventoryBalanceState, type WarehouseColumnKey, type TeamInventoryParams, type TeamInventoryRow, type WarehouseSearchField, type WarehouseSource } from '@/types/teamInventory'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import type { CalendarRange } from '@/types/recordFilters'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'
import type { AgeBand } from '@/types/materialAnalytics'

const props = defineProps<{ teamId: number; overview: TeamMaterialOverview; canWrite?: boolean; warehouse?: boolean }>()
const emit = defineEmits<{ changed: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]] }>()
const route = useRoute(), router = useRouter(), auth = useAuthStore(), directory = useTeamDirectoryStore()
const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10)
const rows = ref<TeamInventoryRow[]>([]), total = ref(0), loading = ref(false), error = ref(''), refreshError = ref('')
const queryDraft = ref(''), sourceDraft = ref<WarehouseSource | ''>(''), typeDraft = ref(''), materialDraft = ref('')
const fieldDraft = ref<WarehouseSearchField>('all'), operatorDraft = ref<'eq' | 'gte' | 'lte'>('eq'), inputError = ref('')
const availabilityDraft = ref<TeamInventoryParams['availability']>('current'), sourceTeamDraft = ref<number | undefined>()
const searchKind = computed(() => warehouseSearchKind(fieldDraft.value))
const days = computed<7 | 30>(() => text('days') === '7' ? 7 : 30)
const ages: [AgeBand, string][] = [['lt1', '不足1天'], ['1_3', '1–3天'], ['3_7', '3–7天'], ['ge7', '7天及以上']]
const analysisChoice = computed(() => text('stock_age') ? `age:${text('stock_age')}` : text('waiting_direction') ? `${text('waiting_direction')}:${text('waiting_age')}` : text('has_loss') === 'true' ? 'loss' : '')
const analysisLabel = computed(() => text('filter_label') || (text('stock_age') ? `库存停留：${ages.find(([key]) => key === text('stock_age'))?.[1] || text('stock_age')}` : text('waiting_direction') ? `${text('waiting_direction') === 'incoming' ? '待接收' : '转出待确认'}：${ages.find(([key]) => key === text('waiting_age'))?.[1] || ''}` : text('has_loss') === 'true' ? `近${days.value}天有丢失记录` : ''))
const dates = computed(() => ({ from: text('date_from') || text('activity_day'), to: text('date_to') || text('activity_day') }))
const sourceTeams = computed(() => directory.items.filter(team => team.id !== props.teamId))
const sourceLabel = (row: TeamInventoryRow) => inventorySourceLabel(row, props.warehouse)
const columns = computed(() => warehouseColumns.map(column => column.key === 'source' ? { ...column, label: props.warehouse ? '来源' : '上序班组', format: sourceLabel } : column))
const searchColumns = computed(() => warehouseSearchColumns.map(column => column.key === 'source' ? { ...column, label: props.warehouse ? '来源' : '上序班组' } : column))
const columnChoices = ref<InventoryColumnChoice<WarehouseColumnKey>[]>(warehouseColumns.map(column => ({ key: column.key, visible: column.defaultVisible })))
const storageKey = computed(() => auth.currentUser?.id ? `heatsink.${props.warehouse ? 'warehouse' : 'classified'}-columns.v1:${auth.currentUser.id}:${props.teamId}` : null)
const searchedColumn = computed(() => text('query').trim() ? searchColumns.value.find(column => column.key === text('search_field')) : undefined)
const visibleColumns = computed(() => {
  const saved = [warehouseSerialColumn, ...columnChoices.value.filter(choice => choice.visible).map(choice => columns.value.find(column => column.key === choice.key)!)]
  return searchedColumn.value ? [searchedColumn.value, ...saved.filter(column => column.key !== searchedColumn.value!.key)] : saved
})
const separateSpecification = computed(() => visibleColumns.value.some(column => column.key === 'transfer_specification'))
const separatePurpose = computed(() => visibleColumns.value.some(column => column.key === 'purpose_name'))
function columnLabel(key: string, label: string) {
  if (key === 'material_name' && !separateSpecification.value) return '材质 / 规格'
  if (key === 'material_type' && !separatePurpose.value) return '类型 / 业务'
  return label
}
const filters = computed<TeamInventoryParams>(() => {
  const params: Record<string, string | number | boolean> = { page: page.value, page_size: pageSize.value, availability: ['current', 'all', 'available', 'scrap'].includes(text('availability')) ? text('availability') : 'current' }
  for (const key of ['query', 'search_field', 'search_operator', 'serial_no', 'material_name', 'material_type', 'source_team_id', 'date_from', 'date_to', 'stock_age', 'waiting_age', 'waiting_direction', 'activity_day', 'activity_kind', 'flow_direction', 'peer', 'days']) if (text(key)) params[key] = text(key)
  if (props.warehouse && text('receipt_source')) params.receipt_source = text('receipt_source')
  if (text('source_team_id')) params.source_team_id = Number(text('source_team_id'))
  for (const key of ['urgent_only', 'has_loss']) if (text(key) === 'true') params[key] = true
  return params as TeamInventoryParams
})
function apply(params: TeamInventoryParams = {}, label = text('filter_label')) {
  void router.replace({ path: route.path, query: { tab: 'stock', ...(label ? { filter_label: label } : {}), ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])) } })
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
  return { ...filters.value, page: 1, query: queryDraft.value.trim() || undefined, search_field: queryDraft.value.trim() && fieldDraft.value !== 'all' ? fieldDraft.value : undefined,
    search_operator: queryDraft.value.trim() && searchKind.value === 'number' ? operatorDraft.value : undefined,
    receipt_source: props.warehouse ? sourceDraft.value || undefined : undefined, source_team_id: !props.warehouse || sourceDraft.value === 'internal' ? sourceTeamDraft.value : undefined,
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
function selectDate(value: CalendarRange) { if (validSearch()) apply({ ...draftFilters(), activity_day: undefined, activity_kind: undefined, date_from: value.from || undefined, date_to: value.to || undefined }) }
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
    rows.value = result.items; total.value = result.total; error.value = ''
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
const detail = ref<TeamInventoryRow | null>(null), picker = ref<TeamInventoryRow | null>(null)
const serialOpen = ref(false), serialNo = ref(''), urgencyOpen = ref(false), urgencySerial = ref('')
const canManageUrgency = computed(() => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError)
function asRow(row: unknown) { return row as TeamInventoryRow }
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
        <ElSelect v-model="fieldDraft" aria-label="库存搜索字段" filterable @change="queryDraft = ''; operatorDraft = 'eq'; inputError = ''"><ElOption value="all" label="综合搜索" /><ElOption v-for="column in searchColumns" :key="column.key" :value="column.key" :label="column.label" /></ElSelect>
        <ElSelect v-if="searchKind === 'number'" v-model="operatorDraft" class="numeric-operator" aria-label="库存数值比较"><ElOption value="eq" label="等于" /><ElOption value="gte" label="不少于" /><ElOption value="lte" label="不多于" /></ElSelect>
        <ElDatePicker v-if="searchKind === 'date'" :model-value="queryDraft || null" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" aria-label="库存日期搜索" @update:model-value="queryDraft = $event || ''" @clear="queryDraft = ''; search()" />
        <ElSelect v-else-if="searchKind === 'status'" v-model="queryDraft" aria-label="库存加急状态" clearable @clear="queryDraft = ''; search()"><ElOption value="urgent" label="加急" /><ElOption value="normal" label="普通" /></ElSelect>
        <ElInput v-else v-model="queryDraft" :prefix-icon="searchKind === 'text' ? Search : undefined" aria-label="库存明细搜索" :placeholder="fieldDraft === 'all' ? '流水号、材质、业务或来源' : `搜索${searchColumns.find(column => column.key === fieldDraft)?.label}`" clearable @keyup.enter="search" @clear="search" />
      </div>
      <ElSelect v-if="warehouse" v-model="sourceDraft" class="warehouse-source-filter" aria-label="库存来源筛选" placeholder="全部来源" clearable @change="search"><ElOption v-for="(label, value) in warehouseSourceNames" :key="value" :value="value" :label="label" /></ElSelect>
      <ElSelect v-else v-model="sourceTeamDraft" class="warehouse-source-filter" aria-label="库存上序班组筛选" placeholder="全部上序" clearable filterable @change="search"><ElOption v-for="team in sourceTeams" :key="team.id" :value="team.id" :label="team.name" /></ElSelect>
      <ElSelect v-model="typeDraft" class="warehouse-type-filter" aria-label="库存物料类型筛选" placeholder="全部类型" clearable @change="search"><ElOption v-for="item in materialTypeOptions" :key="item.value" :value="item.value" :label="item.label" /></ElSelect>
      <RecordDateFilter :model-value="dates" label="流转日期" @update:model-value="selectDate" />
      <ElButton type="primary" @click="search">查询</ElButton><ElButton text @click="apply({ page_size: pageSize }, '')">重置</ElButton>
      <ElPopover trigger="click" placement="bottom-end" :width="280">
        <template #reference><ElButton text :icon="ArrowDown">更多</ElButton></template>
        <div class="warehouse-extra-filters">
          <label>材质<ElSelect v-model="materialDraft" aria-label="库存材质筛选" clearable filterable placeholder="全部材质" @change="search"><ElOption v-for="item in overview.materials" :key="item.material_name || ''" :value="item.material_name || ''" :label="item.material_name || '未填写材质'" /></ElSelect></label>
          <label>库存范围<ElSelect v-model="availabilityDraft" aria-label="库存范围" @change="search"><ElOption value="current" label="当前库存（含废料）" /><ElOption value="available" label="正常可用库存" /><ElOption value="scrap" label="废料库存" /><ElOption value="all" label="全部（含无结存）" /></ElSelect></label>
          <label v-if="warehouse && sourceDraft === 'internal'">来源班组<ElSelect v-model="sourceTeamDraft" aria-label="库房来源班组" clearable @change="search"><ElOption v-for="team in sourceTeams" :key="team.id" :value="team.id" :label="team.name" /></ElSelect></label>
          <label>分析条件<ElSelect :model-value="analysisChoice" aria-label="库存分析条件" placeholder="库存与流转条件" clearable @change="selectAnalysis"><ElOptionGroup label="库存停留"><ElOption v-for="[key, label] in ages" :key="key" :value="`age:${key}`" :label="`库存停留 ${label}`" /></ElOptionGroup><ElOptionGroup v-for="direction in ['incoming', 'outgoing']" :key="direction" :label="direction === 'incoming' ? '待接收' : '转出待确认'"><ElOption v-for="[key, label] in ages" :key="key" :value="`${direction}:${key}`" :label="`${direction === 'incoming' ? '待接收' : '转出待确认'} ${label}`" /></ElOptionGroup><ElOption value="loss" :label="`近${days}天有丢失记录`" /></ElSelect></label>
          <label>事件周期<ElSelect :model-value="days" aria-label="库存事件筛选周期" @change="apply({ ...draftFilters(), days: $event })"><ElOption :value="7" label="近7天" /><ElOption :value="30" label="近30天" /></ElSelect></label>
          <ElCheckbox :model-value="text('urgent_only') === 'true'" @change="apply({ ...draftFilters(), urgent_only: $event === true || undefined })">仅看加急</ElCheckbox>
        </div>
      </ElPopover>
      <InventoryColumnSettings :storage-key="storageKey" :columns="columns" @change="columnChoices = $event" />
      <slot name="actions" />
    </header>
    <ElAlert v-if="inputError" :title="inputError" type="warning" :closable="false" />
    <div v-if="analysisLabel" class="warehouse-search-context"><ElTag closable @close="selectAnalysis('')">{{ analysisLabel }}</ElTag><span v-if="!text('stock_age')"> 符合条件流水号的分类库存</span></div>
    <div v-if="searchedColumn" class="warehouse-search-context"><ElTag closable @close="apply({ ...filters, query: undefined, search_field: undefined, search_operator: undefined, page: 1 })">按{{ searchedColumn.label }}查询 · 首列显示</ElTag></div>
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取库存" />
    <ElTable v-else class="business-table serial-table warehouse-table" :data="rows" row-key="group_id" :span-method="span" :row-class-name="rowClass" empty-text="暂无符合条件的库存">
      <ElTableColumn v-for="column in visibleColumns" :key="column.key" :prop="column.key" :label="columnLabel(column.key, column.label)" :min-width="column.width" align="center" :label-class-name="column.key === searchedColumn?.key ? 'searched-column' : ''" :class-name="['serial_no', 'material_name'].includes(column.key) ? 'warehouse-group-cell' : ''">
        <template #default="{ row }">
          <template v-if="column.key === 'serial_no'"><ElButton class="serial-number-link" :title="row.serial_no" link type="primary" @click="openSerial(row)"><strong>{{ row.serial_no }}</strong></ElButton><SerialUrgencyBadge :urgency="row.urgency" /><ElButton v-if="canManageUrgency" class="warehouse-urgency-action" link type="primary" @click="flag(row)">{{ row.urgency?.urgent ? '取消加急' : '标记加急' }}</ElButton></template>
          <div v-else-if="column.key === 'material_name'" class="inventory-cell-stack"><span>{{ row.material_name || '—' }}</span><small v-if="!separateSpecification">{{ row.transfer_specification || '规格未填写' }}</small></div>
          <div v-else-if="column.key === 'material_type'" class="inventory-cell-stack"><ElTag effect="light" :type="isScrapMaterialType(row.material_type) ? 'warning' : row.material_type === 'finished' ? 'success' : 'primary'">{{ column.format(asRow(row)) }}</ElTag><small v-if="!separatePurpose">{{ row.purpose_name || '未指定业务' }}</small></div>
          <div v-else-if="column.key === 'source' && warehouse" class="inventory-cell-stack"><span>{{ row.receipt_source === 'opening' ? '期初库存' : row.source_name || '来源未登记' }}</span><small v-if="row.receipt_source !== 'opening'">{{ warehouseSourceNames[asRow(row).receipt_source] }}</small></div>
          <div v-else-if="column.key === 'stock_balance'" class="inventory-cell-stack inventory-balance"><strong>{{ inventoryAmount(row.on_hand_quantity) }} <small>件</small></strong><span>{{ inventoryAmount(row.on_hand_weight) }} <small>kg</small></span><small>{{ inventoryBalanceState(asRow(row)) }}<template v-if="row.current_batch_count"> · {{ row.current_batch_count }} 批</template></small></div>
          <InventoryMovementSummary v-else-if="column.key === 'movement'" :balance="asRow(row)" />
          <div v-else-if="column.key === 'oldest_received_at'" class="inventory-cell-stack inventory-receipt"><span>{{ column.format(asRow(row)) }}</span><small v-if="row.oldest_received_at">{{ inventoryAge(row.oldest_received_at) }}</small></div>
          <span v-else>{{ column.format(asRow(row)) }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" :width="88" align="center" fixed="right"><template #default="{ row }"><div class="inventory-row-actions"><ElButton link type="primary" @click="detail = asRow(row)">明细</ElButton><ElButton v-if="canWrite" link type="primary" :disabled="!(row.on_hand_quantity > 0 || row.on_hand_weight > 0)" @click="picker = asRow(row)">出库</ElButton></div></template></ElTableColumn>
    </ElTable>
    <footer v-if="!error"><span>共 {{ total }} 条分类结存<span class="inventory-balance-note">转出即扣减，待接收不计入结存</span></span><ElPagination background :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="paginate($event)" @size-change="paginate(1, $event)" /></footer>
    <TeamInventoryDetail :team-id="teamId" :group="detail" :warehouse="warehouse" :can-write="canWrite" @close="detail = null" @changed="emit('changed')" @action="action" />
    <StockSourcePicker v-if="picker && canWrite" :team-id="teamId" :group-id="picker.group_id" :group-label="[picker.serial_no, materialTypeLabel(picker.material_type || null), picker.purpose_name, sourceLabel(picker)].filter(Boolean).join(' · ')" @close="picker = null" @selected="action('dispatch', $event)" />
    <SerialMaterialDrawer v-model="serialOpen" :team-id="teamId" :serial-no="serialNo" :can-write="canWrite" @changed="emit('changed')" @action="action" />
    <SerialUrgencyDialog v-model="urgencyOpen" :serial-no="urgencySerial" @changed="load(); emit('changed')" />
  </section>
</template>

<style scoped>
.warehouse-inventory { min-width: 0; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--card-radius); background: var(--surface); container-type: inline-size; }
.warehouse-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 0; }
.warehouse-search { display: flex; gap: 8px; flex: 1 1 270px; min-width: 270px; max-width: 460px; }
.warehouse-search > .el-select { width: 118px; flex-shrink: 0; }
.warehouse-search > .el-input { min-width: 140px; }
.warehouse-search > .numeric-operator { width: 98px; }
.warehouse-search > :last-child { flex: 1; }
.warehouse-toolbar > .el-select { width: 110px; flex-shrink: 0; }
.warehouse-toolbar :deep(.record-date-trigger) { max-width: 166px; flex-shrink: 0; }
.warehouse-toolbar :deep(.record-date-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warehouse-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.warehouse-extra-filters { display: flex; flex-direction: column; gap: 14px; }
.warehouse-extra-filters label { display: flex; flex-direction: column; gap: 8px; color: var(--muted); }
.warehouse-search-context { padding-bottom: 12px; }
.warehouse-table { --business-table-font: 14px; --business-table-padding: 11px; font-variant-numeric: tabular-nums; }
.warehouse-table.el-table.business-table :deep(th.el-table__cell) { height: 44px; }
.warehouse-table :deep(.cell) { white-space: normal; overflow-wrap: anywhere; }
.inventory-cell-stack { display: flex; flex-direction: column; align-items: center; gap: 4px; line-height: 1.5; }
.inventory-cell-stack small { font-size: 14px; font-weight: 400; color: var(--muted); }
.inventory-balance strong { font-size: 18px; font-weight: 550; color: var(--text); }
.inventory-balance > span { font-size: 14px; }
.inventory-receipt { font-size: 14px; }
.inventory-row-actions { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.inventory-row-actions :deep(.el-button + .el-button) { margin-left: 0; }
.inventory-balance-note { margin-left: 18px; font-size: 13px; }
.warehouse-table :deep(.searched-column) { color: var(--primary); }
.warehouse-table :deep(td.warehouse-group-cell) { border-right: 1px solid var(--line); }
.warehouse-table :deep(tr.serial-group-start > td) { border-top: 1px solid var(--table-header-line); }
.warehouse-table.el-table.business-table :deep(.el-tag) { font-size: 12px; border: 0; padding: 5px 12px; height: auto; line-height: 22px; }
.warehouse-table :deep(.serial-number-link) { max-width: 100%; }
.warehouse-table :deep(.serial-number-link > span) { display: block; white-space: normal; overflow-wrap: anywhere; }
.warehouse-table :deep(.serial-number-link strong) { font-weight: 550; }
.warehouse-table :deep(.el-button.warehouse-urgency-action) { display: block; margin: 5px auto 0; font-size: 13px; }
.warehouse-inventory > footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 56px; padding: 14px 12px; border-top: 1px solid var(--line); }
.warehouse-inventory > footer > span { color: var(--muted); font-size: 14px; }
@container (max-width: 1230px) { .warehouse-toolbar { flex-wrap: wrap; }.warehouse-search { max-width: none; }.warehouse-toolbar :deep(.inventory-columns-trigger) { margin-left: auto; } }
@media (max-width: 760px) {
  .warehouse-search { min-width: 0; flex-basis: 100%; }
  .warehouse-toolbar > .el-select { flex: 1; min-width: 120px; }
  .warehouse-inventory > footer { flex-wrap: wrap; overflow-x: auto; }
  .warehouse-table :deep(.el-table-fixed-column--right) { position: relative !important; right: auto !important; }
  .warehouse-table :deep(.el-table-fixed-column--right::before) { box-shadow: none; }
  .warehouse-table :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
}
</style>

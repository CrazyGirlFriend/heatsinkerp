<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElInput, ElOption, ElOptionGroup, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import SerialUrgencyDialog from './SerialUrgencyDialog.vue'
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
const urgencyOpen = ref(false), urgencySerial = ref('')
const canManageUrgency = computed(() => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError)
const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const days = computed<7 | 30>(() => text('days') === '7' ? 7 : 30)
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10)
const filterLabel = computed(() => text('filter_label'))
const queryDraft = ref(''), analysisFilter = ref('')
const materialDraft = ref(''), availabilityDraft = ref<'all' | 'available'>('available'), moreFilters = ref(false)
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
  for (const key of ['query', 'serial_no', 'material_name', 'material_type', 'stock_age', 'waiting_age', 'waiting_direction', 'activity_day', 'activity_kind', 'flow_direction', 'peer']) if (text(key)) params[key] = text(key)
  if (text('has_loss') === 'true') params.has_loss = true
  if (text('date_from')) params.date_from = text('date_from')
  if (text('date_to')) params.date_to = text('date_to')
  if (text('urgent_only') === 'true') params.urgent_only = true
  params.availability = text('availability') === 'all' ? 'all' : 'available'
  return params as SerialParams
})
function viewQuery() { return { tab: 'stock', ...(days.value === 7 ? { days: '7' } : {}), ...(pageSize.value !== 10 ? { page_size: String(pageSize.value) } : {}), ...(text('metric') === 'quantity' ? { metric: 'quantity' } : {}) } }
function changeView(values: Record<string, string>) { void router.replace({ path: route.path, query: { ...route.query, ...values } }) }
function applyFilter(params: SerialParams = {}, label = '') { void router.replace({ path: route.path, query: { ...viewQuery(), ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])), ...(label ? { filter_label: label } : {}) } }) }
function basicFilters(): SerialParams { return { date_from: text('date_from') || undefined, date_to: text('date_to') || undefined, urgent_only: text('urgent_only') === 'true' || undefined, query: queryDraft.value.trim() || undefined, material_name: materialDraft.value || undefined, availability: availabilityDraft.value } }
function search() { applyFilter({ ...filters.value, ...basicFilters(), page: 1 }, filterLabel.value) }
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
watch([() => props.teamId, filters], () => { queryDraft.value = text('query'); materialDraft.value = text('material_name'); availabilityDraft.value = text('availability') === 'all' ? 'all' : 'available'; analysisFilter.value = ''; void loadRows() }, { immediate: true })
watch(() => props.overview, () => { void loadRows(true) })
watch(() => props.teamId, () => { detailOpen.value = false; rows.value = [] })
onBeforeUnmount(() => { ++listVersion })
function action(mode: 'dispatch' | 'loss', sources: StockBatch[]) {
  if (!props.canWrite) return
  detailOpen.value = false
  emit('action', mode, sources)
}
function amount(value: number | null | undefined) { return value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value) }
</script>
<template>
  <div class="serial-overview">
    <ElAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <section class="serial-ledger">
      <header class="serial-toolbar">
        <ElInput v-model="queryDraft" :prefix-icon="Search" aria-label="库存明细搜索" placeholder="流水号、材质或规格" clearable @keyup.enter="search" @clear="search" />
        <RecordDateFilter :model-value="dateRange" label="流转日期" @update:model-value="selectDate" />
        <ElCheckbox :model-value="text('urgent_only') === 'true'" @change="applyFilter({ ...filters, ...basicFilters(), urgent_only: $event === true || undefined, page: 1 }, filterLabel)">仅看加急</ElCheckbox>
        <ElButton @click="search">查询</ElButton><ElButton text @click="applyFilter()">重置</ElButton>
        <ElButton class="more-filters-button" text :icon="ArrowDown" :type="materialDraft || availabilityDraft === 'available' ? 'primary' : 'default'" :aria-expanded="moreFilters" aria-controls="serial-extra-filters" @click="moreFilters = !moreFilters">更多筛选</ElButton>
      </header>
      <div v-if="moreFilters" id="serial-extra-filters" class="serial-extra-filters">
        <label class="filter-field"><span>材质</span><ElSelect v-model="materialDraft" aria-label="台账材质筛选" filterable clearable placeholder="全部" @change="search"><ElOption v-for="name in materialNames" :key="name" :value="name" :label="name" /></ElSelect></label>
        <label class="filter-field"><span>库存</span><ElSelect v-model="availabilityDraft" aria-label="台账库存筛选" @change="search"><ElOption value="all" label="全部" /><ElOption value="available" label="有可用库存" /></ElSelect></label>
        <label class="filter-field"><span>条件</span><ElSelect v-model="analysisFilter" aria-label="分析条件筛选" placeholder="库存与流转条件" clearable @change="selectAnalysis"><ElOptionGroup label="库存停留"><ElOption v-for="[key, label] in ages" :key="key" :value="`age:${key}`" :label="`库存停留 ${label}`" /></ElOptionGroup><ElOptionGroup v-for="direction in ['incoming','outgoing']" :key="direction" :label="direction === 'incoming' ? '待接收' : '转出待确认'"><ElOption v-for="[key, label] in ages" :key="key" :value="`${direction}:${key}`" :label="`${direction === 'incoming' ? '待接收' : '转出待确认'} ${label}`" /></ElOptionGroup><ElOptionGroup label="物料类型"><ElOption v-for="item in materialTypeOptions" :key="item.value" :value="`type:${item.value}`" :label="item.label" /></ElOptionGroup><ElOption value="loss" :label="`近${days}天有丢失记录`" /></ElSelect></label>
        <label class="filter-field"><span>事件周期</span><ElSelect :model-value="days" aria-label="台账事件筛选周期" @update:model-value="changeView({ days: String($event), page: '1' })"><ElOption :value="7" label="近7天" /><ElOption :value="30" label="近30天" /></ElSelect></label>
      </div>
      <div v-if="filterLabel" class="serial-filter-context"><ElTag size="small" closable @close="applyFilter(basicFilters())">{{ filterLabel }}</ElTag><span>显示符合条件流水号的完整余额</span></div>
      <StatePanel v-if="listError" state="error" :description="listError" @retry="loadRows" /><StatePanel v-else-if="listLoading" state="loading" title="正在读取库存明细" />
      <ElTable v-else :data="rows" row-key="serial_no" class="business-table serial-table" empty-text="暂无符合条件的流水号">
        <ElTableColumn label="流水号" min-width="250" fixed show-overflow-tooltip><template #default="{ row }"><ElButton class="serial-number-link" link type="primary" @click="open(row)">{{ row.serial_no }}</ElButton><SerialUrgencyBadge :urgency="row.urgency" /></template></ElTableColumn>
        <ElTableColumn label="材质" min-width="128" show-overflow-tooltip><template #default="{ row }">{{ row.material_name_count > 1 ? '多材质' : row.material_name || '—' }}</template></ElTableColumn>
        <ElTableColumn label="规格" min-width="144" show-overflow-tooltip><template #default="{ row }">{{ row.transfer_specification_count > 1 ? '多规格' : row.transfer_specification || '—' }}</template></ElTableColumn>
        <ElTableColumn label="可用件数" min-width="84" align="right" class-name="ledger-number"><template #default="{ row }">{{ amount(row.available_quantity) }}</template></ElTableColumn>
        <ElTableColumn label="可用重量 (kg)" min-width="120" align="right" class-name="ledger-number"><template #default="{ row }">{{ amount(row.available_weight) }}</template></ElTableColumn>
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
.serial-toolbar > .el-input { flex: 1 1 180px; min-width: 160px; max-width: 320px; }
.serial-toolbar :deep(.record-date-trigger) { flex-shrink: 0; max-width: 280px; }
.serial-toolbar :deep(.record-date-trigger > span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-field { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; white-space: nowrap; }
.filter-field > .el-select { width: 135px; }
.serial-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.serial-toolbar .more-filters-button { font-size: 15px; }
.serial-extra-filters { padding-top: 0; }
.serial-filter-context { display: flex; flex-shrink: 0; gap: 12px; align-items: center; padding: 0 12px 10px; color: var(--subtle); font-size: 12px; }
.serial-table { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.serial-table :deep(.cell) { white-space: nowrap; }
.serial-table :deep(.el-button) { max-width: 100%; height: 20px; min-height: 0; border: 0; vertical-align: middle; font-size: 14px; line-height: 20px; padding: 0; }
.serial-table :deep(.el-button > span) { display: block; overflow: hidden; text-overflow: ellipsis; }
.serial-ledger footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; min-height: 60px; padding: 12px 16px; border-top: 1px solid var(--line); }
.serial-ledger footer > span { color: var(--muted); font-size: 13px; white-space: nowrap; }
@container (max-width: 1040px) { .serial-toolbar { flex-wrap: wrap; }.serial-toolbar > .el-input { max-width: none; } }
@media(max-width:760px) { .serial-toolbar > .el-input { flex-basis: 100%; }.filter-field { flex: 1; }.filter-field > .el-select { width: auto; min-width: 90px; flex: 1; }.serial-extra-filters { flex-wrap: wrap; }.serial-ledger footer { flex-wrap: wrap; }.serial-ledger footer > .el-pagination { max-width: 100%; overflow-x: auto; }.serial-table :deep(.el-table-fixed-column--left), .serial-table :deep(.el-table-fixed-column--right) { position: static !important; }.serial-table :deep(.el-table-fixed-column--left::before), .serial-table :deep(.el-table-fixed-column--right::before) { display: none; } }
</style>

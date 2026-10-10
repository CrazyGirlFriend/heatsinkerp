<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElButton, ElInput, ElLoading, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { ProcessingRecord } from '@/types/materialProcessing'
import { materialTypeLabel } from '@/types/materialTransfer'
import { inventoryAmount } from '@/types/teamInventory'
import TableExportButton from './TableExportButton.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { processingStateLabels, processingProgressLabels } from '@/types/materialProcessing'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ teamId: number; canWrite?: boolean; fullscreen?: boolean; refreshKey?: unknown }>()
const vLoading = ElLoading.directive
const emit = defineEmits<{ register: []; changed: [] }>()
const route = useRoute(), router = useRouter()
const text = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() => [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10)
const query = ref(''), dates = ref({ from: '', to: '' }), filtersOpen = ref(false)
const filterCount = computed(() => Number(Boolean(text('date_from') || text('date_to'))))
const rows = ref<ProcessingRecord[]>([]), total = ref(0), loading = ref(false), error = ref('')
const detailOpen = ref(false), sourceId = ref<number | null>(null)
let generation = 0
const live = useLiveRefresh(() => load(true), { teamId: () => props.teamId, busy: () => loading.value || detailOpen.value })
function syncFilters() { dates.value = { from: text('date_from'), to: text('date_to') } }
function apply(nextPage = 1, size = pageSize.value) {
  filtersOpen.value = false
  void router.replace({ path: route.path, query: { tab: 'processing', ...(query.value.trim() ? { query: query.value.trim() } : {}),
    ...(dates.value.from ? { date_from: dates.value.from } : {}), ...(dates.value.to ? { date_to: dates.value.to } : {}),
    ...(nextPage > 1 ? { page: String(nextPage) } : {}), ...(size !== 10 ? { page_size: String(size) } : {}) } })
}
async function load(background = false) {
  const current = ++generation
  if (!background) { loading.value = true; rows.value = [] }
  error.value = ''
  try {
    const result = await teamMaterialApi.processingRecords(props.teamId, { query: text('query') || undefined,
      date_from: text('date_from') || undefined, date_to: text('date_to') || undefined, page: page.value, page_size: pageSize.value })
    if (current !== generation) return
    const last = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > last) { apply(last); return }
    rows.value = result.items; total.value = result.total
  } catch (e) { if (current === generation) { if (background) throw e; error.value = e instanceof Error ? e.message : '加工记录读取失败' } }
  finally { if (current === generation) loading.value = false }
}
function exportSource() {
  const id = props.teamId, params = { query: text('query') || undefined, date_from: text('date_from') || undefined, date_to: text('date_to') || undefined }
  return tableExportSource('加工记录', total.value, [
    { key: 'serial_no', label: '流水号', value: (row: ProcessingRecord) => row.serial_no },
    { key: 'created_at', label: '登记时间', value: row => formatDateTime(row.created_at) },
    { key: 'before_quantity', label: '加工前件数', value: row => row.before_quantity },
    { key: 'after_quantity', label: '加工后件数', value: row => row.after_quantity },
    { key: 'processing_status', label: '登记时进度', value: row => row.processing_status ? processingProgressLabels[row.processing_status] : '未标明' },
    { key: 'after_specification', label: '登记后实际尺寸', value: row => row.after_specification || '' },
    { key: 'on_hand_quantity', label: '当前未转出件数', value: row => row.on_hand_quantity },
    { key: 'on_hand_weight', label: '当前未转出重量 (kg)', value: row => row.on_hand_weight },
    { key: 'processing_state', label: '当前状态', value: row => processingStateLabels[row.processing_state] },
    { key: 'created_by', label: '登记人', value: row => row.created_by },
    { key: 'reason', label: '加工说明', value: row => row.reason },
    { key: 'batch_no', label: '来源批次号', value: row => row.batch_no },
  ], (signal, progress) => loadExportPages((page, pageSize) => teamMaterialApi.processingRecords(id, { ...params, page, page_size: pageSize }), signal, progress))
}
function detail(row: unknown) { sourceId.value = (row as ProcessingRecord).source_transfer_id; detailOpen.value = true }
watch(() => [props.teamId, route.fullPath], () => { detailOpen.value = false; query.value = text('query'); syncFilters(); void load() }, { immediate: true })
watch(() => props.refreshKey, () => { if (!loading.value) void live.request() })
onBeforeUnmount(() => { ++generation })
</script>

<template>
  <section class="processing-records" :class="{ 'processing-records--fullscreen': fullscreen }" aria-label="加工记录">
    <header v-show="!fullscreen" class="processing-records-heading"><div><h2>加工记录</h2><span>{{ total }} 条记录</span></div><ElButton v-if="canWrite" class="action-cool" @click="emit('register')">加工登记</ElButton></header>
    <div class="processing-records-toolbar">
      <ElInput v-model="query" :prefix-icon="Search" clearable aria-label="加工记录搜索" placeholder="流水号、批次号或加工说明" @keyup.enter="apply()" @clear="apply()" />
      <FilterDialog v-model="filtersOpen" title="加工记录筛选" :count="filterCount" @open="syncFilters" @cancel="syncFilters" @apply="apply()" @reset="dates = { from: '', to: '' }"><label>登记日期<RecordDateFilter v-model="dates" label="登记日期" /></label></FilterDialog>
      <ElButton @click="apply()">查询</ElButton><TableExportButton :source="exportSource" :disabled="loading || !!error" :context="route.fullPath" /><ElButton :icon="Refresh" :loading="loading" text aria-label="刷新加工记录" @click="load()" />
    </div>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ElTable v-else v-loading="loading" :data="rows" row-key="id" class="business-table processing-records-table" height="100%" flexible empty-text="暂无加工登记记录" aria-label="班组加工记录">
      <ElTableColumn prop="serial_no" label="流水号" min-width="150" fixed show-overflow-tooltip />
      <ElTableColumn label="登记时间" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn>
      <ElTableColumn label="物料类型" min-width="115"><template #default="{ row }">{{ materialTypeLabel(row.material_type) }}</template></ElTableColumn>
      <ElTableColumn label="加工前件数" min-width="110" align="right"><template #default="{ row }">{{ inventoryAmount(row.before_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="加工后件数" min-width="110" align="right"><template #default="{ row }">{{ inventoryAmount(row.after_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="当前未转出件数" min-width="145" align="right"><template #default="{ row }">{{ inventoryAmount(row.on_hand_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="当前未转出重量 (kg)" min-width="185" align="right"><template #default="{ row }">{{ inventoryAmount(row.on_hand_weight) }}</template></ElTableColumn>
      <ElTableColumn label="当前状态" min-width="185" align="center"><template #default="{ row }"><ProcessingStockStatus :state="row.processing_state" :material-type="row.material_type" /></template></ElTableColumn>
      <ElTableColumn label="登记时进度" min-width="145"><template #default="{ row }">{{ row.processing_status ? processingProgressLabels[row.processing_status as 'partial' | 'complete'] : '未标明' }}</template></ElTableColumn>
      <ElTableColumn prop="after_specification" label="登记后实际尺寸" min-width="180" show-overflow-tooltip />
      <ElTableColumn prop="created_by" label="登记人" min-width="110" show-overflow-tooltip />
      <ElTableColumn prop="reason" label="加工说明" min-width="170" show-overflow-tooltip />
      <ElTableColumn prop="batch_no" label="来源批次号" min-width="205" show-overflow-tooltip />
      <ElTableColumn label="操作" width="85" fixed="right" align="center"><template #default="{ row }"><ElButton link type="primary" @click="detail(row)">记录</ElButton></template></ElTableColumn>
    </ElTable>
    <footer><span>共 {{ total }} 条记录</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="apply($event)" @size-change="apply(1, $event)" /></footer>
    <QuantityAdjustmentDialog v-model="detailOpen" :team-id="teamId" :source-id="sourceId" processing :can-write="false" />
  </section>
</template>

<style scoped>
.processing-records { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--card-radius); background: var(--surface); padding: 0 16px; }
.processing-records-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; padding: 16px 0; border-bottom: 1px solid var(--line); }
.processing-records-heading > div { display: flex; align-items: baseline; gap: 12px; }
.processing-records-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.processing-records-heading span, footer > span { color: var(--muted); font-size: 13px; }
.processing-records-toolbar { display: flex; flex: 0 0 auto; gap: 8px; align-items: center; padding: 14px 0; }
.processing-records-toolbar .el-input { flex: 1; min-width: 0; }
.processing-records-toolbar .el-button { margin-left: 0; }
.processing-records-table { flex: 1; min-height: 0; }
footer { display: flex; flex: 0 0 auto; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; }
.processing-records--fullscreen { border-radius: 0; border: 0; }
@media (max-width: 600px) {
  .processing-records { padding-inline: 10px; }
  .processing-records-toolbar { flex-wrap: wrap; }
  .processing-records-toolbar .el-input { flex-basis: 100%; }
  footer { flex-wrap: wrap; }
  footer .el-pagination { max-width: 100%; overflow-x: auto; }
}
</style>

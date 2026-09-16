<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElCheckbox, ElDescriptions, ElDescriptionsItem, ElDrawer, ElPagination, ElTable, ElTableColumn, ElTabs, ElTabPane } from 'element-plus'
import MaterialAmount from './MaterialAmount.vue'
import MaterialTransferStatus from './MaterialTransferStatus.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from './MaterialDispatchDrawer.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import { materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import type { MaterialLoss, StockBatch } from '@/types/teamMaterials'
import type { SerialMetaField, SerialSummary } from '@/types/materialAnalytics'
import { formatDateTime } from '@/utils/format'
import { stockAvailable } from '@/utils/materialStock'
const props = defineProps<{ modelValue: boolean; teamId: number; serialNo: string; canWrite?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]] }>()
const tab = ref('stock'), page = ref(1), pageSize = ref(10)
const summary = ref<SerialSummary | null>(null), stock = ref<StockBatch[]>([]), records = ref<MaterialTransfer[]>([]), losses = ref<MaterialLoss[]>([])
const loading = ref(false), error = ref(''), total = ref(0)
const checked = ref<string[]>([])
const availableRows = computed(() => stock.value.filter(stockAvailable))
const selectedRows = computed(() => availableRows.value.filter(row => checked.value.includes(String(row.transfer.id))))
const allChecked = computed(() => availableRows.value.length > 0 && selectedRows.value.length === availableRows.value.length)
function asStock(row: unknown) { return row as StockBatch }
function toggle(row: StockBatch, value: string | number | boolean) {
  const id = String(row.transfer.id)
  checked.value = value && stockAvailable(row) ? [...new Set([...checked.value, id])] : checked.value.filter(key => key !== id)
}
function toggleAll(value: string | number | boolean) { checked.value = value ? availableRows.value.map(row => String(row.transfer.id)) : [] }
function action(mode: 'dispatch' | 'loss', sources: StockBatch[]) {
  if (!props.canWrite || loading.value || error.value || !sources.length || sources.some(row => !stockAvailable(row))) return
  emit('action', mode, sources)
}
const selected = ref<MaterialTransfer | null>(null), batchNo = ref(''), batchOpen = ref(false), groupNo = ref(''), groupOpen = ref(false)
const meta = computed(() => ([['material_name', '材质'], ['transfer_specification', '转料规格'], ['finished_specification', '成品规格'], ['finished_quantity', '成品件数'], ['source_batch_no', '原单批号'], ['customer_code', '客户代码'], ['product_code', '编号']] as [SerialMetaField, string][]))
function field(key: SerialMetaField) { return !summary.value ? '—' : summary.value[`${key}_count`] > 1 ? '多值，见批次明细' : summary.value[key] ?? '—' }
let version = 0
const liveRefresh = useLiveRefresh(() => load(true), {
  enabled: () => props.modelValue && Boolean(props.serialNo), busy: () => loading.value,
})
async function load(background = false) {
  const current = ++version
  if (!props.modelValue || !props.serialNo) return
  if (!background) { loading.value = true; stock.value = []; records.value = []; losses.value = [] }
  error.value = ''
  const params = { serial_no: props.serialNo, page: page.value, page_size: pageSize.value }
  try {
    const [info, result] = await Promise.all([
      teamMaterialApi.serials(props.teamId, { serial_no: props.serialNo, page_size: 1 }),
      tab.value === 'stock' ? teamMaterialApi.stock(props.teamId, { ...params, availability: 'all' }) : tab.value === 'losses' ? teamMaterialApi.losses(props.teamId, params) : materialTransferApi.list({ ...params, team_id: props.teamId, direction: tab.value as 'incoming' | 'outgoing' }),
    ])
    if (current !== version) return
    summary.value = info.items[0] || null; total.value = result.total
    if (tab.value === 'stock') stock.value = result.items as StockBatch[]
    else if (tab.value === 'losses') losses.value = result.items as MaterialLoss[]
    else records.value = result.items as MaterialTransfer[]
  } catch (e) { if (current === version) { if (background) throw e; error.value = e instanceof Error ? e.message : '流水号详情加载失败' } }
  finally { if (current === version) loading.value = false }
}
function open(value: unknown) { const record = value as MaterialTransfer; if (record.dispatch_no) { groupNo.value = record.dispatch_no; groupOpen.value = true } else { selected.value = record; batchNo.value = record.batch_no; batchOpen.value = true } }
function openLoss(value: unknown) { const record = value as MaterialLoss; selected.value = null; batchNo.value = record.batch_no; batchOpen.value = true }
function changed() { void load(); emit('changed') }
watch(() => [props.modelValue, props.teamId, props.serialNo], () => { ++version; summary.value = null; tab.value = 'stock'; page.value = 1; batchOpen.value = false; groupOpen.value = false; void load() }, { immediate: true })
watch([tab, page, pageSize, () => props.modelValue, () => props.teamId, () => props.serialNo, () => props.canWrite], () => { checked.value = [] })
watch(tab, () => { page.value = 1; void load() })
onBeforeUnmount(() => { ++version })
</script>
<template>
  <ElDrawer :model-value="modelValue" title="流水号详情" size="min(1050px, 96vw)" append-to-body class="serial-drawer" @update:model-value="emit('update:modelValue', $event)">
    <template #header><div class="serial-title"><span>流水号详情</span><strong>{{ serialNo }}<SerialUrgencyBadge :urgency="summary?.urgency" /></strong></div></template>
    <div class="serial-detail-body">
      <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
      <template v-if="summary">
        <ElDescriptions :column="3" border>
          <ElDescriptionsItem v-for="[key, label] in meta" :key="key" :label="label">{{ field(key) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="待接收"><MaterialAmount :quantity="summary.pending_incoming_quantity" :weight="summary.pending_incoming_weight" /></ElDescriptionsItem>
          <ElDescriptionsItem label="转出待确认"><MaterialAmount :quantity="summary.pending_outgoing_quantity" :weight="summary.pending_outgoing_weight" /></ElDescriptionsItem>
          <ElDescriptionsItem label="最近更新">{{ formatDateTime(summary.last_activity_at) }}</ElDescriptionsItem>
        </ElDescriptions>
        <div class="serial-balances"><div>当前库存<MaterialAmount :quantity="summary.on_hand_quantity" :weight="summary.on_hand_weight" /></div><div>可用库存<MaterialAmount :quantity="summary.available_quantity" :weight="summary.available_weight" /></div><div>累计丢失<MaterialAmount :quantity="summary.lost_quantity" :weight="summary.lost_weight" /></div></div>
      </template>
      <ElTabs v-model="tab" class="serial-detail-tabs"><ElTabPane name="stock" label="来源余量" /><ElTabPane name="incoming" label="转入明细" /><ElTabPane name="outgoing" label="转出明细" /><ElTabPane name="losses" label="丢失记录" /></ElTabs>
      <div v-if="tab === 'stock' && canWrite" class="serial-stock-actions"><span>已选 {{ selectedRows.length }} 个来源批次</span><ElButton type="primary" :disabled="!selectedRows.length || loading || !!error" @click="action('dispatch', selectedRows)">批量出库</ElButton></div>
      <StatePanel v-if="error" state="error" :description="error" @retry="load" />
      <StatePanel v-else-if="loading" state="loading" title="正在读取明细" />
      <div v-else class="serial-record-table">
        <ElTable class="business-table" v-if="tab === 'stock'" :data="stock" height="100%" stripe size="small" empty-text="暂无已接收来源批次">
          <ElTableColumn v-if="canWrite" width="44" class-name="stock-selection-column">
            <template #header><ElCheckbox aria-label="选择本页可用批次" :model-value="allChecked" :indeterminate="selectedRows.length > 0 && !allChecked" :disabled="!availableRows.length" @change="toggleAll" /></template>
            <template #default="{ row }"><ElCheckbox :aria-label="'选择 ' + row.transfer.batch_no" :model-value="selectedRows.some(item => item.transfer.id === row.transfer.id)" :disabled="!stockAvailable(asStock(row))" @change="toggle(asStock(row), $event)" /></template>
          </ElTableColumn>
          <ElTableColumn label="来源批次" min-width="170"><template #default="{ row }"><ElButton link type="primary" @click="open(row.transfer)">{{ row.transfer.dispatch_no || row.transfer.batch_no }}</ElButton></template></ElTableColumn>
          <ElTableColumn label="材质 / 类型" min-width="140"><template #default="{ row }">{{ row.transfer.material_name || '—' }}<small>{{ materialTypeLabel(row.transfer.material_type) }}</small></template></ElTableColumn>
          <ElTableColumn label="结存" min-width="125"><template #default="{ row }"><MaterialAmount :quantity="row.on_hand_quantity" :weight="row.on_hand_weight" /></template></ElTableColumn>
          <ElTableColumn label="可用" min-width="125"><template #default="{ row }"><MaterialAmount :quantity="row.available_quantity" :weight="row.available_weight" /></template></ElTableColumn>
          <ElTableColumn label="转出待确认" min-width="125"><template #default="{ row }"><MaterialAmount :quantity="row.reserved_quantity" :weight="row.reserved_weight" /></template></ElTableColumn>
          <ElTableColumn label="接收时间" min-width="145"><template #default="{ row }">{{ formatDateTime(row.transfer.received_at) }}</template></ElTableColumn>
          <ElTableColumn v-if="canWrite" label="操作" width="160" fixed="right"><template #default="{ row }"><ElButton link type="primary" :disabled="!stockAvailable(asStock(row))" @click="action('dispatch', [asStock(row)])">出库</ElButton><ElButton link :disabled="!stockAvailable(asStock(row))" @click="action('loss', [asStock(row)])">登记丢失</ElButton></template></ElTableColumn>
        </ElTable>
        <ElTable class="business-table" v-else-if="tab === 'losses'" :data="losses" height="100%" stripe size="small" empty-text="暂无丢失记录">
          <ElTableColumn prop="loss_no" label="记录编号" min-width="200" /><ElTableColumn label="丢失数量" min-width="130"><template #default="{ row }"><MaterialAmount :quantity="row.quantity" :weight="row.weight" /></template></ElTableColumn>
          <ElTableColumn prop="reason" class-name="table-prose" label="原因" min-width="180" show-overflow-tooltip /><ElTableColumn prop="created_by" label="登记人" min-width="110" /><ElTableColumn label="时间" min-width="140"><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn><ElTableColumn label="操作" width="90"><template #default="{ row }"><ElButton link type="primary" @click="openLoss(row)">查看来源</ElButton></template></ElTableColumn>
        </ElTable>
        <ElTable class="business-table" v-else :data="records" height="100%" stripe size="small" empty-text="暂无交接明细">
          <ElTableColumn label="交接批次" min-width="200"><template #default="{ row }"><ElButton link type="primary" @click="open(row)">{{ row.dispatch_no || row.batch_no }}</ElButton><small>{{ row.dispatch_no ? '整批内的一条物料明细' : '独立交接单' }}</small></template></ElTableColumn>
          <ElTableColumn label="材质 / 规格" min-width="135"><template #default="{ row }">{{ row.material_name || '—' }}<small>{{ row.transfer_specification || '—' }}</small></template></ElTableColumn>
          <ElTableColumn label="上下序" min-width="160"><template #default="{ row }">{{ row.source_team.name }} → {{ row.next_team.name }}</template></ElTableColumn>
          <ElTableColumn label="件数 / 重量" min-width="135"><template #default="{ row }"><MaterialAmount :quantity="row.quantity" :weight="row.weight" /></template></ElTableColumn>
          <ElTableColumn label="状态" width="120"><template #default="{ row }"><MaterialTransferStatus :status="row.status" :entry-kind="row.entry_kind" /></template></ElTableColumn>
          <ElTableColumn label="登记人 / 时间" min-width="145"><template #default="{ row }">{{ row.transferred_by }}<small>{{ formatDateTime(row.transferred_at) }}</small></template></ElTableColumn>
        </ElTable>
      </div>
    </div>
    <template #footer><div class="serial-detail-footer"><span>共 {{ total }} 条{{ tab === 'stock' ? '来源记录' : tab === 'losses' ? '丢失记录' : '交接明细' }}</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="page = $event; load()" @size-change="pageSize = $event; page = 1; load()" /></div></template>
  </ElDrawer>
  <MaterialTransferDrawer v-model="batchOpen" :transfer="selected" :batch-no="batchNo" :trace-scope="{ team_id: teamId, direction: 'all' }" @changed="changed" />
  <MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="groupNo" @changed="changed" />
</template>
<style scoped>
.serial-stock-actions { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; gap: 12px; color: var(--muted); }
.serial-title { display: flex; flex-direction: column; gap: 5px; }.serial-title span { color: var(--subtle); font-size: 12px; }.serial-title strong { color: var(--text); font-size: 19px; overflow-wrap: anywhere; }
.serial-detail-body { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 12px; }.serial-detail-body > .el-descriptions { flex-shrink: 0; }.serial-balances { display: flex; flex-wrap: wrap; gap: 16px; }.serial-balances > div { display: flex; gap: 12px; align-items: center; font-size: 12px; color: var(--subtle); padding: 9px 12px; border-radius: 6px; background: var(--primary-soft); }.serial-detail-tabs { flex-shrink: 0; }.serial-detail-tabs :deep(.el-tabs__header) { margin: 0; }.serial-record-table { flex: 1; min-height: 0; }.serial-record-table small { display: block; color: var(--subtle); font-size: 11px; }.serial-detail-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; overflow-x: auto; }.serial-detail-footer > span { font-size: 12px; white-space: nowrap; color: var(--subtle); }
.serial-title span, .serial-balances > div, .serial-record-table small, .serial-detail-footer > span { font-size: 14px; }
.serial-detail-body :deep(.el-descriptions__cell) { font-size: 14px; line-height: 22px; padding: 10px 12px; }
.serial-record-table :deep(.el-table), .serial-record-table :deep(.el-button.is-link) { font-size: 15px; }
.serial-record-table :deep(td.el-table__cell) { padding-block: 12px; }
@media(max-width:600px) { .serial-detail-body :deep(.el-descriptions__body) { overflow-x: auto; }.serial-detail-body :deep(.el-descriptions__table) { min-width: 720px; }.serial-balances { gap: 6px; }.serial-balances > div { padding: 6px; } }
</style>

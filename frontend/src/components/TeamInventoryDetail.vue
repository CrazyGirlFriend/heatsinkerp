<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElDescriptions, ElDescriptionsItem, ElDialog, ElPagination, ElTable, ElTableColumn, ElTag } from 'element-plus'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import StatePanel from './StatePanel.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { isScrapType, materialTypeLabel, materialTransferStatusLabel, materialTransferStatusTone, type MaterialTransfer } from '@/types/materialTransfer'
import { inventorySourceLabel, inventoryAmount, type TeamInventoryRow } from '@/types/teamInventory'
import type { StockBatch } from '@/types/teamMaterials'
import { dispatchableAmounts, stockAvailable } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ teamId: number; group: TeamInventoryRow | null; canWrite?: boolean; warehouse?: boolean }>()
const emit = defineEmits<{ close: []; changed: []; pending: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]] }>()
const rows = ref<StockBatch[]>([]), total = ref(0), page = ref(1), pageSize = ref(10)
const movements = ref<MaterialTransfer[]>([]), movementTotal = ref(0), movementPage = ref(1), movementPageSize = ref(10)
const loading = ref(false), error = ref('')
const batchOpen = ref(false), selected = ref<MaterialTransfer | null>(null)
const quantityOpen = ref(false), quantitySource = ref<number | null>(null)
const hasLoss = computed(() => rows.value.some(row => Number(row.lost_quantity) > 0 || Number(row.lost_weight) > 0))
const hasPending = computed(() => rows.value.some(row => Number(row.in_transit_quantity) > 0 || Number(row.in_transit_weight) > 0))
const hasExternalPending = computed(() => rows.value.some(row => Number(row.external_pending_quantity) > 0 || Number(row.external_pending_weight) > 0))
const availableLabel = computed(() => isScrapType(props.group?.material_type) ? '可处理' : '可转出')
let version = 0
const live = useLiveRefresh(() => load(true), { teamId: () => props.teamId, enabled: () => !!props.group, busy: () => loading.value || quantityOpen.value || batchOpen.value })
async function load(background = false) {
  const current = ++version
  if (!props.group) { loading.value = false; return }
  if (!background) { loading.value = true; rows.value = []; movements.value = [] }
  error.value = ''
  try {
    const [result, records] = await Promise.all([
      teamMaterialApi.inventorySources(props.teamId, props.group.group_id, { page: page.value, page_size: pageSize.value }),
      teamMaterialApi.inventoryMovements(props.teamId, props.group.group_id, { page: movementPage.value, page_size: movementPageSize.value }),
    ])
    if (current !== version) return
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value)), lastMovementPage = Math.max(1, Math.ceil(records.total / movementPageSize.value))
    if (page.value > lastPage || movementPage.value > lastMovementPage) {
      page.value = Math.min(page.value, lastPage); movementPage.value = Math.min(movementPage.value, lastMovementPage)
      await load(background); return
    }
    rows.value = result.items; total.value = result.total; movements.value = records.items; movementTotal.value = records.total
  } catch (e) { if (current === version) { if (background) throw e; error.value = e instanceof Error ? e.message : '库存明细加载失败' } }
  finally { if (current === version) loading.value = false }
}
function open(transfer: MaterialTransfer) { selected.value = transfer; batchOpen.value = true }
function action(mode: 'dispatch' | 'loss', row: StockBatch) { if (props.canWrite && !loading.value && !error.value && stockAvailable(row)) emit('action', mode, [row]) }
function asStock(row: unknown) { return row as StockBatch }
function asTransfer(row: unknown) { return row as MaterialTransfer }
function incoming(row: MaterialTransfer) { return Number(row.next_team.id) === props.teamId }
function movementLabel(row: MaterialTransfer) {
  if (incoming(row)) return row.entry_kind === 'opening_stock' ? '期初入账' : row.entry_kind === 'warehouse_receipt' ? '入库' : '收料'
  return row.entry_kind === 'inspection_shipment' ? '发货' : row.entry_kind === 'warehouse_outbound' ? '对外出库' : '转出'
}
function counterpart(row: MaterialTransfer) {
  if (!incoming(row)) return row.external_destination || row.next_team.name || '—'
  return row.entry_kind === 'opening_stock' ? '期初库存' : row.external_source || row.source_team.name || '—'
}
function openQuantity(row: StockBatch) { quantitySource.value = Number(row.transfer.id); quantityOpen.value = true }
function changed() { void load(); emit('changed') }
watch([() => props.teamId, () => props.group?.group_id], () => {
  page.value = movementPage.value = 1; rows.value = []; movements.value = []; total.value = movementTotal.value = 0
  batchOpen.value = quantityOpen.value = false; selected.value = null; void load()
}, { immediate: true })
onBeforeUnmount(() => { ++version })
</script>

<template>
  <ElDialog :model-value="!!group" title="库存明细" width="min(1480px, calc(100vw - 32px))" align-center append-to-body class="material-detail-dialog warehouse-stock-detail" @update:model-value="!$event && emit('close')">
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <ElDescriptions v-if="group" :column="3" border>
      <ElDescriptionsItem label="流水号">{{ group.serial_no }}</ElDescriptionsItem>
      <ElDescriptionsItem label="材质">{{ group.material_name || '—' }}</ElDescriptionsItem>
      <ElDescriptionsItem label="规格">{{ group.transfer_specification || '—' }}</ElDescriptionsItem>
      <ElDescriptionsItem label="物料类型">{{ materialTypeLabel(group.material_type || null) }}</ElDescriptionsItem>
      <ElDescriptionsItem label="本班组业务">{{ group.purpose_name || '未指定业务' }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="warehouse ? '来源' : '上序班组'">{{ inventorySourceLabel(group, warehouse) }}</ElDescriptionsItem>
    </ElDescriptions>
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取库存明细" />
    <template v-else>
      <section class="stock-detail-section" aria-label="来源结存">
        <header><h3>来源结存</h3><ElButton v-if="group && (Number(group.reserved_quantity) > 0 || Number(group.reserved_weight) > 0)" link type="primary" @click="emit('pending')">查看转出待确认批次</ElButton></header>
        <ElTable class="business-table warehouse-source-table" :data="rows" row-key="transfer.id" empty-text="暂无来源记录">
          <ElTableColumn label="来源批次号" min-width="205"><template #default="{ row }"><ElButton link type="primary" @click="open(row.transfer)">{{ row.transfer.batch_no }}</ElButton></template></ElTableColumn>
          <ElTableColumn label="库存件数" min-width="110" align="right"><template #default="{ row }">{{ inventoryAmount(row.owned_quantity) }}</template></ElTableColumn>
          <ElTableColumn label="库存重量 (kg)" min-width="140" align="right"><template #default="{ row }">{{ inventoryAmount(row.owned_weight) }}</template></ElTableColumn>
          <ElTableColumn :label="`${availableLabel}件数`" min-width="120" align="right"><template #default="{ row }">{{ inventoryAmount(dispatchableAmounts(asStock(row)).quantity) }}</template></ElTableColumn>
          <ElTableColumn :label="`${availableLabel}重量 (kg)`" min-width="150" align="right"><template #default="{ row }">{{ inventoryAmount(dispatchableAmounts(asStock(row)).weight) }}</template></ElTableColumn>
          <ElTableColumn v-if="hasPending" label="待签收件数" min-width="120" align="right"><template #default="{ row }">{{ inventoryAmount(row.in_transit_quantity) }}</template></ElTableColumn>
          <ElTableColumn v-if="hasPending" label="待签收重量 (kg)" min-width="150" align="right"><template #default="{ row }">{{ inventoryAmount(row.in_transit_weight) }}</template></ElTableColumn>
          <ElTableColumn v-if="hasExternalPending" label="对外待确认件数" min-width="150" align="right"><template #default="{ row }">{{ inventoryAmount(row.external_pending_quantity) }}</template></ElTableColumn>
          <ElTableColumn v-if="hasExternalPending" label="对外待确认重量 (kg)" min-width="180" align="right"><template #default="{ row }">{{ inventoryAmount(row.external_pending_weight) }}</template></ElTableColumn>
          <ElTableColumn v-if="hasLoss" label="丢失件数" min-width="110" align="right"><template #default="{ row }">{{ inventoryAmount(row.lost_quantity) }}</template></ElTableColumn>
          <ElTableColumn v-if="hasLoss" label="丢失重量 (kg)" min-width="140" align="right"><template #default="{ row }">{{ inventoryAmount(row.lost_weight) }}</template></ElTableColumn>
          <ElTableColumn label="接收时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.transfer.received_at) }}</template></ElTableColumn>
          <ElTableColumn label="操作" :width="canWrite ? 250 : 110" fixed="right"><template #default="{ row }"><div class="source-actions"><ElButton link type="primary" @click="openQuantity(asStock(row))">{{ canWrite && stockAvailable(asStock(row)) ? '加工件数变更' : '件数记录' }}</ElButton><template v-if="canWrite"><ElButton link type="primary" :disabled="!stockAvailable(asStock(row))" @click="action('dispatch', asStock(row))">出库</ElButton><ElButton link type="primary" :disabled="!stockAvailable(asStock(row))" @click="action('loss', asStock(row))">登记丢失</ElButton></template></div></template></ElTableColumn>
        </ElTable>
        <footer><span>共 {{ total }} 个来源批次（含无结存）</span><ElPagination aria-label="来源结存分页" :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="page = $event; load()" @size-change="pageSize = $event; page = 1; load()" /></footer>
      </section>
      <section class="stock-detail-section" aria-label="逐笔收发记录">
        <header><h3>收发记录</h3><span>{{ movementTotal }} 笔</span></header>
        <ElTable class="business-table warehouse-movement-table" :data="movements" row-key="id" empty-text="暂无收发记录">
          <ElTableColumn label="批次号" min-width="205"><template #default="{ row }"><ElButton link type="primary" @click="open(asTransfer(row))">{{ row.batch_no }}</ElButton></template></ElTableColumn>
          <ElTableColumn label="业务" min-width="95"><template #default="{ row }">{{ movementLabel(asTransfer(row)) }}</template></ElTableColumn>
          <ElTableColumn label="来源批次号" min-width="205"><template #default="{ row }">{{ incoming(asTransfer(row)) ? '—' : row.source_transfer_batch_no || '—' }}</template></ElTableColumn>
          <ElTableColumn label="来源 / 去向" min-width="120"><template #default="{ row }">{{ counterpart(asTransfer(row)) }}</template></ElTableColumn>
          <ElTableColumn label="件数" min-width="85" align="right"><template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template></ElTableColumn>
          <ElTableColumn label="重量 (kg)" min-width="115" align="right"><template #default="{ row }">{{ inventoryAmount(row.weight) }}</template></ElTableColumn>
          <ElTableColumn label="状态" min-width="125"><template #default="{ row }"><ElTag effect="light" :type="materialTransferStatusTone(row.status)">{{ materialTransferStatusLabel(row.status, row.entry_kind) }}</ElTag></template></ElTableColumn>
          <ElTableColumn label="收发时间" min-width="170"><template #default="{ row }">{{ formatDateTime(incoming(asTransfer(row)) ? row.received_at : row.transferred_at) }}</template></ElTableColumn>
        </ElTable>
        <footer><span>共 {{ movementTotal }} 笔收发记录</span><ElPagination aria-label="收发记录分页" :current-page="movementPage" :page-size="movementPageSize" :page-sizes="[10,20,50,100]" :total="movementTotal" layout="sizes, prev, pager, next" @current-change="movementPage = $event; load()" @size-change="movementPageSize = $event; movementPage = 1; load()" /></footer>
      </section>
    </template>
  </ElDialog>
  <MaterialTransferDrawer v-model="batchOpen" :transfer="selected" :trace-scope="{ team_id: teamId, direction: 'all' }" @changed="changed" />
  <QuantityAdjustmentDialog v-model="quantityOpen" :team-id="teamId" :source-id="quantitySource" :can-write="canWrite" @saved="changed" />
</template>

<style scoped>
.stock-detail-section { margin-top: 24px; }
.stock-detail-section > header, .stock-detail-section > footer { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.stock-detail-section > header { margin-bottom: 12px; }
.stock-detail-section h3 { margin: 0; font-size: 16px; font-weight: 550; color: var(--text); }
.stock-detail-section > header > span, .stock-detail-section > footer > span { color: var(--muted); font-size: 13px; }
.stock-detail-section > footer { padding: 14px 0; }
.stock-detail-section .business-table { font-size: 14px; font-variant-numeric: tabular-nums; }
.stock-detail-section :deep(.el-table__cell) { padding-block: 13px; }
.source-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.source-actions :deep(.el-button + .el-button) { margin-left: 0; }
@media (max-width: 760px) {
  :deep(.el-descriptions__body) { overflow-x: auto; }
  :deep(.el-descriptions__table) { min-width: 640px; }
  .stock-detail-section > footer { overflow-x: auto; }
  .stock-detail-section :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
  .stock-detail-section :deep(.el-table-fixed-column--right) { position: relative !important; right: auto !important; }
  .stock-detail-section :deep(.el-table-fixed-column--right::before) { box-shadow: none; }
}
</style>

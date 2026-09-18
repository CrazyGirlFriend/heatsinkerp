<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElDescriptions, ElDescriptionsItem, ElDrawer, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import StatePanel from './StatePanel.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import { inventorySourceLabel, type TeamInventoryRow } from '@/types/teamInventory'
import type { StockBatch } from '@/types/teamMaterials'
import { stockAvailable } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ teamId: number; group: TeamInventoryRow | null; canWrite?: boolean; warehouse?: boolean }>()
const emit = defineEmits<{ close: []; changed: []; action: [mode: 'dispatch' | 'loss', sources: StockBatch[]] }>()
const rows = ref<StockBatch[]>([]), total = ref(0), page = ref(1), pageSize = ref(10)
const loading = ref(false), error = ref('')
const batchOpen = ref(false), selected = ref<MaterialTransfer | null>(null)
let version = 0
const live = useLiveRefresh(() => load(true), { enabled: () => !!props.group, busy: () => loading.value })
async function load(background = false) {
  const current = ++version
  if (!props.group) return
  if (!background) { loading.value = true; rows.value = [] }
  error.value = ''
  try {
    const result = await teamMaterialApi.inventorySources(props.teamId, props.group.group_id, { page: page.value, page_size: pageSize.value })
    if (current === version) { rows.value = result.items; total.value = result.total }
  } catch (e) { if (current === version) { if (background) throw e; error.value = e instanceof Error ? e.message : '来源明细加载失败' } }
  finally { if (current === version) loading.value = false }
}
function open(transfer: MaterialTransfer) {
  selected.value = transfer; batchOpen.value = true
}
function action(mode: 'dispatch' | 'loss', row: StockBatch) { if (props.canWrite && !loading.value && !error.value && stockAvailable(row)) emit('action', mode, [row]) }
function asStock(row: unknown) { return row as StockBatch }
function changed() { void load(); emit('changed') }
watch(() => [props.teamId, props.group?.group_id], () => { page.value = 1; rows.value = []; total.value = 0; batchOpen.value = false; void load() }, { immediate: true })
onBeforeUnmount(() => { ++version })
</script>

<template>
  <ElDrawer :model-value="!!group" title="库存来源明细" size="min(1200px, 96vw)" append-to-body class="warehouse-stock-detail" @update:model-value="!$event && emit('close')">
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <ElDescriptions v-if="group" :column="3" border>
      <ElDescriptionsItem label="流水号">{{ group.serial_no }}</ElDescriptionsItem>
      <ElDescriptionsItem label="材质">{{ group.material_name || '—' }}</ElDescriptionsItem>
      <ElDescriptionsItem label="规格">{{ group.transfer_specification || '—' }}</ElDescriptionsItem>
      <ElDescriptionsItem label="物料类型">{{ materialTypeLabel(group.material_type || null) }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="warehouse ? '来源' : '上序班组'" :span="2">{{ inventorySourceLabel(group, warehouse) }}</ElDescriptionsItem>
    </ElDescriptions>
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取来源批次" />
    <ElTable v-else class="business-table warehouse-source-table" :data="rows" row-key="transfer.id" empty-text="暂无来源记录">
      <ElTableColumn label="来源批次" min-width="215" align="center"><template #default="{ row }"><ElButton link type="primary" @click="open(row.transfer)">{{ row.transfer.batch_no }}</ElButton></template></ElTableColumn>
      <ElTableColumn label="入库件数" min-width="100" align="center" prop="received_quantity" />
      <ElTableColumn label="入库重量 (kg)" min-width="135" align="center" prop="received_weight" />
      <ElTableColumn label="当前件数" min-width="100" align="center" prop="on_hand_quantity" />
      <ElTableColumn label="当前重量 (kg)" min-width="135" align="center" prop="on_hand_weight" />
      <ElTableColumn label="接收时间" min-width="170" align="center"><template #default="{ row }">{{ formatDateTime(row.transfer.received_at) }}</template></ElTableColumn>
      <ElTableColumn v-if="canWrite" label="操作" width="160" fixed="right" align="center"><template #default="{ row }"><ElButton link type="primary" :disabled="!stockAvailable(asStock(row))" @click="action('dispatch', asStock(row))">出库</ElButton><ElButton link type="primary" :disabled="!stockAvailable(asStock(row))" @click="action('loss', asStock(row))">登记丢失</ElButton></template></ElTableColumn>
    </ElTable>
    <template #footer><div class="warehouse-detail-footer"><span>共 {{ total }} 个来源批次（含已出完）</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="sizes, prev, pager, next" @current-change="page = $event; load()" @size-change="pageSize = $event; page = 1; load()" /></div></template>
  </ElDrawer>
  <MaterialTransferDrawer v-model="batchOpen" :transfer="selected" :trace-scope="{ team_id: teamId, direction: 'all' }" @changed="changed" />
</template>

<style scoped>
.warehouse-source-table { margin-top: 20px; font-size: 16px; font-variant-numeric: tabular-nums; }
.warehouse-source-table :deep(.el-table__cell) { padding-block: 16px; }
.warehouse-detail-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
.warehouse-detail-footer > span { color: var(--muted); }
@media (max-width: 760px) { :deep(.el-descriptions__body) { overflow-x: auto; }:deep(.el-descriptions__table) { min-width: 640px; }.warehouse-detail-footer { overflow-x: auto; } }
</style>

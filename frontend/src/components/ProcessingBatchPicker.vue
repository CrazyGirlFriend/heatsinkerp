<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElButton, ElDialog, ElInput, ElLoading, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import StatePanel from './StatePanel.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { inventoryAmount } from '@/types/teamInventory'
import { materialTypeLabel } from '@/types/materialTransfer'
import type { StockBatch } from '@/types/teamMaterials'

const props = defineProps<{ teamId: number; groupId?: number }>()
const vLoading = ElLoading.directive
const emit = defineEmits<{ close: []; selected: [sourceId: number] }>()
const query = ref(''), applied = ref(''), page = ref(1), pageSize = ref(10)
const rows = ref<StockBatch[]>([]), total = ref(0), loading = ref(false), error = ref('')
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true; error.value = ''; rows.value = []
  try {
    const result = await teamMaterialApi.processingSources(props.teamId, { group_id: props.groupId, query: applied.value || undefined, page: page.value, page_size: pageSize.value })
    if (current !== generation) return
    const last = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > last) { page.value = last; await load(); return }
    rows.value = result.items; total.value = result.total
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '库存批次读取失败' }
  finally { if (current === generation) loading.value = false }
}
function search() { applied.value = query.value.trim(); page.value = 1; void load() }
watch(() => [props.teamId, props.groupId], () => { query.value = applied.value = ''; page.value = 1; void load() }, { immediate: true })
onBeforeUnmount(() => { ++generation })
</script>

<template>
  <ElDialog :model-value="true" title="加工登记 · 选择库存批次" width="min(1040px, calc(100vw - 24px))" align-center append-to-body class="processing-batch-picker" @close="emit('close')">
    <div class="processing-picker-search"><ElInput v-model="query" :prefix-icon="Search" clearable aria-label="加工库存搜索" placeholder="流水号、批次号或材质" @keyup.enter="search" @clear="search" /><ElButton @click="search">查询</ElButton></div>
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ElTable v-else v-loading="loading" :data="rows" class="business-table" height="min(440px, 50dvh)" empty-text="暂无可登记加工的在库批次" aria-label="加工来源批次">
      <ElTableColumn label="流水号" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.transfer.serial_no }}</template></ElTableColumn>
      <ElTableColumn label="物料类型" min-width="110"><template #default="{ row }">{{ materialTypeLabel(row.transfer.material_type) }}</template></ElTableColumn>
      <ElTableColumn label="未转出件数" min-width="110" align="right"><template #default="{ row }">{{ inventoryAmount(row.on_hand_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="未转出重量 (kg)" min-width="145" align="right"><template #default="{ row }">{{ inventoryAmount(row.on_hand_weight) }}</template></ElTableColumn>
      <ElTableColumn label="加工状态" min-width="185" align="center"><template #default="{ row }"><ProcessingStockStatus :state="row.processing_state" :material-type="row.transfer.material_type" /></template></ElTableColumn>
      <ElTableColumn label="来源批次" min-width="205" show-overflow-tooltip><template #default="{ row }">{{ row.transfer.batch_no }}</template></ElTableColumn>
      <ElTableColumn label="操作" width="85" fixed="right" align="center"><template #default="{ row }"><ElButton link type="primary" :disabled="loading" @click="emit('selected', Number(row.transfer.id))">选择</ElButton></template></ElTableColumn>
    </ElTable>
    <div class="processing-picker-footer"><span>共 {{ total }} 批</span><ElPagination :current-page="page" :page-size="pageSize" :total="total" :disabled="loading" layout="prev, pager, next" @current-change="page = $event; load()" /></div>
    <template #footer><ElButton @click="emit('close')">取消</ElButton></template>
  </ElDialog>
</template>

<style>
.processing-batch-picker { display: flex; flex-direction: column; max-height: calc(100dvh - 24px); }
.processing-batch-picker .el-dialog__body { min-height: 0; overflow: auto; }
</style>

<style scoped>
.processing-picker-search { display: flex; gap: 8px; margin-bottom: 14px; }
.processing-picker-search .el-input { min-width: 0; }
.processing-picker-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 12px; color: var(--muted); font-size: 13px; }
@media (max-width: 600px) { .processing-picker-footer { flex-wrap: wrap; } }
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { ElTable, ElTableColumn } from 'element-plus'
import { inventoryAmount } from '@/types/teamInventory'
import type { SharedMaterialFields } from '@/types/sharedMaterial'
const props = defineProps<{ item: SharedMaterialFields & { serial_no?: string } }>()
const members = computed(() => props.item.shared_serials || [])
const plannedWeight = computed(() => members.value.length && members.value.every(member => member.planned_weight != null) ? members.value.reduce((sum, member) => sum + Number(member.planned_weight), 0) : null)
const plannedQuantity = computed(() => members.value.length && members.value.every(member => member.planned_quantity != null) ? members.value.reduce((sum, member) => sum + Number(member.planned_quantity), 0) : null)
</script>
<template>
  <section v-if="item.shared_group_id" class="shared-material-info material-detail-section" aria-label="共投关联资料">
    <header>
      <div class="detail-section-heading"><h3>共投分配计划</h3><span>来源 {{ item.shared_origin_batch_no || '—' }}</span></div>
      <span>{{ item.shared_unallocated ? '实物尚未分配' : `本批归属 ${item.serial_no}` }}</span>
    </header>
    <ElTable class="business-table shared-plan-table" aria-label="共投流水号分配明细" :data="members" row-key="serial_no" :row-class-name="({ row }) => !item.shared_unallocated && item.serial_no === row.serial_no ? 'shared-current-serial' : ''" empty-text="暂无分配计划">
      <ElTableColumn label="流水号" min-width="150"><template #default="{ row }"><span class="shared-serial">{{ row.serial_no }}</span></template></ElTableColumn>
      <ElTableColumn label="客户" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ row.customer_code || '—' }}</template></ElTableColumn>
      <ElTableColumn label="计划用料 (kg)" min-width="130"><template #default="{ row }">{{ row.planned_weight == null ? '未登记' : inventoryAmount(row.planned_weight) }}</template></ElTableColumn>
      <ElTableColumn label="计划切出 (件)" min-width="130"><template #default="{ row }">{{ row.planned_quantity == null ? '未登记' : inventoryAmount(row.planned_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="计划切割尺寸" min-width="185" show-overflow-tooltip><template #default="{ row }">{{ row.planned_specification || '未登记' }}</template></ElTableColumn>
      <ElTableColumn label="成品规格" min-width="165" show-overflow-tooltip><template #default="{ row }">{{ row.finished_specification || '—' }}</template></ElTableColumn>
      <ElTableColumn label="要求发货日期" min-width="145"><template #default="{ row }">{{ row.delivery_date || '—' }}</template></ElTableColumn>
      <ElTableColumn label="应发件数" min-width="110"><template #default="{ row }">{{ row.delivery_quantity ?? '—' }}</template></ElTableColumn>
    </ElTable>
    <footer><span class="shared-plan-total">计划合计 <b>{{ plannedWeight == null ? '未登记' : `${inventoryAmount(plannedWeight)} kg` }}</b><b>{{ plannedQuantity == null ? '未登记' : `${inventoryAmount(plannedQuantity)} 件` }}</b></span><span>计划不计入库存，实际以加工登记为准</span></footer>
  </section>
</template>
<style scoped>
.shared-serial { color: var(--primary); font-weight: 550; }
:deep(.shared-current-serial) { --el-table-tr-bg-color: var(--primary-soft); }
.shared-plan-total { display: flex; flex-wrap: wrap; gap: 16px; align-items: baseline; }
.shared-plan-total b { color: var(--text); font-weight: 550; font-variant-numeric: tabular-nums; }
</style>

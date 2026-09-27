<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElTable, ElTableColumn, ElPagination } from 'element-plus'
import MaterialAmount from './MaterialAmount.vue'
import type { MaterialBalance, TeamMaterialOverview } from '@/types/teamMaterials'
import { materialTypeLabel } from '@/types/materialTransfer'
const props = withDefaults(defineProps<{ overview: TeamMaterialOverview; kind?: 'material' | 'type'; page?: number; pageSize?: number }>(), { kind: 'material', page: 1, pageSize: 10 })
const emit = defineEmits<{ filter: [value: string]; paginate: [page: number, pageSize: number] }>()
const isMaterial = computed(() => props.kind === 'material')
const title = computed(() => isMaterial.value ? '材质结存' : '物料性质结存')
const entries = computed<(MaterialBalance & { key: string; label: string })[]>(() => isMaterial.value
  ? props.overview.materials.map(row => ({ ...row, key: row.material_name || '未填写材质', label: row.material_name || '未填写材质' }))
  : (props.overview.material_types || []).map(row => ({ ...row, key: row.material_type || 'unknown', label: row.material_type ? materialTypeLabel(row.material_type) : '未分类' })))
const rows = computed(() => entries.value.slice((props.page - 1) * props.pageSize, props.page * props.pageSize))
</script>

<template>
  <section class="material-ledger">
    <header><h2>{{ title }}<small>单位：件 / kg</small></h2><slot name="actions" /></header>
    <ElTable :data="rows" class="business-table ledger-table single-line-table" :class="{ 'ledger-table--empty': !rows.length }" empty-text="暂无库存" show-overflow-tooltip>
      <ElTableColumn prop="label" :label="isMaterial ? '材质' : '物料性质'" min-width="140" show-overflow-tooltip><template #default="{ row }"><ElButton link type="primary" :aria-label="`查看${row.label}的库存明细`" @click="emit('filter', row.key)">{{ row.label }}</ElButton></template></ElTableColumn>
      <ElTableColumn label="正常料在库" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.available_quantity" :weight="row.available_weight" /></template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="废料在库" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.scrap_quantity" :weight="row.scrap_weight" /></template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="转出待确认" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.reserved_quantity" :weight="row.reserved_weight" /></template></ElTableColumn>
      <ElTableColumn label="在库合计" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.on_hand_quantity" :weight="row.on_hand_weight" /></template></ElTableColumn>
      <ElTableColumn v-if="!isMaterial" label="废料可处理余量" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.scrap_available_quantity" :weight="row.scrap_available_weight" /></template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="累计接收" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.received_quantity" :weight="row.received_weight" /></template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="确认转出" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.dispatched_quantity" :weight="row.dispatched_weight" /></template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="累计丢失" min-width="190"><template #default="{ row }"><MaterialAmount :quantity="row.lost_quantity" :weight="row.lost_weight" /></template></ElTableColumn>
      <ElTableColumn label="操作" width="110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="emit('filter', row.key)">查看详情</ElButton></template></ElTableColumn>
    </ElTable>
    <footer><span>共 {{ entries.length }} 种{{ isMaterial ? '材质' : '物料性质' }}</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="entries.length" layout="sizes, prev, pager, next" @current-change="emit('paginate', $event, pageSize)" @size-change="emit('paginate', 1, $event)" /></footer>
  </section>
</template>

<style scoped>
.material-ledger { display: flex; flex: 1; flex-direction: column; min-height: 0; border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: hidden; }
.material-ledger header, .material-ledger footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; }
.material-ledger h2 { display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin: 0; font-size: 14px; font-weight: 600; }
.material-ledger h2 small, .material-ledger footer > span { font-size: 12px; font-weight: 400; color: var(--subtle); }
.ledger-table { flex: 1; min-height: 0; }
.material-ledger > .ledger-table--empty { display: flex; flex: 1 0 auto; flex-direction: column; min-height: 180px; }
.ledger-table--empty :deep(.el-table__inner-wrapper) { flex: 1; height: auto; }
.ledger-table--empty :deep(.el-scrollbar__view) { height: 100%; }
.ledger-table :deep(.el-table__cell) { padding: 10px 0; }
.material-ledger footer { margin-top: auto; border-top: 1px solid var(--line); flex-wrap: wrap; }
@media (max-width: 760px) { .material-ledger header { flex-wrap: wrap; }.material-ledger footer { padding: 8px; } }
</style>

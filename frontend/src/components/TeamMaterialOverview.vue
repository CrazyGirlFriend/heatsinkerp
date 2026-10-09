<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElTable, ElTableColumn, ElPagination } from 'element-plus'
import { inventoryAmount } from '@/types/teamInventory'
import type { MaterialBalance, TeamMaterialOverview } from '@/types/teamMaterials'
import { materialTypeLabel } from '@/types/materialTransfer'
import { tableExportSource } from '@/utils/tableExport'
const props = withDefaults(defineProps<{ overview: TeamMaterialOverview; kind?: 'material' | 'type'; page?: number; pageSize?: number; fullscreen?: boolean }>(), { kind: 'material', page: 1, pageSize: 10 })
const emit = defineEmits<{ filter: [value: string]; paginate: [page: number, pageSize: number] }>()
const isMaterial = computed(() => props.kind === 'material')
const title = computed(() => isMaterial.value ? '材质库存' : '类型库存')
const entries = computed<(MaterialBalance & { key: string; label: string })[]>(() => isMaterial.value
  ? props.overview.materials.map(row => ({ ...row, key: row.material_name || '未填写材质', label: row.material_name || '未填写材质' }))
  : (props.overview.material_types || []).map(row => ({ ...row, key: row.material_type || 'unknown', label: row.material_type ? materialTypeLabel(row.material_type) : '未分类' })))
const rows = computed(() => entries.value.slice((props.page - 1) * props.pageSize, props.page * props.pageSize))
function exportSource() {
  const fields: [keyof MaterialBalance, string][] = [
    ['available_quantity', '正常料件数'], ['available_weight', '正常料重量 (kg)'],
    ...(isMaterial.value ? [['scrap_quantity', '废料件数'], ['scrap_weight', '废料重量 (kg)'], ['reserved_quantity', '待确认件数'], ['reserved_weight', '待确认重量 (kg)']] as [keyof MaterialBalance, string][] : []),
    ['owned_quantity', '库存件数'], ['owned_weight', '库存重量 (kg)'],
    ...(!isMaterial.value ? [['scrap_available_quantity', '废料可处理件数'], ['scrap_available_weight', '废料可处理重量 (kg)']] as [keyof MaterialBalance, string][] :
      [['received_quantity', '累计接收件数'], ['received_weight', '累计接收重量 (kg)'], ['dispatched_quantity', '确认转出件数'], ['dispatched_weight', '确认转出重量 (kg)'], ['lost_quantity', '累计丢失件数'], ['lost_weight', '累计丢失重量 (kg)']] as [keyof MaterialBalance, string][]),
  ]
  const data = entries.value.map(row => ({ ...row }))
  return tableExportSource(title.value, data.length, [
    { key: 'label', label: isMaterial.value ? '材质' : '物料类型', value: (row: typeof data[number]) => row.label },
    ...fields.map(([key, label]) => ({ key, label, value: (row: typeof data[number]) => row[key] })),
  ], async () => data)
}
defineExpose({ exportSource })
</script>

<template>
  <section class="material-ledger">
    <header><h2>{{ title }}</h2><slot name="actions" /></header>
    <ElTable :data="rows" :height="fullscreen ? '100%' : undefined" :flexible="fullscreen" class="business-table ledger-table single-line-table" :class="{ 'ledger-table--empty': !rows.length }" empty-text="暂无库存" show-overflow-tooltip>
      <ElTableColumn prop="label" :label="isMaterial ? '材质' : '物料类型'" min-width="140" fixed="left" show-overflow-tooltip><template #default="{ row }"><ElButton link type="primary" :aria-label="`查看${row.label}的库存明细`" @click="emit('filter', row.key)">{{ row.label }}</ElButton></template></ElTableColumn>
      <ElTableColumn label="正常料件数" min-width="125" align="center"><template #default="{ row }">{{ inventoryAmount(row.available_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="正常料重量 (kg)" min-width="155" align="center"><template #default="{ row }">{{ inventoryAmount(row.available_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="废料件数" min-width="115" align="center"><template #default="{ row }">{{ inventoryAmount(row.scrap_quantity) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="废料重量 (kg)" min-width="145" align="center"><template #default="{ row }">{{ inventoryAmount(row.scrap_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="待确认件数" min-width="125" align="center"><template #default="{ row }">{{ inventoryAmount(row.reserved_quantity) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="待确认重量 (kg)" min-width="155" align="center"><template #default="{ row }">{{ inventoryAmount(row.reserved_weight) }}</template></ElTableColumn>
      <ElTableColumn label="库存件数" min-width="115" align="center"><template #default="{ row }">{{ inventoryAmount(row.owned_quantity) }}</template></ElTableColumn>
      <ElTableColumn label="库存重量 (kg)" min-width="145" align="center"><template #default="{ row }">{{ inventoryAmount(row.owned_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="!isMaterial" label="废料可处理件数" min-width="150" align="center"><template #default="{ row }">{{ inventoryAmount(row.scrap_available_quantity) }}</template></ElTableColumn>
      <ElTableColumn v-if="!isMaterial" label="废料可处理重量 (kg)" min-width="180" align="center"><template #default="{ row }">{{ inventoryAmount(row.scrap_available_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="累计接收件数" min-width="145" align="center"><template #default="{ row }">{{ inventoryAmount(row.received_quantity) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="累计接收重量 (kg)" min-width="175" align="center"><template #default="{ row }">{{ inventoryAmount(row.received_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="确认转出件数" min-width="145" align="center"><template #default="{ row }">{{ inventoryAmount(row.dispatched_quantity) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="确认转出重量 (kg)" min-width="175" align="center"><template #default="{ row }">{{ inventoryAmount(row.dispatched_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="累计丢失件数" min-width="145" align="center"><template #default="{ row }">{{ inventoryAmount(row.lost_quantity) }}</template></ElTableColumn>
      <ElTableColumn v-if="isMaterial" label="累计丢失重量 (kg)" min-width="175" align="center"><template #default="{ row }">{{ inventoryAmount(row.lost_weight) }}</template></ElTableColumn>
      <ElTableColumn v-if="entries.some(item => (item.shortage_quantity ?? 0) > 0 || (item.shortage_weight ?? 0) > 0)" label="账面缺口" min-width="170" align="center"><template #default="{ row }"><span class="stock-shortage">{{ inventoryAmount(row.shortage_quantity) }} 件 / {{ inventoryAmount(row.shortage_weight) }} kg</span></template></ElTableColumn>
      <ElTableColumn label="操作" width="110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="emit('filter', row.key)">查看详情</ElButton></template></ElTableColumn>
    </ElTable>
    <footer><span>共 {{ entries.length }} 种{{ isMaterial ? '材质' : '物料类型' }}</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="entries.length" layout="sizes, prev, pager, next" @current-change="emit('paginate', $event, pageSize)" @size-change="emit('paginate', 1, $event)" /></footer>
  </section>
</template>

<style scoped>
.material-ledger { display: flex; flex: 1; flex-direction: column; min-height: 0; border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: hidden; }
.material-ledger header, .material-ledger footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; }
.material-ledger header { min-height: 68px; padding-block: 16px; }
.material-ledger h2 { display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin: 0; font-size: 16px; font-weight: 600; }
.material-ledger footer > span { font-size: 12px; font-weight: 400; color: var(--subtle); }
.ledger-table { flex: 1; min-height: 0; }
.material-ledger > .ledger-table--empty { display: flex; flex: 1 0 auto; flex-direction: column; min-height: 180px; }
.ledger-table--empty :deep(.el-table__inner-wrapper) { flex: 1; height: auto; }
.ledger-table--empty :deep(.el-scrollbar__view) { height: 100%; }
.ledger-table :deep(.el-table__cell) { padding: 10px 0; }
.material-ledger footer { margin-top: auto; border-top: 1px solid var(--line); flex-wrap: wrap; }
@media (max-width: 760px) {
  .material-ledger header { flex-wrap: wrap; padding-inline: 12px; }
  .material-ledger header :deep(.workspace-actions) { width: 100%; }
  .material-ledger footer { padding: 8px; overflow-x: auto; }
  .ledger-table :deep(.el-table-fixed-column--left), .ledger-table :deep(.el-table-fixed-column--right) { position: relative !important; left: auto !important; right: auto !important; }
  .ledger-table :deep(.el-table__cell::before) { box-shadow: none; }
  .ledger-table :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
}
.stock-shortage { color: var(--el-color-danger); }
</style>

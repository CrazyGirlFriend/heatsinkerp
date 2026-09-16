<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElTable, ElTableColumn, ElPagination } from 'element-plus'
import MaterialAmount from './MaterialAmount.vue'
import type { TeamMaterialOverview } from '@/types/teamMaterials'
import { materialTypeLabel } from '@/types/materialTransfer'
const props = defineProps<{ overview: TeamMaterialOverview }>()
const emit = defineEmits<{ filter: [material: string] }>()
const page = ref(1)
const pageSize = ref(10)
const materials = computed(() => props.overview.materials.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch(() => props.overview.team_id, () => { page.value = 1 })
watch(pageSize, () => { page.value = 1 })
</script>

<template>
  <section class="material-ledger">
    <header><h2>材质结存<small>单位：件 / kg</small></h2><slot name="actions" /></header>
    <ElTable :data="materials" class="business-table ledger-table" empty-text="暂无库存">
      <ElTableColumn prop="material_name" label="材质" min-width="140" show-overflow-tooltip><template #default="{ row }"><ElButton link type="primary" @click="emit('filter', row.material_name || '未填写材质')">{{ row.material_name || '未填写材质' }}</ElButton></template></ElTableColumn>
      <ElTableColumn label="正常可用库存" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.available_quantity" :weight="row.available_weight" /></template></ElTableColumn>
      <ElTableColumn label="废料结存" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.scrap_quantity" :weight="row.scrap_weight" /></template></ElTableColumn>
      <ElTableColumn label="转出待确认" min-width="140"><template #default="{ row }"><MaterialAmount :quantity="row.reserved_quantity" :weight="row.reserved_weight" /></template></ElTableColumn>
      <ElTableColumn label="当前库存" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.on_hand_quantity" :weight="row.on_hand_weight" /></template></ElTableColumn>
      <ElTableColumn label="累计接收" min-width="140"><template #default="{ row }"><MaterialAmount :quantity="row.received_quantity" :weight="row.received_weight" /></template></ElTableColumn>
      <ElTableColumn label="确认转出" min-width="140"><template #default="{ row }"><MaterialAmount :quantity="row.dispatched_quantity" :weight="row.dispatched_weight" /></template></ElTableColumn>
      <ElTableColumn label="累计丢失" min-width="140"><template #default="{ row }"><MaterialAmount :quantity="row.lost_quantity" :weight="row.lost_weight" /></template></ElTableColumn>
    </ElTable>
    <footer><span>共 {{ overview.materials.length }} 种材质</span><ElPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="overview.materials.length" layout="sizes, prev, pager, next" /></footer>
    <template v-if="overview.material_types?.length">
      <header><h2>物料性质结存<small>当前库存包含废料；正常可用库存不含废料</small></h2></header>
      <ElTable :data="overview.material_types" class="business-table ledger-table">
        <ElTableColumn label="物料性质" min-width="140"><template #default="{ row }">{{ materialTypeLabel(row.material_type) }}</template></ElTableColumn>
        <ElTableColumn label="当前库存" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.on_hand_quantity" :weight="row.on_hand_weight" /></template></ElTableColumn>
        <ElTableColumn label="正常可用库存" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.available_quantity" :weight="row.available_weight" /></template></ElTableColumn>
        <ElTableColumn label="废料可处理余量" min-width="150"><template #default="{ row }"><MaterialAmount :quantity="row.scrap_available_quantity" :weight="row.scrap_available_weight" /></template></ElTableColumn>
      </ElTable>
    </template>
  </section>
</template>

<style scoped>
.material-ledger { display: flex; flex: 1; flex-direction: column; min-height: 0; border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: hidden; }
.material-ledger header, .material-ledger footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; }
.material-ledger h2 { display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin: 0; font-size: 14px; font-weight: 600; }
.material-ledger h2 small, .material-ledger footer > span { font-size: 12px; font-weight: 400; color: var(--subtle); }
.ledger-table { flex: 1; min-height: 0; }
.ledger-table :deep(.el-table__cell) { padding: 10px 0; }
.material-ledger footer { border-top: 1px solid var(--line); flex-wrap: wrap; }
@media (max-width: 760px) { .material-ledger header { flex-wrap: wrap; }.material-ledger footer { padding: 8px; } }
</style>

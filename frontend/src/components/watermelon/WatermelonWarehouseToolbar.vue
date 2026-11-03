<script setup lang="ts">
import WatermelonDataToolbar from './WatermelonDataToolbar.vue'
import WatermelonFilter from './WatermelonFilter.vue'
import WatermelonButton from './WatermelonButton.vue'
import { IconBox, IconLayoutGrid, IconClock, IconLock, IconCircleOff } from '@tabler/icons-vue'
import type { WarehouseCatalogFilter } from '@/services/warehouseCatalog'

defineProps<{
  loading?: boolean
  state?: WarehouseCatalogFilter
}>()
const query = defineModel<string>({ default: '' })
const emit = defineEmits<{
  search: []
  refresh: []
  reset: []
  state: [value: WarehouseCatalogFilter | undefined]
}>()
const stateOptions = [
  { value: '', label: '全部', icon: IconLayoutGrid, color: '#6b7280' },
  { value: 'unassigned', label: '未分配', icon: IconBox, color: '#b28030' },
  { value: 'occupied', label: '有料', icon: IconBox, color: '#24896d' },
  { value: 'available', label: '空闲', icon: IconLayoutGrid, color: '#89939e' },
  { value: 'pending', label: '待签收', icon: IconClock, color: '#397fba' },
  { value: 'draft', label: '填写中', icon: IconLock, color: '#b28030' },
  { value: 'disabled', label: '停用', icon: IconCircleOff, color: '#8d8793' },
]
function changeState(value: string) {
  emit('state', (value || undefined) as WarehouseCatalogFilter | undefined)
}
</script>

<template>
  <div class="wm-warehouse-toolbar">
    <WatermelonDataToolbar
      v-model="query"
      class="wm-warehouse-actions"
      label="搜索仓位"
      placeholder="仓位、流水号或材质"
      :loading="loading"
      @search="emit('search')"
      @refresh="emit('refresh')"
    >
      <template #filters>
        <WatermelonFilter
          :model-value="state || ''"
          :options="stateOptions"
          label="筛选"
          title="库存筛选"
          @update:model-value="changeState"
        />
        <WatermelonButton v-if="state || query" class="wm-reset" @click="emit('reset')"
          >重置</WatermelonButton
        >
      </template>
      <template #tools><slot name="tools" /></template>
      <template #actions><slot name="actions" /></template>
      <template #primary-actions><slot name="primary-actions" /></template>
    </WatermelonDataToolbar>
  </div>
</template>

<style scoped>
.wm-warehouse-toolbar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 0 0 auto;
  margin-bottom: 20px;
}
.wm-warehouse-actions {
  width: 100%;
}
.wm-reset {
  background: transparent;
  border: 0;
  padding-inline: 6px;
}
</style>

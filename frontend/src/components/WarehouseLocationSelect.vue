<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'

const props = defineProps<{ modelValue: string; teamId: number; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const items = ref<{ name: string; has_stock: boolean }[]>([])
const loading = ref(false), failed = ref(false)
let generation = 0
async function search(query = '') {
  const version = ++generation
  if (!props.teamId || props.disabled) return
  loading.value = true; failed.value = false
  try {
    const result = await teamMaterialApi.warehouseLocations(props.teamId, query.slice(0, 80))
    if (version === generation) items.value = result.items
  } catch {
    if (version === generation) { items.value = []; failed.value = true }
  } finally { if (version === generation) loading.value = false }
}
watch(() => props.teamId, () => { ++generation; items.value = []; loading.value = false; failed.value = false })
onBeforeUnmount(() => { ++generation })
</script>

<template>
  <div class="warehouse-location-select">
    <ElSelect :model-value="modelValue" :disabled="disabled" aria-label="入库仓位" placeholder="选择仓位，或输入新仓位后按回车" filterable allow-create default-first-option clearable remote :remote-method="search" :loading="loading" @visible-change="open => { if (open) search() }" @update:model-value="emit('update:modelValue', String($event || '').trim())">
      <ElOption v-for="item in items" :key="item.name" :value="item.name" :label="item.name"><span>{{ item.name }}</span><small>{{ item.has_stock ? '有库存' : '历史仓位' }}</small></ElOption>
    </ElSelect>
    <small :role="failed ? 'status' : undefined">{{ failed ? '仓位列表加载失败，仍可手动输入；重新展开可重试。' : '优先显示有库存的仓位，也可输入新仓位。' }}</small>
  </div>
</template>

<style scoped>
.warehouse-location-select { width: 100%; }
.warehouse-location-select > small { display: block; margin-top: 6px; line-height: 1.5; color: var(--subtle); font-size: 12px; }
.el-select { width: 100%; }
.el-select-dropdown__item { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.el-select-dropdown__item small { color: var(--subtle); font-size: 12px; }
</style>

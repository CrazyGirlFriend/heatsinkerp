<script setup lang="ts">
import { computed, watch } from 'vue'
import { ElFormItem, ElInputNumber } from 'element-plus'
import { sludgeWeight } from '@/utils/sludgeWeight'
const props = defineProps<{ gross?: number | null; percent?: number | null; disabled?: boolean; locked?: boolean; label?: string }>()
const emit = defineEmits<{ 'update:gross': [number | undefined]; 'update:percent': [number | undefined]; 'update:weight': [number | undefined] }>()
const weight = computed(() => sludgeWeight(props.gross, props.percent))
watch(weight, value => emit('update:weight', value), { immediate: true })
</script>

<template>
  <div class="sludge-measurement">
    <ElFormItem label="废泥实重（kg）" required><ElInputNumber :model-value="gross ?? undefined" :aria-label="`${label || ''}废泥实重`" :min="0" :max="99999999999.999" :precision="3" :step="0.001" :disabled="disabled" controls-position="right" @update:model-value="emit('update:gross', $event)" /></ElFormItem>
    <ElFormItem label="有效材料占比（%）" required><ElInputNumber :model-value="percent ?? undefined" :aria-label="`${label || ''}有效材料占比`" :min="0.01" :max="100" :precision="2" :step="1" :disabled="disabled || locked" controls-position="right" @update:model-value="emit('update:percent', $event)" /></ElFormItem>
    <div class="sludge-result"><span>折算重量</span><strong>{{ weight == null ? '—' : weight }} kg</strong><small>{{ locked ? '沿用原批次比例；库存按折算重量计算' : '班组长填写占比；库存按折算重量计算' }}</small></div>
  </div>
</template>

<style scoped>
.sludge-measurement { display: flex; flex-wrap: wrap; gap: 16px 24px; grid-column: 1 / -1; }
.sludge-result { display: grid; align-content: start; gap: 6px; color: var(--subtle); }
.sludge-result strong { color: var(--text); font-weight: 500; }
.sludge-result small { font-size: 12px; }
</style>

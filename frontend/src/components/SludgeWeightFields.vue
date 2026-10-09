<script setup lang="ts">
import WeightInput from './WeightInput.vue'
import { computed, watch } from 'vue'
import { ElFormItem, ElInputNumber } from 'element-plus'
import type { SludgeMeasurement } from '@/types/materialTransfer'
import { sludgeWeight } from '@/utils/sludgeWeight'
const props = defineProps<{ gross?: number | null; percent?: number | null; disabled?: boolean; locked?: boolean; label?: string; existing?: SludgeMeasurement & { weight: number } }>()
const emit = defineEmits<{ 'update:gross': [number | undefined]; 'update:percent': [number | undefined]; 'update:weight': [number | undefined] }>()
const weight = computed(() => props.existing && props.gross === props.existing.sludge_gross_weight && props.percent === props.existing.sludge_content_percent ? props.existing.weight : sludgeWeight(props.gross, props.percent))
watch(weight, value => emit('update:weight', value), { immediate: true })
</script>

<template>
  <div class="sludge-measurement dialog-form-grid dialog-field-wide">
    <ElFormItem label="废泥实重" required><WeightInput :model-value="gross ?? undefined" :ariaLabel="`${label || ''}废泥实重`" :max="99999999999.999" :disabled="disabled" @update:model-value="emit('update:gross', $event)" /></ElFormItem>
    <ElFormItem label="有效材料占比" required><ElInputNumber :model-value="percent ?? undefined" :aria-label="`${label || ''}有效材料占比`" :min="0.01" :max="100" :precision="2" :step="1" :disabled="disabled || locked" controls-position="right" @update:model-value="emit('update:percent', $event)"><template #suffix><span class="dialog-input-unit">%</span></template></ElInputNumber></ElFormItem>
    <div class="sludge-result dialog-field-wide"><span>折算重量</span><strong>{{ weight == null ? '—' : weight }} kg</strong><small>{{ locked ? '沿用原批次比例；库存按折算重量计算' : '班组长填写占比；库存按折算重量计算' }}</small></div>
  </div>
</template>

<style scoped>
.sludge-result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; margin: -8px 0 20px; padding: 12px; border-radius: 8px; background: var(--surface-soft); color: var(--subtle); }
.sludge-result strong { color: var(--text); font-weight: 500; }
.sludge-result small { font-size: 12px; }
</style>

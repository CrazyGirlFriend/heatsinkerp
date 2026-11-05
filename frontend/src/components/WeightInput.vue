<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppNumberInput from './AppNumberInput.vue'
import AppSelect from './AppSelect.vue'
import { ElOption } from 'element-plus'

const props = defineProps<{
  modelValue?: number | null
  disabled?: boolean
  ariaLabel: string
  max?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [number | undefined] }>()
const unit = ref<'kg' | 'g'>('kg')
// Existing sub-gram measurements remain exact; changing display must not rewrite stock.
watch(
  () => props.modelValue,
  (value) => {
    if (value != null && Math.abs(value * 1000 - Math.round(value * 1000)) > 0.000001)
      unit.value = 'g'
  },
  { immediate: true },
)
const factor = computed(() => (unit.value === 'g' ? 1000 : 1))
const displayed = computed(() =>
  props.modelValue == null ? undefined : Number((props.modelValue * factor.value).toFixed(3)),
)
function update(value: number | undefined) {
  emit('update:modelValue', value == null ? undefined : Number((value / factor.value).toFixed(6)))
}
</script>

<template>
  <div class="weight-input">
    <AppNumberInput
      :model-value="displayed"
      :aria-label="ariaLabel"
      :min="0"
      :max="max == null ? undefined : max * factor"
      :precision="3"
      :step="unit === 'g' ? 0.1 : 0.001"
      :disabled="disabled"
      controls-position="right"
      @update:model-value="update"
    />
    <AppSelect
      v-model="unit"
      class="weight-unit"
      :aria-label="`${ariaLabel}单位`"
      :disabled="disabled"
    >
      <ElOption value="kg" label="kg" />
      <ElOption value="g" label="g" />
    </AppSelect>
  </div>
</template>

<style scoped>
.weight-input {
  display: flex;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.weight-input .el-input-number {
  flex: 1;
  width: 0;
  min-width: 0;
}
.weight-input .weight-unit {
  flex: 0 0 64px;
  width: 64px;
}
</style>

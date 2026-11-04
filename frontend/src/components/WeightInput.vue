<script setup lang="ts">
import { computed, ref } from 'vue'
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
const factor = computed(() => (unit.value === 'g' ? 1000 : 1))
const displayed = computed(() =>
  props.modelValue == null
    ? undefined
    : Number((props.modelValue * factor.value).toFixed(unit.value === 'g' ? 3 : 6)),
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
      :precision="unit === 'g' ? 3 : 6"
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

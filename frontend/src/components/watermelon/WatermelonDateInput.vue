<script setup lang="ts">
import AppDatePicker from '../AppDatePicker.vue'
const props = defineProps<{ modelValue?: string; disabled?: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
function disabledDate(date: Date) {
  return date.getFullYear() < 2000 || date.getFullYear() > 2100
}
</script>
<template>
  <AppDatePicker
    watermelon
    :model-value="props.modelValue"
    type="date"
    format="YYYY/MM/DD"
    value-format="YYYY-MM-DD"
    :aria-label="label"
    :disabled="disabled"
    :disabled-date="disabledDate"
    placeholder="选择日期"
    @update:model-value="emit('update:modelValue', $event || '')"
  />
</template>

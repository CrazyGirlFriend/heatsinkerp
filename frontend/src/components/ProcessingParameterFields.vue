<script setup lang="ts">
import { computed } from 'vue'
import { ElFormItem } from 'element-plus'
import AppInput from './AppInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import CompactFormSection from './CompactFormSection.vue'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import {
  processingParameterFields,
  processingParameterErrors,
  type ProcessingParameters,
  type ProcessingParameterKey,
} from '@/config/processingParameters'

const props = defineProps<{
  fields?: string[]
  totalMinutes?: number | null
  submitted?: boolean
  disabled?: boolean
}>()
const values = defineModel<ProcessingParameters>({ default: () => ({}) })
const fields = computed(() => processingParameterFields(props.fields))
const errors = computed(() =>
  props.submitted
    ? processingParameterErrors(values.value, props.fields || [], props.totalMinutes)
    : {},
)
function update(key: ProcessingParameterKey, value: string | number | undefined) {
  values.value = { ...values.value, [key]: value }
}
</script>

<template>
  <div v-if="fields.length" class="processing-parameter-fields form-field--full dialog-field-wide">
    <CompactFormSection title="加工参数（选填）">
      <ElFormItem
        v-for="field in fields"
        :key="field.key"
        :label="field.label"
        :error="errors[field.key]"
      >
        <ProcessingDurationInput
          v-if="field.kind === 'duration'"
          :model-value="values.holding_minutes ?? undefined"
          label="保温"
          :disabled="disabled"
          :invalid="!!errors[field.key]"
          @update:model-value="update(field.key, $event)"
        />
        <AppNumberInput
          v-else-if="field.kind === 'temperature'"
          :model-value="values.actual_temperature_c ?? undefined"
          :min="-273.15"
          :max="99999.99"
          :precision="2"
          :controls="false"
          :disabled="disabled"
          :aria-label="field.label"
          placeholder="实际测得温度"
          @update:model-value="update(field.key, $event)"
          ><template #suffix>°C</template></AppNumberInput
        >
        <AppInput
          v-else
          :model-value="String(values[field.key] ?? '')"
          :maxlength="field.maxLength"
          :disabled="disabled"
          :aria-label="field.label"
          :placeholder="field.key === 'temperature_requirement' ? '如 900–950 °C' : '选填'"
          @update:model-value="update(field.key, $event)"
        />
      </ElFormItem>
    </CompactFormSection>
  </div>
</template>

<style scoped>
.processing-parameter-fields {
  min-width: 0;
  container: form-fields / inline-size;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElFormItem } from 'element-plus'
import ElInput from './AppInput.vue'
import ElInputNumber from './AppNumberInput.vue'
import WeightInput from './WeightInput.vue'
import type { CreateQuantityAdjustment } from '@/types/teamMaterials'

const props = defineProps<{
  producedQuantity?: number
  producedWeight?: number
  separatedQuantity?: number
  separatedWeight?: number
  outputFailedQuantity?: number | null
  submitted: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  change: [value: NonNullable<CreateQuantityAdjustment['self_check']> | null]
}>()
const enteredQuantity = ref<number>()
const failedQuantity = computed(() =>
  props.outputFailedQuantity === undefined ? enteredQuantity.value : props.outputFailedQuantity,
)
const failedWeight = ref<number>()
const failureReason = ref('')
const error = computed(() => {
  const pieces = props.separatedQuantity || 0
  const weight = props.separatedWeight || 0
  const failed = failedQuantity.value
  if (failed == null || !Number.isSafeInteger(failed) || failed < 0)
    return props.outputFailedQuantity === null ? '请填写各产出行的不合格数' : '请填写不合格数'
  if (!failed) return pieces || weight ? '请核对不合格数与次品明细' : ''
  if (failedWeight.value == null) return '请填写不合格重量'
  if (!failureReason.value.trim()) return '请填写不合格原因'
  if (failed < pieces || failed > (props.producedQuantity || 0) + pieces)
    return '请核对不合格件数与本次加工产出'
  if (
    failedWeight.value < Number(weight.toFixed(6)) ||
    failedWeight.value > Number(((props.producedWeight || 0) + weight).toFixed(6))
  )
    return '请核对不合格重量与本次加工产出'
  return ''
})
watch(
  [error, failedQuantity, failedWeight, failureReason],
  () =>
    emit(
      'change',
      error.value
        ? null
        : failedQuantity.value
          ? {
              failed_quantity: failedQuantity.value!,
              failed_weight: failedWeight.value!,
              failure_reason: failureReason.value.trim(),
            }
          : { failed_quantity: 0, failed_weight: 0, failure_reason: '' },
    ),
  { immediate: true },
)
</script>
<template>
  <ElFormItem label="不合格数" required :error="(submitted && error) || undefined">
    <ElInputNumber
      :model-value="failedQuantity"
      :disabled="disabled || outputFailedQuantity !== undefined"
      :min="0"
      :precision="0"
      :placeholder="outputFailedQuantity !== undefined ? '按产出明细合计' : '全部合格填 0'"
      aria-label="不合格数"
      @update:model-value="enteredQuantity = $event"
    />
  </ElFormItem>
  <template v-if="failedQuantity != null && failedQuantity > 0">
    <ElFormItem label="不合格重量" required>
      <WeightInput v-model="failedWeight" :disabled="disabled" ariaLabel="不合格重量" />
    </ElFormItem>
    <ElFormItem label="不合格原因" required class="form-field--full">
      <ElInput
        v-model="failureReason"
        :disabled="disabled"
        maxlength="2000"
        aria-label="不合格原因"
      />
    </ElFormItem>
  </template>
</template>

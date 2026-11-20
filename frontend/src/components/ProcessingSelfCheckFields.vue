<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import ElInput from './AppInput.vue'
import ElInputNumber from './AppNumberInput.vue'
import ElSelect from './AppSelect.vue'
import WeightInput from './WeightInput.vue'
import type { CreateQuantityAdjustment } from '@/types/teamMaterials'

const props = defineProps<{
  producedQuantity?: number
  producedWeight?: number
  separatedQuantity?: number
  separatedWeight?: number
  submitted: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  change: [value: NonNullable<CreateQuantityAdjustment['self_check']> | null]
}>()
const result = ref<'pass' | 'fail'>()
const failedQuantity = ref<number>()
const failedWeight = ref<number>()
const failureReason = ref('')
const error = computed(() => {
  if (!result.value) return '请选择加工自检结果'
  const pieces = props.separatedQuantity || 0
  const weight = props.separatedWeight || 0
  if (result.value === 'pass') return pieces || weight ? '次品明细已填，请选择有不合格品' : ''
  const failed = failedQuantity.value
  if (!failed || !Number.isSafeInteger(failed) || failed < 1) return '请填写不合格件数'
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
  [error, result, failedQuantity, failedWeight, failureReason],
  () =>
    emit(
      'change',
      error.value
        ? null
        : result.value === 'fail'
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
  <ElFormItem label="加工自检" required :error="(submitted && error) || undefined">
    <ElSelect
      v-model="result"
      :disabled="disabled"
      aria-label="加工自检"
      placeholder="选择自检结果"
    >
      <ElOption value="pass" label="全部合格" />
      <ElOption value="fail" label="有不合格品" />
    </ElSelect>
  </ElFormItem>
  <template v-if="result === 'fail'">
    <ElFormItem label="不合格件数" required>
      <ElInputNumber
        v-model="failedQuantity"
        :disabled="disabled"
        :min="1"
        :precision="0"
        aria-label="不合格件数"
      />
    </ElFormItem>
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

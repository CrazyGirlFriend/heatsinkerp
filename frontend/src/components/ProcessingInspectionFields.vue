<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import InspectionFailureLines from './InspectionFailureLines.vue'
import type { components } from '@/types/generated/api'
import AppInput from './AppInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import AppSelect from './AppSelect.vue'
import CompactFormSection from './CompactFormSection.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { inspectionItemLabels, inspectionMethodLabels } from '@/services/inspectionApi'
import type { CreateQuantityAdjustment } from '@/types/teamMaterials'

const props = defineProps<{
  teamId: number
  quantity?: number
  submitted: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  change: [value: NonNullable<CreateQuantityAdjustment['inspection']> | null]
}>()
const scope = ref('full')
const sample = ref<number>()
const failed = ref<number | undefined>(0)
const methods = ref<('visual' | 'microscope')[]>([])
const items = ref<('appearance' | 'dimension' | 'weight')[]>([])
const failureLines = ref<components['schemas']['FailureLine'][] | null>(null)
const notes = ref('')
const dimension = ref(''),
  weight = ref('')
watch(
  [() => props.quantity, scope],
  () => {
    if (scope.value === 'full') sample.value = props.quantity
  },
  { immediate: true },
)
const sampleValid = computed(
  () =>
    Number.isSafeInteger(sample.value) &&
    sample.value! > 0 &&
    sample.value! <= (props.quantity || 0),
)
const failedValid = computed(
  () =>
    Number.isSafeInteger(failed.value) &&
    failed.value! >= 0 &&
    failed.value! <= (sample.value || 0),
)
const passed = computed(() =>
  sampleValid.value && failedValid.value ? sample.value! - failed.value! : null,
)
const hasFailures = computed(() => (failed.value || 0) > 0)
watch(
  failed,
  () => {
    failureLines.value = null
  },
  { flush: 'sync' },
)
watchEffect(() => {
  const valid =
    sampleValid.value &&
    failedValid.value &&
    methods.value.length &&
    items.value.length &&
    (!hasFailures.value || failureLines.value)
  emit(
    'change',
    valid
      ? {
          scope: scope.value === 'full' ? 'full' : 'sample',
          sample_quantity: sample.value!,
          failed_quantity: failed.value!,
          methods: [...methods.value],
          items: [...items.value],
          failure_lines: hasFailures.value ? failureLines.value! : [],
          notes: hasFailures.value ? notes.value.trim() : '',
          dimension_result: items.value.includes('dimension') ? dimension.value.trim() : '',
          weight_result: items.value.includes('weight') ? weight.value.trim() : '',
        }
      : null,
  )
})
</script>

<template>
  <CompactFormSection title="检验结果" class="processing-inspection-fields">
    <ElFormItem label="检验方式" class="form-field--medium" required>
      <WatermelonSegmented
        v-model="scope"
        label="检验方式"
        :options="[
          { value: 'full', label: '全检', disabled },
          { value: 'sample', label: '抽检', disabled },
        ]"
      />
    </ElFormItem>
    <ElFormItem
      label="检验件数"
      class="form-field--medium"
      required
      :error="submitted && !sampleValid ? '检验件数不能超过本次完成件数' : undefined"
    >
      <span v-if="scope === 'full'" class="inspection-result-value" aria-label="检验件数"
        >{{ sample ?? '—' }} 件</span
      >
      <AppNumberInput
        v-else
        v-model="sample"
        :min="1"
        :max="quantity || 0"
        :precision="0"
        aria-label="检验件数"
      />
    </ElFormItem>
    <ElFormItem label="合格件数" class="form-field--medium">
      <span class="inspection-result-value" aria-label="合格件数">{{ passed ?? '—' }} 件</span>
    </ElFormItem>
    <ElFormItem
      label="不合格件数"
      class="form-field--medium"
      required
      :error="submitted && !failedValid ? '不合格件数须在 0 至检验件数之间' : undefined"
    >
      <AppNumberInput
        v-model="failed"
        :min="0"
        :max="sample || 0"
        :precision="0"
        aria-label="不合格件数"
      />
    </ElFormItem>
    <ElFormItem
      label="检查手段"
      class="form-field--long"
      required
      :error="submitted && !methods.length ? '请选择检查手段' : undefined"
    >
      <AppSelect v-model="methods" multiple aria-label="检查手段" placeholder="选择检查手段">
        <ElOption
          v-for="(label, key) in inspectionMethodLabels"
          :key="key"
          :value="key"
          :label="label"
        />
      </AppSelect>
    </ElFormItem>
    <ElFormItem
      label="检查项目"
      class="form-field--long"
      required
      :error="submitted && !items.length ? '请选择检查项目' : undefined"
    >
      <AppSelect v-model="items" multiple aria-label="检查项目" placeholder="选择检查项目">
        <ElOption
          v-for="(label, key) in inspectionItemLabels"
          :key="key"
          :value="key"
          :label="label"
        />
      </AppSelect>
    </ElFormItem>
    <ElFormItem v-if="items.includes('dimension')" label="尺寸检查记录" class="form-field--long">
      <AppInput v-model="dimension" aria-label="尺寸检查记录" maxlength="2000" />
    </ElFormItem>
    <ElFormItem v-if="items.includes('weight')" label="重量检查记录" class="form-field--long">
      <AppInput v-model="weight" aria-label="重量检查记录" maxlength="2000" />
    </ElFormItem>
    <template v-if="hasFailures">
      <InspectionFailureLines
        :failed="failed!"
        :submitted="submitted"
        @change="failureLines = $event"
      />
      <ElFormItem label="问题说明" class="form-field--full">
        <AppInput
          v-model="notes"
          type="textarea"
          :rows="2"
          maxlength="2000"
          show-word-limit
          aria-label="问题说明"
          placeholder="描述不合格情况"
        />
      </ElFormItem>
    </template>
  </CompactFormSection>
</template>

<style scoped>
.inspection-result-value {
  min-height: var(--wm-control-height, 40px);
  display: inline-flex;
  align-items: center;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
</style>

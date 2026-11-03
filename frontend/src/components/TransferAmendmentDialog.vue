<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput, ElInputNumber } from 'element-plus'
import AppDialog from './AppDialog.vue'
import StatePanel from './StatePanel.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import { materialTransferApi } from '@/services/materialTransferApi'
import { HttpRequestError } from '@/services/httpClient'
import { transferAmendmentApi, type TransferAmendment } from '@/services/transferAmendmentApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
import { isWeightOnlyType } from '@/types/materialTransfer'
import { formatAmount } from '@/utils/format'

const props = defineProps<{ modelValue: boolean; transfer: MaterialTransfer | null }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  submitted: [TransferAmendment]
  refreshed: [MaterialTransfer]
  busy: [boolean]
}>()
const snapshot = ref<MaterialTransfer | null>(null)
const quantity = ref<number>(),
  weight = ref<number>(),
  notes = ref(''),
  reason = ref('')
const remainingQuantity = ref(0),
  remainingWeight = ref(0)
const loading = ref(false),
  saving = ref(false),
  editable = ref(false),
  error = ref('')
const minQuantity = computed(() =>
  Math.max(0, (snapshot.value?.quantity || 0) - remainingQuantity.value),
)
const minWeight = computed(() =>
  Math.max(
    0,
    Math.round(((snapshot.value?.weight || 0) - remainingWeight.value) * 1_000_000) / 1_000_000,
  ),
)
let generation = 0
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (
    quantity.value == null ||
    !Number.isSafeInteger(quantity.value) ||
    quantity.value < minQuantity.value
  )
    issues.quantity = `数量不能少于 ${formatAmount(minQuantity.value)} 件`
  if (weight.value == null || !Number.isFinite(weight.value) || weight.value < minWeight.value)
    issues.weight = `重量不能少于 ${formatAmount(minWeight.value)} kg`
  if (!quantity.value && !weight.value) issues.quantity = '数量和重量不能同时为零'
  if (!reason.value.trim()) issues.reason = '请填写修改原因'
  return issues
})
const { formRef, fieldErrors } = validation

async function load() {
  const batchNo = props.transfer?.batch_no
  const epoch = ++generation
  editable.value = false
  snapshot.value = null
  error.value = ''
  validation.reset()
  if (!props.modelValue || !batchNo) return
  loading.value = true
  try {
    const [latest, result] = await Promise.all([
      materialTransferApi.get(batchNo),
      transferAmendmentApi.list(batchNo),
    ])
    if (epoch !== generation) return
    snapshot.value = latest
    quantity.value = latest.quantity
    weight.value = latest.weight
    notes.value = latest.notes || ''
    remainingQuantity.value = result.remaining_quantity
    remainingWeight.value = result.remaining_weight
    editable.value = result.editable && Boolean(latest.version)
    if (!editable.value)
      error.value = result.items.some((item) => item.status === 'pending')
        ? '已有待确认的修改申请，请先处理该申请'
        : '当前单据不能申请修改'
    emit('refreshed', latest)
  } catch (failure) {
    if (epoch === generation)
      error.value = failure instanceof Error ? failure.message : '读取转料单失败，请重试'
  } finally {
    if (epoch === generation) loading.value = false
  }
}
async function submit() {
  const current = snapshot.value
  if (saving.value || loading.value || !editable.value || !current?.version) return
  error.value = ''
  if (!validation.validate()) return
  if (
    quantity.value === current.quantity &&
    weight.value === current.weight &&
    notes.value.trim() === (current.notes || '').trim()
  ) {
    error.value = '请先修改数量、重量或备注'
    return
  }
  const epoch = generation
  saving.value = true
  emit('busy', true)
  try {
    const result = await transferAmendmentApi.create(current.batch_no, {
      expected_version: current.version,
      quantity: quantity.value!,
      weight: weight.value!,
      notes: notes.value.trim() || null,
      reason: reason.value.trim(),
    })
    if (epoch !== generation) return
    emit('submitted', result)
    emit('update:modelValue', false)
  } catch (failure) {
    if (epoch !== generation) return
    error.value = failure instanceof Error ? failure.message : '申请提交失败，请重试'
    if (failure instanceof HttpRequestError && failure.status === 409) {
      editable.value = false
      error.value += '，请重新读取后核对'
    }
  } finally {
    if (epoch === generation) {
      saving.value = false
      emit('busy', false)
    }
  }
}
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
watch(
  [() => props.modelValue, () => props.transfer?.batch_no],
  () => {
    reason.value = ''
    saving.value = false
    emit('busy', false)
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
  emit('busy', false)
})
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    title="申请修改转料单"
    width="min(640px, 94vw)"
    append-to-body
    :show-close="!saving"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    @close="close"
  >
    <StatePanel v-if="loading" state="loading" title="正在核对剩余物料" />
    <template v-else-if="snapshot">
      <p class="amendment-document">{{ snapshot.serial_no }} · {{ snapshot.batch_no }}</p>
      <div class="amendment-balance">
        <span>可调整剩余量</span>
        <strong
          >{{ formatAmount(remainingQuantity) }} 件 / {{ formatAmount(remainingWeight) }} kg</strong
        >
      </div>
      <ElForm
        ref="formRef"
        label-position="top"
        :disabled="saving || !editable"
        :show-message="true"
        @submit.prevent="submit"
      >
        <div class="amendment-amounts">
          <ElFormItem label="修改后数量（件）" required :error="fieldErrors.quantity">
            <ElInputNumber
              v-model="quantity"
              aria-label="修改后数量"
              :min="minQuantity"
              :precision="0"
              :disabled="isWeightOnlyType(snapshot.material_type)"
              controls-position="right"
            />
            <span class="original-value"
              >原数量 {{ formatAmount(snapshot.quantity) }} · 最少
              {{ formatAmount(minQuantity) }}</span
            >
          </ElFormItem>
          <ElFormItem label="修改后重量（kg）" required :error="fieldErrors.weight">
            <ElInputNumber
              v-model="weight"
              aria-label="修改后重量"
              :min="minWeight"
              :precision="6"
              :disabled="snapshot.material_type === 'sludge'"
              :step="0.001"
              controls-position="right"
            />
            <span class="original-value"
              >原重量 {{ formatAmount(snapshot.weight) }} · 最少 {{ formatAmount(minWeight) }}</span
            >
          </ElFormItem>
        </div>
        <ElFormItem label="备注"
          ><ElInput
            v-model="notes"
            aria-label="修改后备注"
            type="textarea"
            :rows="2"
            maxlength="2000"
        /></ElFormItem>
        <ElFormItem label="修改原因" required :error="fieldErrors.reason"
          ><ElInput
            v-model="reason"
            aria-label="修改原因"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="说明需要对方核对的内容"
        /></ElFormItem>
      </ElForm>
      <p class="amendment-help">对方确认后生效，仅调整剩余物料；已加工和已转出的记录保持原样。</p>
    </template>
    <p v-if="error" role="alert" class="amendment-error">{{ error }}</p>
    <ElButton v-if="!loading && !editable" :disabled="saving" @click="load">重新读取</ElButton>
    <template #footer>
      <ElButton :disabled="saving" @click="close">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="loading || !editable" @click="submit"
        >发送确认申请</ElButton
      >
    </template>
  </AppDialog>
</template>

<style scoped>
.amendment-document {
  margin: 0 0 16px;
  color: var(--subtle);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.amendment-balance {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 20px;
  border-radius: 8px;
  background: var(--table-header-bg);
  font-size: 13px;
}
.amendment-balance span {
  color: var(--subtle);
}
.amendment-balance strong {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.amendment-amounts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.amendment-amounts :deep(.el-input-number) {
  width: 100%;
}
.original-value {
  display: block;
  width: 100%;
  color: var(--subtle);
  font-size: 12px;
}
.amendment-help {
  margin: 0;
  font-size: 12px;
  color: var(--subtle);
}
.amendment-error {
  color: var(--danger);
  font-size: 13px;
}
@media (max-width: 480px) {
  .amendment-amounts {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElDialog, ElForm } from 'element-plus'
import MaterialDeliveryFields from './MaterialDeliveryFields.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import { MaterialTransferApiError, materialTransferApi } from '@/services/materialTransferApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
import { deliveryError } from '@/utils/materialDelivery'
const props = defineProps<{ modelValue: boolean; transfer: MaterialTransfer | null }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  saved: [MaterialTransfer]
  refreshed: [MaterialTransfer]
  busy: [boolean]
}>()
const date = ref(''),
  quantity = ref<number>(),
  version = ref(0),
  saving = ref(false),
  error = ref('')
const validation = useDialogValidation(() => {
  const message = deliveryError(date.value, quantity.value)
  return message ? { [!date.value || message.includes('有效的要求发货日期') ? 'date' : 'quantity']: message } : {}
})
const { formRef, fieldErrors } = validation
let generation = 0
function fill(transfer: MaterialTransfer | null) {
  date.value = transfer?.delivery_date || ''
  quantity.value = transfer?.delivery_quantity ?? undefined
  version.value = transfer?.version || 0
}
watch(
  () => [props.modelValue, props.transfer?.batch_no],
  () => {
    ++generation
    saving.value = false
    emit('busy', false)
    error.value = ''
    validation.reset()
    fill(props.transfer)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
  emit('busy', false)
})
async function save() {
  if (saving.value || !props.transfer?.can_edit_delivery || !version.value) return
  error.value = ''
  if (!validation.validate()) return
  const epoch = generation,
    batch = props.transfer.batch_no
  saving.value = true
  emit('busy', true)
  try {
    const result = await materialTransferApi.updateDelivery(batch, {
      delivery_date: date.value || null,
      delivery_quantity: quantity.value ?? null,
      expected_version: version.value,
    })
    if (epoch !== generation) return
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (failure) {
    if (epoch !== generation) return
    error.value = failure instanceof Error ? failure.message : '交期保存失败，请重试'
    if (failure instanceof MaterialTransferApiError && failure.status === 409) {
      try {
        const latest = await materialTransferApi.get(batch)
        if (epoch !== generation) return
        fill(latest)
        emit('refreshed', latest)
        error.value = '单据已更新，已载入最新交期，请核对后再保存'
      } catch {
        if (epoch === generation) {
          version.value = 0
          error.value = '最新单据读取失败，请关闭后重新打开'
        }
      }
    }
  } finally {
    if (epoch === generation) {
      saving.value = false
      emit('busy', false)
    }
  }
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    title="维护本批交期"
    width="min(540px, 94vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="emit('update:modelValue', false)"
  >
    <p class="delivery-document">{{ transfer?.serial_no }} · {{ transfer?.batch_no }}</p>
    <ElForm ref="formRef" label-position="top" :show-message="false" @submit.prevent="save"
      ><MaterialDeliveryFields v-model:date="date" v-model:quantity="quantity" :disabled="saving" :date-error="fieldErrors.date" :quantity-error="fieldErrors.quantity"
    /></ElForm>
    <p v-if="error" role="alert" class="delivery-error">{{ error }}</p>
    <template #footer
      ><ElButton :disabled="saving" @click="emit('update:modelValue', false)">取消</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="!version || !transfer?.can_edit_delivery"
        @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>

<style scoped>
.delivery-document {
  margin: 0 0 20px;
  color: var(--subtle);
  overflow-wrap: anywhere;
}
.delivery-error {
  color: var(--danger);
}
</style>

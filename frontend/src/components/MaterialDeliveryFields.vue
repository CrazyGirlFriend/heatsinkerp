<script setup lang="ts">
import { ElFormItem, ElInput, ElInputNumber } from 'element-plus'
import AutofillBadge from './AutofillBadge.vue'
defineProps<{
  disabled?: boolean
  dateError?: string
  quantityError?: string
  documentSource?: string
  dateState?: '' | 'imported' | 'edited'
  quantityState?: '' | 'imported' | 'edited'
}>()
const date = defineModel<string>('date', { required: true })
const quantity = defineModel<number | undefined>('quantity', { required: true })
</script>

<template>
  <div class="delivery-fields dialog-form-grid dialog-field-wide">
    <ElFormItem
      label="要求发货日期"
      :required="quantity != null"
      :error="dateError"
      data-validation-field="deliveryDate"
      :class="dateState ? `document-field--${dateState}` : ''"
      ><template #label
        >要求发货日期<AutofillBadge
          v-if="dateState"
          :source="documentSource || ''"
          kind="document"
          :modified="dateState === 'edited'" /></template
      ><ElInput
        v-model="date"
        type="date"
        aria-label="要求发货日期"
        min="2000-01-01"
        max="2100-12-31"
        :disabled="disabled"
    /></ElFormItem>
    <ElFormItem
      label="应发成品件数"
      :required="Boolean(date)"
      :error="quantityError"
      data-validation-field="deliveryQuantity"
      :class="quantityState ? `document-field--${quantityState}` : ''"
      ><template #label
        >应发成品件数<AutofillBadge
          v-if="quantityState"
          :source="documentSource || ''"
          kind="document"
          :modified="quantityState === 'edited'" /></template
      ><ElInputNumber
        v-model="quantity"
        aria-label="应发成品件数"
        :min="1"
        :max="2147483647"
        :precision="0"
        controls-position="right"
        :disabled="disabled"
        ><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber
      ></ElFormItem
    >
  </div>
</template>

<style scoped>
.delivery-fields :deep(.el-input-number) {
  width: 100%;
}
</style>

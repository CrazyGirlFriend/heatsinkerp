<script setup lang="ts">
import { ElFormItem, ElInput, ElInputNumber } from 'element-plus'
defineProps<{ disabled?: boolean }>()
const date = defineModel<string>('date', { required: true })
const quantity = defineModel<number | undefined>('quantity', { required: true })
</script>

<template>
  <div class="delivery-fields dialog-form-grid dialog-field-wide">
    <ElFormItem label="要求发货日期" :required="quantity != null"
      ><ElInput
        v-model="date"
        type="date"
        aria-label="要求发货日期"
        min="2000-01-01"
        max="2100-12-31"
        :disabled="disabled"
    /></ElFormItem>
    <ElFormItem label="应发成品件数" :required="Boolean(date)"
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

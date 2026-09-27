<script setup lang="ts">
import { ElFormItem, ElInput, ElInputNumber } from 'element-plus'
defineProps<{ disabled?: boolean }>()
const date = defineModel<string>('date', { required: true })
const quantity = defineModel<number | undefined>('quantity', { required: true })
</script>

<template>
  <div class="delivery-fields">
    <ElFormItem label="要求发货日期"
      ><ElInput
        v-model="date"
        type="date"
        aria-label="要求发货日期"
        min="2000-01-01"
        max="2100-12-31"
        :disabled="disabled"
    /></ElFormItem>
    <ElFormItem label="应发成品件数"
      ><ElInputNumber
        v-model="quantity"
        aria-label="应发成品件数"
        :min="1"
        :max="2147483647"
        :precision="0"
        controls-position="right"
        :disabled="disabled"
    /></ElFormItem>
  </div>
</template>

<style scoped>
.delivery-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 20px;
  grid-column: 1 / -1;
}
.delivery-fields :deep(.el-input-number) {
  width: 100%;
}
@media (max-width: 560px) {
  .delivery-fields {
    grid-template-columns: 1fr;
  }
}
</style>

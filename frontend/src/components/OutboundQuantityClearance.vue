<script setup lang="ts">
import { ElAlert, ElFormItem, ElInput } from 'element-plus'
defineProps<{ batchNo: string; quantity: number; reason: string; disabled?: boolean }>()
defineEmits<{ 'update:reason': [value: string] }>()
</script>

<template>
  <section class="quantity-clearance" aria-label="剩余件数清零">
    <ElAlert type="warning" :closable="false" show-icon :title="`批次 ${batchNo}：重量将全部转出，剩余 ${quantity} 件将清零。`" description="填写原因后随出库一起提交；不增加出库件数，不计为丢失。" />
    <ElFormItem label="剩余件数清零原因" required>
      <ElInput :model-value="reason" :aria-label="`${batchNo}清零原因`" type="textarea" :rows="2" maxlength="2000" show-word-limit :disabled="disabled" placeholder="请说明重量已全部转出，但账面仍有剩余件数的原因" @update:model-value="$emit('update:reason', $event)" />
    </ElFormItem>
  </section>
</template>

<style scoped>
.quantity-clearance { margin: 16px 0; }
.quantity-clearance :deep(.el-alert) { margin-bottom: 12px; }
</style>

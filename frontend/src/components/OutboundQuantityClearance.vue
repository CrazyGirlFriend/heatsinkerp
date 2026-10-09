<script setup lang="ts">
import { ElAlert, ElCheckbox, ElFormItem, ElInput } from 'element-plus'
defineProps<{ batchNo: string; quantity: number; reason: string; enabled: boolean; disabled?: boolean }>()
defineEmits<{ 'update:reason': [value: string]; 'update:enabled': [value: boolean] }>()
</script>

<template>
  <section class="quantity-clearance" aria-label="剩余件数清零">
    <ElAlert type="warning" :closable="false" show-icon :title="`批次 ${batchNo}：重量将全部转出，账面仍有 ${quantity} 件。`" />
    <ElCheckbox :model-value="enabled" :aria-label="`${batchNo}清零剩余件数`" :disabled="disabled" @update:model-value="$emit('update:enabled', Boolean($event))">同时清零剩余 {{ quantity }} 件</ElCheckbox>
    <ElFormItem v-if="enabled" label="剩余件数清零原因（选填）">
      <ElInput :model-value="reason" :aria-label="`${batchNo}清零原因`" type="textarea" :rows="2" maxlength="2000" show-word-limit :disabled="disabled" placeholder="选填：说明本次清零原因" @update:model-value="$emit('update:reason', $event)" />
    </ElFormItem>
  </section>
</template>

<style scoped>
.quantity-clearance { margin: 16px 0; }
.quantity-clearance :deep(.el-alert) { margin-bottom: 12px; }
</style>

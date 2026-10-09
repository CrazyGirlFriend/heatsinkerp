<script setup lang="ts">
import { ElButton } from 'element-plus'
defineProps<{ modelValue: number; total: number; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [page: number] }>()
</script>

<template>
  <nav v-if="total > 1" class="form-page-nav" aria-label="表单分页">
    <span aria-live="polite">{{ modelValue + 1 }} / {{ total }}</span>
    <ElButton
      :disabled="disabled || modelValue === 0"
      @click="emit('update:modelValue', modelValue - 1)"
      >上一页</ElButton
    >
    <ElButton
      :disabled="disabled || modelValue >= total - 1"
      @click="emit('update:modelValue', modelValue + 1)"
      >下一页</ElButton
    >
  </nav>
</template>

<style scoped>
.form-page-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-right: auto;
}
.form-page-nav span {
  min-width: 36px;
  color: var(--subtle);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.form-page-nav .el-button {
  margin-left: 0;
}
@media (max-width: 560px) {
  .form-page-nav {
    width: 100%;
  }
}
</style>

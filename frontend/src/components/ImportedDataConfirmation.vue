<script setup lang="ts">
import { ElCheckbox, ElFormItem } from 'element-plus'
withDefaults(
  defineProps<{ modelValue: boolean; label?: string; error?: string; disabled?: boolean }>(),
  { label: '已核对自动带入的信息' },
)
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <ElFormItem class="imported-data-confirmation" :error="error" :show-message="false">
    <ElCheckbox
      :model-value="modelValue"
      :disabled="disabled"
      aria-label="确认文件带入信息"
      @update:model-value="emit('update:modelValue', Boolean($event))"
      >{{ label }}</ElCheckbox
    >
    <p v-if="error" role="alert">{{ error }}</p>
  </ElFormItem>
</template>

<style scoped>
.imported-data-confirmation {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-soft);
}
.imported-data-confirmation.is-error {
  border-color: var(--danger);
}
.imported-data-confirmation :deep(.el-form-item__content) {
  display: block;
  margin-left: 0 !important;
}
.imported-data-confirmation :deep(.el-checkbox__label) {
  white-space: normal;
  font-size: 12px;
}
.imported-data-confirmation p {
  margin: 4px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 18px;
}
</style>

<script setup lang="ts">
withDefaults(defineProps<{ documents?: boolean }>(), { documents: true })
</script>

<template>
  <div
    class="form-workspace"
    :class="{ 'form-workspace--documents': documents && $slots.documents }"
  >
    <aside
      v-if="documents && $slots.documents"
      class="form-workspace-documents"
      aria-label="关联资料"
    >
      <slot name="documents" />
    </aside>
    <div class="form-workspace-content"><slot /></div>
  </div>
</template>

<style scoped>
.form-workspace {
  --el-component-size: 32px;
  --form-field-gap: 10px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  min-width: 0;
}
.form-workspace--documents {
  grid-template-columns: 180px minmax(0, 1fr);
}
.form-workspace-documents {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.form-workspace-content {
  container: form-fields / inline-size;
  min-width: 0;
}
.form-workspace :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 12px;
}
.form-workspace :deep(.el-form-item__content) {
  min-width: 0;
}
.form-workspace :deep(.el-form-item__label) {
  height: auto;
  min-height: 20px;
  margin-bottom: 4px;
  line-height: 20px;
  font-size: 12px;
  font-weight: 500;
}
.form-workspace :deep(.el-input__wrapper),
.form-workspace :deep(.el-select__wrapper) {
  min-height: 32px;
}
.form-workspace :deep(.el-textarea__inner) {
  font-size: 14px;
  line-height: 1.5;
}
.form-workspace :deep(.el-input-number) {
  width: min(100%, 160px);
}
.form-workspace :deep(.el-date-editor.el-input) {
  max-width: 100%;
}
@media (max-width: 760px) {
  .form-workspace--documents {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
}
</style>

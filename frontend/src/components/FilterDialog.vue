<script setup lang="ts">
import { Filter } from '@element-plus/icons-vue'
import { ElButton, ElDialog } from 'element-plus'
withDefaults(
  defineProps<{ modelValue: boolean; count?: number; title?: string; appendTo?: HTMLElement }>(),
  {
    count: 0,
    title: '筛选条件',
  },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  cancel: []
  apply: []
  reset: []
}>()
function open() {
  emit('open')
  emit('update:modelValue', true)
}
function cancel() {
  emit('cancel')
  emit('update:modelValue', false)
}
</script>
<template>
  <ElButton
    class="filter-dialog-trigger"
    :class="{ 'is-filtered': count > 0 }"
    :icon="Filter"
    :aria-label="title"
    :aria-expanded="modelValue"
    @click="open"
    >筛选<span v-if="count" class="filter-count">{{ count }}</span></ElButton
  >
  <ElDialog
    :model-value="modelValue"
    :title="title"
    width="min(640px, 94vw)"
    class="compact-filter-dialog"
    append-to-body
    :append-to="appendTo || 'body'"
    @update:model-value="!$event && cancel()"
  >
    <div class="filter-dialog-fields"><slot /></div>
    <template #footer
      ><ElButton class="filter-reset" text @click="emit('reset')">重置</ElButton
      ><ElButton @click="cancel">取消</ElButton
      ><ElButton type="primary" @click="emit('apply')">应用筛选</ElButton></template
    >
  </ElDialog>
</template>
<style>
.filter-dialog-trigger.el-button {
  margin: 0;
}
.filter-dialog-trigger.is-filtered {
  color: var(--primary);
  border-color: #bed3c7;
  background: var(--primary-soft);
}
.filter-count {
  margin-left: 7px;
  min-width: 19px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.compact-filter-dialog.el-dialog {
  max-height: calc(100dvh - 2 * min(8dvh, 40px));
  margin-block: min(8dvh, 40px) !important;
  display: flex;
  flex-direction: column;
}
.compact-filter-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
}
.compact-filter-dialog .el-dialog__header,
.compact-filter-dialog .el-dialog__footer {
  flex-shrink: 0;
}
.compact-filter-dialog .el-dialog__footer {
  display: flex;
  gap: 8px;
  align-items: center;
}
.compact-filter-dialog .el-dialog__footer .el-button {
  margin: 0;
}
.compact-filter-dialog .filter-reset {
  margin-right: auto !important;
}
.filter-dialog-fields,
.filter-dialog-fields > .filter-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 20px;
  min-width: 0;
}
.filter-dialog-fields > .filter-fields {
  grid-column: 1 / -1;
}
.filter-dialog-fields label:not(.el-checkbox) {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  color: var(--muted);
  font-size: 13px;
}
.filter-dialog-fields :is(.el-select, .el-input, .el-date-editor, .record-date-trigger) {
  width: 100%;
  min-width: 0;
}
.filter-dialog-fields .record-date-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.filter-dialog-fields .el-checkbox {
  margin: 0;
}
.filter-dialog-fields .el-checkbox__label {
  white-space: normal;
}
.filter-dialog-fields .filter-wide {
  grid-column: 1 / -1;
}
@media (max-width: 560px) {
  .filter-dialog-fields,
  .filter-dialog-fields > .filter-fields {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
}
</style>

<script setup lang="ts">
import { ElTable, type TableProps } from 'element-plus'

defineOptions({ inheritAttrs: false })
defineProps<{ data?: TableProps['data'] }>()
</script>

<template>
  <ElTable
    class="business-table workspace-table"
    :data="data"
    border
    height="100%"
    flexible
    show-overflow-tooltip
    v-bind="$attrs"
  >
    <slot />
    <template v-if="$slots.empty" #empty><slot name="empty" /></template>
    <template v-if="$slots.append" #append><slot name="append" /></template>
  </ElTable>
</template>

<style scoped>
.workspace-table.el-table.business-table {
  --business-table-font: var(--font-size-body);
  --business-table-padding: 7px;
  --el-table-header-bg-color: var(--table-header-bg);
  --el-table-header-text-color: var(--subtle);
  --el-table-text-color: var(--text);
  --el-table-border-color: var(--line);
  --el-table-row-hover-bg-color: var(--table-hover-bg);
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}
.workspace-table.el-table.business-table :deep(.el-table__header-wrapper th.el-table__cell),
.workspace-table.el-table.business-table :deep(.el-table__body .el-table__row > td.el-table__cell) {
  height: 44px;
  padding-block: 7px;
}
.workspace-table.el-table.business-table :deep(.el-table__header-wrapper th.el-table__cell) {
  color: var(--subtle);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-regular);
}
.workspace-table.el-table.business-table :deep(.el-table__cell > .cell) {
  padding-inline: 12px;
  line-height: var(--line-height-body);
}
.workspace-table.el-table.business-table :deep(.el-table__row > .el-table__cell > .cell) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow-wrap: normal;
}
.workspace-table.el-table.business-table :deep(.el-table__header-wrapper .cell) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: var(--line-height-meta);
}
.workspace-table.el-table.business-table :deep(.el-button.is-link) {
  height: auto;
  min-height: 24px;
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
  font-weight: var(--font-weight-regular);
}
.workspace-table.el-table.business-table :deep(.el-button--primary.is-link) {
  color: var(--muted);
}
.workspace-table.el-table.business-table :deep(.el-button--primary.is-link:hover) {
  color: var(--primary);
}
.workspace-table.el-table.business-table :deep(.el-table__body .table-identity .cell),
.workspace-table.el-table.business-table :deep(.el-table__body .table-identity .el-button.is-link),
.workspace-table.el-table.business-table :deep(.el-table__body .table-identity strong) {
  color: var(--text);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  font-weight: var(--font-weight-medium);
  letter-spacing: normal;
}
.workspace-table.el-table.business-table
  :deep(.el-table__body .table-identity .el-button.is-link:hover) {
  color: var(--primary);
}
.workspace-table.el-table.business-table :deep(.el-tag) {
  height: 24px;
  line-height: 22px;
  font-size: var(--font-size-meta);
}
.workspace-table.el-table.business-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}
</style>

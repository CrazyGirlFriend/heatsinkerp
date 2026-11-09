<script setup lang="ts">
// Watermelon DataTable 11's surface, adapted to the existing Vue table engine.
import { ElTable, type TableProps } from 'element-plus'
import AppSkeleton from '../AppSkeleton.vue'

defineOptions({ inheritAttrs: false })
withDefaults(
  defineProps<{
    data?: TableProps['data']
    fill?: boolean
    loading?: boolean
    embedded?: boolean
    rowClassName?: TableProps['rowClassName']
  }>(),
  { fill: false, embedded: false },
)

function handleTableWheel(event: WheelEvent) {
  if (event.ctrlKey || !(event.target instanceof Element)) return
  const table = event.currentTarget as HTMLElement
  if (event.target.closest('.el-table') !== table) return
  const overHeader = event.target.closest('.el-table__header-wrapper, .el-table__footer-wrapper')
  const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
  if (!delta || (!overHeader && !event.shiftKey)) return

  // Element Plus forwards header wheels to body-wrapper, but the scrollbar wrap owns scrolling.
  const wrap = table.querySelector<HTMLElement>('.el-table__body-wrapper .el-scrollbar__wrap')
  if (!wrap || wrap.scrollWidth <= wrap.clientWidth) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? wrap.clientWidth : 1
  event.preventDefault()
  event.stopPropagation()
  wrap.scrollLeft += delta * unit
}
</script>

<template>
  <ElTable
    class="wm-data-table"
    :class="{
      'wm-data-table--fill': fill,
      'wm-data-table--embedded': embedded,
      'is-refreshing': loading && data?.length,
      'is-ready': !loading && data?.length,
    }"
    :data="data"
    :row-class-name="rowClassName"
    :height="fill ? '100%' : undefined"
    :aria-busy="loading"
    :empty-text="loading ? '加载中…' : '暂无数据'"
    flexible
    show-overflow-tooltip
    scrollbar-always-on
    v-bind="$attrs"
    @wheel.capture="handleTableWheel"
  >
    <slot />
    <template #empty
      ><AppSkeleton v-if="loading" /><slot v-else name="empty">暂无数据</slot></template
    >
    <template v-if="$slots.append" #append><slot name="append" /></template>
  </ElTable>
</template>

<style scoped>
.wm-data-table.el-table {
  /* Detail pages may still pass business-table; keep its glass effects out of this skin. */
  --table-glass-header: none;
  --table-glass-hover: none;
  --table-glass-selected-fill: none;
  --table-glass-selected: var(--wm-table-hover, #f4f4f5);
  --table-glass-edge: none;
  --table-glass-hover-edge: none;
  --table-glass-selected-edge: 0 0 0 transparent;
  --el-table-border-color: var(--wm-table-border, #e4e4e7);
  --el-table-header-bg-color: var(--wm-table-header-bg, #fafafa);
  --el-table-header-text-color: var(--wm-table-header-text, #52525b);
  --el-table-text-color: var(--wm-table-text, #18181b);
  --el-table-row-hover-bg-color: var(--wm-table-hover, #f4f4f5);
  --el-table-current-row-bg-color: var(--wm-table-hover, #f4f4f5);
  --el-table-bg-color: var(--wm-table-bg, #fff);
  --el-table-tr-bg-color: var(--wm-table-bg, #fff);
  --el-fill-color-light: var(--wm-table-header-bg, #fafafa);
  min-width: 0;
  border: 1px solid var(--wm-table-border, #e4e4e7);
  border-radius: 12px;
  background: var(--el-table-bg-color);
  color: var(--el-table-text-color);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  box-shadow: none;
}
.wm-data-table--fill {
  flex: 1;
  min-height: 0;
}
.wm-data-table.el-table.wm-data-table--embedded {
  border: 0;
  border-radius: 0;
}
.wm-data-table.el-table::before,
.wm-data-table.el-table::after,
.wm-data-table :deep(.el-table__border-left-patch),
.wm-data-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}
.wm-data-table :deep(.el-table__cell) {
  height: 54px;
  padding: 14px 0;
  border-right: 0;
}
.wm-data-table :deep(th.el-table__cell) {
  height: 48px;
  padding: 12px 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.08em;
  background: var(--el-table-header-bg-color);
  border-bottom-color: var(--el-table-border-color);
}
.wm-data-table :deep(.cell) {
  padding-inline: 14px;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wm-data-table :deep(th.el-table__cell .cell) {
  line-height: 22px;
}
.wm-data-table :deep(td.el-table__cell.is-right .cell) {
  font-weight: 500;
}
.wm-data-table :deep(tbody tr:focus-within > td.el-table__cell) {
  background: var(--el-table-row-hover-bg-color);
}
.wm-data-table :deep(.el-table-fixed-column--left),
.wm-data-table :deep(.el-table-fixed-column--right) {
  background: var(--el-table-tr-bg-color);
}
.wm-data-table :deep(th.el-table-fixed-column--left),
.wm-data-table :deep(th.el-table-fixed-column--right) {
  background: var(--el-table-header-bg-color);
}
.wm-data-table :deep(.el-button.is-link) {
  height: auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-table-text-color);
}
.wm-data-table :deep(.el-button.is-link:hover:not(:disabled)) {
  color: var(--el-table-text-color);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.wm-data-table :deep(.el-button.is-link.is-disabled) {
  color: var(--wm-table-muted, #71717a);
  opacity: 0.6;
}
.wm-data-table :deep(.el-button.wm-table-primary) {
  min-height: 26px;
  padding: 3px 6px;
  margin-inline: -6px;
  border-radius: 4px;
  color: var(--el-table-text-color);
  font-size: 14px;
  font-weight: 500;
}
.wm-data-table :deep(.el-button:focus-visible) {
  outline: 2px solid var(--wm-table-focus, #71717a);
  outline-offset: -2px;
}
.wm-data-table :deep(.el-button.wm-table-action) {
  min-height: 26px;
  padding: 3px 7px;
  border-radius: 5px;
  color: var(--wm-table-header-text, #52525b);
}
.wm-data-table :deep(.el-button.wm-table-action > span) {
  gap: 5px;
}
.wm-data-table :deep(.el-button.wm-table-action:hover:not(:disabled)) {
  background: var(--wm-table-hover, #f4f4f5);
  text-decoration: none;
}
.wm-data-table :deep(.wm-table-selection .cell) {
  display: flex;
  justify-content: center;
  padding-inline: 4px;
  text-overflow: clip;
}
.wm-data-table :deep(.wm-table-selection .el-checkbox) {
  margin: 0;
}
.wm-data-table :deep(.wm-table-muted) {
  color: var(--wm-table-muted, #71717a);
}
</style>

<script setup lang="ts">
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import ColumnManagedTable from './ColumnManagedTable.vue'

// Slot-based tables retain editable cells, column groups and merged document fields.
defineProps<{ fields?: boolean }>()
const themed = useWatermelonAppearance()
</script>

<template>
  <ColumnManagedTable
    native
    :column-settings="!fields"
    class="app-detail-table"
    :class="{ 'app-detail-table--themed': themed, 'app-detail-table--fields': fields }"
  >
    <slot />
  </ColumnManagedTable>
</template>

<style scoped>
@media screen {
  .app-detail-table.app-detail-table--themed {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid var(--wm-border);
    background: var(--wm-bg);
    color: var(--wm-text);
    font-size: 14px;
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
  }
  .app-detail-table.app-detail-table--themed :deep(tr) {
    background: transparent;
  }
  .app-detail-table.app-detail-table--themed :deep(th),
  .app-detail-table.app-detail-table--themed :deep(td) {
    padding: 10px 14px;
    border: 0;
    border-bottom: 1px solid var(--wm-table-divider);
    vertical-align: middle;
  }
  .app-detail-table.app-detail-table--themed :deep(th) {
    background: var(--wm-muted-surface);
    color: var(--wm-muted);
    font-weight: 500;
  }
  .app-detail-table.app-detail-table--themed :deep(tbody tr) {
    transition: background-color 140ms ease;
  }
  .app-detail-table.app-detail-table--themed :deep(tbody tr:hover) {
    background: var(--wm-hover);
  }
  .app-detail-table--themed.app-detail-table--fields :deep(th),
  .app-detail-table--themed.app-detail-table--fields :deep(td) {
    border: 1px solid var(--wm-table-divider);
    vertical-align: top;
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-detail-table :deep(tbody tr) {
    transition: none;
  }
}
</style>

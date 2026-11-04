<script setup lang="ts">
import ElSelect from '@/components/AppSelect.vue'
import { computed } from 'vue'
import { ElOption, ElPagination } from 'element-plus'
import WatermelonPagination from './watermelon/WatermelonPagination.vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const watermelon = useWatermelonAppearance()

const props = withDefaults(
  defineProps<{
    currentPage: number
    pageSize: number
    total: number
    disabled?: boolean
    pageSizes?: number[]
    layout?: string
  }>(),
  { pageSizes: () => [10, 20, 50, 100], layout: 'sizes, prev, pager, next' },
)
const emit = defineEmits<{
  'update:currentPage': [page: number]
  'update:pageSize': [size: number]
  'current-change': [page: number]
  'size-change': [size: number]
  change: [page: number, size: number]
}>()
function changePage(page: number) {
  emit('update:currentPage', page)
  notifyPageChange(page)
}
function notifyPageChange(page: number) {
  emit('current-change', page)
  emit('change', page, props.pageSize)
}
function changeSize(size: number) {
  emit('update:pageSize', size)
  emit('size-change', size)
  const page = Math.min(props.currentPage, Math.max(1, Math.ceil(props.total / size)))
  if (page !== props.currentPage) {
    emit('update:currentPage', page)
  }
  emit('change', page, size)
}
// The built-in size select updates ahead of its pageSize prop during URL navigation.
const paginationLayout = computed(() => props.layout.replace('sizes', 'slot'))
</script>

<template>
  <WatermelonPagination
    v-if="watermelon"
    class="workspace-pagination--watermelon"
    :current-page="currentPage"
    :page-size="pageSize"
    :page-sizes="pageSizes"
    :show-size="layout.includes('sizes')"
    :total="total"
    :disabled="disabled"
    @current-change="changePage"
    @size-change="changeSize"
  >
    <template v-if="$slots.default" #default><slot /></template>
    <template v-if="$slots.statistics" #statistics><slot name="statistics" /></template>
  </WatermelonPagination>
  <footer v-else class="workspace-pagination">
    <div v-if="$slots.statistics" class="workspace-pagination__statistics">
      <slot name="statistics" />
    </div>
    <span class="workspace-pagination__summary"
      ><slot>共 {{ total }} 条记录</slot></span
    >
    <ElPagination
      background
      :current-page="currentPage"
      :page-size="pageSize"
      :page-sizes="pageSizes"
      :total="total"
      :disabled="disabled"
      :layout="paginationLayout"
      @update:current-page="emit('update:currentPage', $event)"
      @update:page-size="emit('update:pageSize', $event)"
      @current-change="notifyPageChange"
      @size-change="changeSize"
    >
      <span v-if="layout.includes('sizes')" class="el-pagination__sizes">
        <ElSelect
          :model-value="pageSize"
          :disabled="disabled"
          aria-label="每页条数"
          @change="changeSize"
        >
          <ElOption v-for="size in pageSizes" :key="size" :value="size" :label="`${size}条/页`" />
        </ElSelect>
      </span>
    </ElPagination>
  </footer>
</template>

<style scoped>
.workspace-pagination {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  min-height: 48px;
  margin-top: auto;
  padding: 10px 0 0;
  border: 0;
  background: transparent;
  color: var(--subtle);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
}
.workspace-pagination__summary {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.workspace-pagination__statistics {
  flex-basis: 100%;
  min-width: 0;
}
.workspace-pagination :deep(.el-pagination) {
  --el-pagination-button-bg-color: transparent;
  --el-pagination-font-size: 12px;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}
.workspace-pagination :deep(.el-pager li) {
  border-radius: 8px;
  font-size: 12px;
}
.workspace-pagination :deep(.el-pager li.is-active) {
  color: var(--primary);
  background: var(--primary-soft);
}
.workspace-pagination :deep(.el-select__wrapper) {
  min-height: 32px;
  border-radius: 9px;
  font-size: 12px;
}
</style>

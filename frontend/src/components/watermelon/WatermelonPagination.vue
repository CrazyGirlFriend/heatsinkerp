<script setup lang="ts">
// Vue adaptation of the Watermelon DataTable 11 pagination footer. See NOTICE.md.
import { computed, useId } from 'vue'
import { motion, useReducedMotion } from 'motion-v'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-vue'
import AppSelect from '../AppSelect.vue'
import { ElOption } from 'element-plus'
const props = withDefaults(
  defineProps<{
    currentPage: number
    pageSize: number
    total: number
    disabled?: boolean
    label?: string
    pageSizes?: number[]
    showSize?: boolean
  }>(),
  { label: '分页', pageSizes: () => [10, 20, 50, 100], showSize: true },
)
const emit = defineEmits<{
  'current-change': [value: number]
  'size-change': [value: number]
}>()
function resize(selected: unknown) {
  const value = Number(selected)
  if (!props.disabled && props.pageSizes.includes(value) && value !== props.pageSize)
    emit('size-change', value)
}
const count = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const pages = computed(() => {
  const start = Math.max(1, Math.min(props.currentPage - 2, count.value - 4))
  return Array.from({ length: Math.min(count.value, 5) }, (_, i) => start + i)
})
const reduced = useReducedMotion()
const id = useId()
function change(value: number) {
  if (!props.disabled && value >= 1 && value <= count.value && value !== props.currentPage)
    emit('current-change', value)
}
</script>

<template>
  <footer class="wm-pagination">
    <div v-if="$slots.statistics" class="wm-pagination-statistics"><slot name="statistics" /></div>
    <span class="wm-pagination-summary" aria-live="polite">
      <slot>共 {{ total }} 条</slot>
      <span>第 {{ currentPage }} / {{ count }} 页</span>
    </span>
    <nav :aria-label="label">
      <button
        type="button"
        class="wm-page-arrow"
        aria-label="上一页"
        :disabled="disabled || currentPage <= 1"
        @click="change(currentPage - 1)"
      >
        <IconChevronLeft :size="17" />
      </button>
      <span v-if="pages[0] > 1" class="wm-page-ellipsis" aria-hidden="true">…</span>
      <motion.button
        v-for="value in pages"
        :key="value"
        type="button"
        :aria-label="`第 ${value} 页`"
        :aria-current="currentPage === value ? 'page' : undefined"
        :disabled="disabled"
        :while-press="reduced || disabled ? {} : { scale: 0.94 }"
        @click="change(value)"
      >
        <motion.span
          v-if="currentPage === value"
          class="wm-page-active"
          :layout-id="`${id}-active`"
          :transition="
            reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 24, mass: 0.8 }
          "
        />
        <span class="wm-page-number">{{ value }}</span>
      </motion.button>
      <span v-if="pages[pages.length - 1] < count" class="wm-page-ellipsis" aria-hidden="true"
        >…</span
      >
      <button
        type="button"
        class="wm-page-arrow"
        aria-label="下一页"
        :disabled="disabled || currentPage >= count"
        @click="change(currentPage + 1)"
      >
        <IconChevronRight :size="17" />
      </button>
    </nav>
    <div v-if="showSize" class="wm-page-size-area">
      <AppSelect
        class="wm-page-size-select"
        aria-label="每页条数"
        :model-value="pageSize"
        :disabled="disabled"
        @change="resize"
      >
        <ElOption v-for="size in pageSizes" :key="size" :value="size" :label="`${size} 条/页`" />
      </AppSelect>
    </div>
  </footer>
</template>

<style>
.wm-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 0 0;
  border-top: 1px solid var(--wm-control-border, #e4e4e7);
  color: var(--wm-text-muted, #52525b);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.wm-pagination-summary {
  display: flex;
  flex: 1 1 180px;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
}
.wm-pagination-statistics {
  flex-basis: 100%;
  min-width: 0;
}
.wm-pagination-summary > span {
  color: var(--wm-text, #18181b);
}
.wm-pagination nav {
  display: flex;
  gap: 4px;
  align-items: center;
}
.wm-page-size-area {
  display: flex;
  flex: 1 1 180px;
  justify-content: flex-end;
}
.wm-pagination button {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--wm-control-text, #27272a);
  font: inherit;
  cursor: pointer;
}
.wm-pagination .wm-page-arrow {
  border-color: var(--wm-control-border, #e4e4e7);
  background: var(--wm-control-bg, #fff);
}
.wm-pagination button[aria-current] {
  color: var(--wm-control-text, #27272a);
  font-weight: 600;
}
.wm-pagination button:hover:not(:disabled):not([aria-current]) {
  background: var(--wm-control-hover-bg, #f4f4f5);
}
.wm-pagination button:disabled {
  opacity: 0.4;
  cursor: default;
}
.wm-page-active {
  position: absolute;
  inset: -1px;
  border: 1px solid var(--wm-control-border, #e4e4e7);
  background: var(--wm-control-bg, #fff);
  border-radius: inherit;
}
.wm-page-ellipsis {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
}
.wm-page-number {
  position: relative;
  z-index: 1;
}
.wm-pagination button:focus-visible {
  outline: 2px solid var(--wm-focus-ring, #71717a);
  outline-offset: 3px;
}
@media (max-width: 700px) {
  .wm-pagination {
    flex-direction: column;
  }
  .wm-pagination-summary,
  .wm-page-size-area {
    flex: 0 0 auto;
  }
}
</style>

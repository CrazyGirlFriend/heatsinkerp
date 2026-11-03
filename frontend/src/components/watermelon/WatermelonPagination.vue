<script setup lang="ts">
// Vue adaptation of Watermelon Continuous Pagination. See NOTICE.md.
import { computed, useId } from 'vue'
import { motion, useReducedMotion } from 'motion-v'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-vue'
const props = withDefaults(
  defineProps<{
    currentPage: number
    pageSize: number
    total: number
    disabled?: boolean
    label?: string
  }>(),
  { label: '分页' },
)
const emit = defineEmits<{ 'current-change': [value: number] }>()
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
    <span><slot /></span>
    <nav :aria-label="label">
      <button
        type="button"
        aria-label="上一页"
        :disabled="disabled || currentPage <= 1"
        @click="change(currentPage - 1)"
      >
        <IconChevronLeft :size="17" />
      </button>
      <motion.button
        v-for="value in pages"
        :key="value"
        type="button"
        :aria-label="`第 ${value} 页`"
        :aria-current="currentPage === value ? 'page' : undefined"
        :disabled="disabled"
        :while-hover="reduced || disabled ? {} : { y: -2 }"
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
      <button
        type="button"
        aria-label="下一页"
        :disabled="disabled || currentPage >= count"
        @click="change(currentPage + 1)"
      >
        <IconChevronRight :size="17" />
      </button>
    </nav>
  </footer>
</template>

<style>
.wm-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px;
  border-top: 1px solid #e9e9ee;
  color: #7e7d85;
  font-size: 12px;
  flex: 0 0 auto;
}
.wm-pagination nav {
  display: flex;
  gap: 6px;
}
.wm-pagination button {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid #e3e3e8;
  border-radius: 9px;
  background: #fff;
  color: #74737b;
  font: inherit;
  cursor: pointer;
}
.wm-pagination button[aria-current] {
  color: #fff;
  border-color: #222;
}
.wm-pagination button:disabled {
  opacity: 0.4;
  cursor: default;
}
.wm-page-active {
  position: absolute;
  inset: -1px;
  background: #222;
  border-radius: inherit;
  box-shadow: 0 3px 6px #0002;
}
.wm-page-number {
  position: relative;
  z-index: 1;
}
.wm-pagination button:focus-visible {
  outline: 2px solid #328369;
  outline-offset: 3px;
}
</style>

<script setup lang="ts">
import { motion, useReducedMotion } from 'motion-v'
import { IconLoader2 } from '@tabler/icons-vue'
const props = defineProps<{ primary?: boolean; loading?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const reduced = useReducedMotion()
function click(event: MouseEvent) {
  if (!props.disabled && !props.loading) emit('click', event)
}
</script>

<template>
  <motion.button
    type="button"
    class="wm-button"
    :class="{ 'wm-button-primary': primary }"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :while-press="reduced || disabled || loading ? {} : { scale: 0.96 }"
    :transition="{ type: 'spring', stiffness: 400, damping: 25 }"
    @click="click"
  >
    <span class="wm-button-label"><slot /></span>
    <span class="wm-button-progress" aria-hidden="true">
      <IconLoader2 v-if="loading" :size="16" class="wm-button-spinner" />
    </span>
  </motion.button>
</template>

<style>
.wm-button {
  display: inline-grid;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--wm-control-border, #e4e4e7);
  border-radius: 8px;
  background: var(--wm-control-bg, #fff);
  color: var(--wm-control-text, #27272a);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 150ms;
}
.wm-button:hover:not(:disabled) {
  background: var(--wm-control-hover-bg, #f4f4f5);
}
.wm-button-primary {
  background: var(--wm-primary-bg, #18181b);
  border-color: var(--wm-primary-border, #18181b);
  color: var(--wm-primary-text, #fff);
}
.wm-button-primary:hover:not(:disabled) {
  background: var(--wm-primary-hover-bg, #3f3f46);
}
.wm-button:disabled:not([aria-busy='true']) {
  opacity: 0.45;
  cursor: not-allowed;
}
.wm-button-label,
.wm-button-progress {
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
.wm-button-progress {
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
}
.wm-button[aria-busy='true'] {
  cursor: progress;
}
.wm-button[aria-busy='true'] .wm-button-label {
  opacity: 0;
  transform: translateY(-4px);
}
.wm-button[aria-busy='true'] .wm-button-progress {
  opacity: 1;
  transform: none;
}
.wm-button:focus-visible {
  outline: 2px solid var(--wm-focus-ring, #71717a);
  outline-offset: 3px;
}
.wm-button-spinner {
  animation: wm-button-spin 0.8s linear infinite;
}
@keyframes wm-button-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .wm-button-label,
  .wm-button-progress {
    transition: none;
    transform: none !important;
  }
  .wm-button-spinner {
    animation: none;
  }
}
</style>

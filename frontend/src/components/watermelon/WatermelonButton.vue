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
    <IconLoader2 v-if="loading" :size="16" class="wm-button-spinner" />
    <slot />
  </motion.button>
</template>

<style>
.wm-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 36px;
  padding: 0 15px;
  border: 1px solid #e2e2e6;
  border-radius: 18px;
  background: #f5f5f7;
  color: #131313;
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 150ms;
}
.wm-button:hover:not(:disabled) {
  background: #ececef;
}
.wm-button-primary {
  background: #111;
  border-color: #111;
  color: #fff;
  box-shadow: 0 3px 6px #00000012;
}
.wm-button-primary:hover:not(:disabled) {
  background: #303030;
}
.wm-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wm-button:focus-visible {
  outline: 2px solid #318468;
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
  .wm-button-spinner {
    animation: none;
  }
}
</style>

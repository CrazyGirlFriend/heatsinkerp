<script setup lang="ts">
// Inline Toast's feedback transition, adapted to persistent form errors and API messages.
import { motion, useReducedMotion } from 'motion-v'
import { IconCircleCheck, IconAlertCircle, IconInfoCircle } from '@tabler/icons-vue'
withDefaults(defineProps<{ message: string; tone?: 'success' | 'error' | 'info' }>(), {
  tone: 'info',
})
const reduced = useReducedMotion()
</script>
<template>
  <motion.div
    class="wm-notice"
    :class="`wm-notice--${tone}`"
    :initial="reduced ? false : { opacity: 0, y: 5, scale: 0.98 }"
    :animate="{ opacity: 1, y: 0, scale: 1 }"
    :transition="reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 24 }"
  >
    <component
      :is="
        tone === 'error' ? IconAlertCircle : tone === 'success' ? IconCircleCheck : IconInfoCircle
      "
      :size="19"
      class="wm-notice-icon"
      aria-hidden="true"
    />
    <span>{{ message }}</span
    ><slot />
  </motion.div>
</template>
<style>
.wm-notice {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 14px;
  border: 1px solid var(--wm-border);
  border-radius: 12px;
  background: var(--wm-muted-surface);
  color: var(--wm-text);
  font-size: 13px;
  line-height: 1.5;
}
.wm-notice-icon {
  flex-shrink: 0;
  color: var(--wm-info-text);
}
.wm-notice--error {
  background: var(--wm-danger-bg);
  border-color: color-mix(in srgb, var(--wm-danger-text) 24%, var(--wm-bg));
}
.wm-notice--error .wm-notice-icon {
  color: var(--wm-danger-text);
}
.wm-notice--success .wm-notice-icon {
  color: var(--wm-success-text);
}
.wm-notice > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>

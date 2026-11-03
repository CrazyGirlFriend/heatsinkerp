<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'info' | 'danger' }>(), {
  tone: 'neutral',
})
</script>

<template>
  <span class="wm-badge" :class="`wm-badge--${tone}`"><slot /></span>
</template>

<style scoped>
.wm-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--wm-neutral-bg, #f4f4f5);
  color: var(--wm-neutral-text, #71717a);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.wm-badge--success {
  background: var(--wm-success-bg, #edf8f1);
  color: var(--wm-success-text, #267348);
}
.wm-badge--warning {
  background: var(--wm-warning-bg, #fff8e5);
  color: var(--wm-warning-text, #926319);
}
.wm-badge--info {
  background: var(--wm-info-bg, #eff6ff);
  color: var(--wm-info-text, #356d9f);
}
.wm-badge--danger {
  background: var(--wm-danger-bg, #fef2f2);
  color: var(--wm-danger-text, #c43d47);
}
</style>

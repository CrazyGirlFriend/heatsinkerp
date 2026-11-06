<script setup lang="ts">
import type { Component } from 'vue'
import AnimatedMetric from './AnimatedMetric.vue'
import StatisticHelp from './StatisticHelp.vue'
defineProps<{
  label: string
  value: number | null
  unit: string
  detail: string
  icon: Component
  tone?: 'info' | 'warning' | 'danger' | 'success'
  help: string
  motion: boolean
  precision?: number
}>()
defineEmits<{ open: [] }>()
</script>
<template>
  <article class="dashboard-metric" :class="`dashboard-metric--${tone || 'info'}`">
    <div class="dashboard-metric__heading">
      <component :is="icon" :size="18" /><span>{{ label }}</span
      ><StatisticHelp :label="`${label}统计说明`">{{ help }}</StatisticHelp>
    </div>
    <button
      class="dashboard-metric__value"
      type="button"
      :aria-label="`查看${label}`"
      @click="$emit('open')"
    >
      <strong
        ><AnimatedMetric :value="value" :animate="motion" :precision="precision ?? 0" /></strong
      ><span>{{ unit }}</span>
    </button>
    <p>{{ detail }}</p>
  </article>
</template>
<style scoped>
.dashboard-metric {
  min-width: 0;
  padding: 15px 20px;
  border: 1px solid var(--wm-border);
  border-radius: 14px;
  background: var(--wm-bg);
}
.dashboard-metric__heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--wm-muted);
  font-size: 13px;
}
.dashboard-metric__heading > svg {
  color: var(--wm-info-text);
}
.dashboard-metric--danger .dashboard-metric__heading > svg {
  color: var(--wm-danger-text);
}
.dashboard-metric--warning .dashboard-metric__heading > svg {
  color: var(--wm-warning-text);
}
.dashboard-metric--success .dashboard-metric__heading > svg {
  color: var(--wm-success-text);
}
.dashboard-metric__heading :deep(.statistic-help) {
  margin-left: auto;
}
.dashboard-metric__value {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border: 0;
  padding: 4px 0;
  background: transparent;
  color: var(--wm-text);
  cursor: pointer;
}
.dashboard-metric__value:hover strong {
  text-decoration: underline;
  text-underline-offset: 5px;
}
.dashboard-metric strong {
  font-size: clamp(24px, 2.3vw, 32px);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  letter-spacing: -1px;
}
.dashboard-metric__value > span,
.dashboard-metric p {
  color: var(--wm-muted);
  font-size: 12px;
}
.dashboard-metric p {
  margin: 2px 0 0;
}
</style>

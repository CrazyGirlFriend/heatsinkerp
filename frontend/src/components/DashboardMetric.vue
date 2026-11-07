<script setup lang="ts">
import { computed, type Component } from 'vue'
import AnimatedMetric from './AnimatedMetric.vue'
import StatisticHelp from './StatisticHelp.vue'
const props = defineProps<{
  label: string
  value: number | null
  unit: string
  detail?: string
  icon?: Component
  tone?: 'info' | 'warning' | 'danger' | 'success'
  help?: string
  static?: boolean
  motion: boolean
  precision?: number
  trend?: number[]
  trendColor?: string
}>()
defineEmits<{ open: [] }>()
const sparkline = computed(() => {
  if (!props.trend || props.trend.length < 2) return ''
  const min = Math.min(0, ...props.trend),
    max = Math.max(1, ...props.trend)
  return props.trend
    .map(
      (value, index) =>
        `${2 + (index / (props.trend!.length - 1)) * 92},${34 - ((value - min) / (max - min)) * 30}`,
    )
    .join(' ')
})
</script>
<template>
  <article class="dashboard-metric" :class="`dashboard-metric--${tone || 'info'}`">
    <div class="dashboard-metric__heading">
      <component :is="icon" v-if="icon" :size="18" /><span>{{ label }}</span
      ><StatisticHelp v-if="help" :label="`${label}统计说明`">{{ help }}</StatisticHelp>
    </div>
    <div class="dashboard-metric__reading">
      <component
        :is="static ? 'div' : 'button'"
        class="dashboard-metric__value"
        :type="static ? undefined : 'button'"
        :aria-label="static ? label : `查看${label}`"
        @click="!static && $emit('open')"
      >
        <strong
          ><AnimatedMetric :value="value" :animate="motion" :precision="precision ?? 0" /></strong
        ><span>{{ unit }}</span>
      </component>
      <svg
        v-if="sparkline"
        class="dashboard-metric__spark"
        :class="{ 'is-animated': motion }"
        viewBox="0 0 96 38"
        aria-hidden="true"
        :style="{ color: trendColor || '#6285ed' }"
      >
        <polygon :points="`2,37 ${sparkline} 94,37`" fill="currentColor" opacity="0.1" />
        <polyline
          :points="sparkline"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    <p v-if="detail">{{ detail }}</p>
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
  flex-shrink: 0;
  white-space: nowrap;
  gap: 8px;
  border: 0;
  padding: 4px 0;
  background: transparent;
  color: var(--wm-text);
  cursor: pointer;
}
.dashboard-metric__reading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dashboard-metric__spark {
  width: 72px;
  min-width: 24px;
  max-width: 28%;
  flex-shrink: 1;
  overflow: visible;
}
.dashboard-metric__spark.is-animated {
  animation: metric-trend-enter 700ms ease-out;
}
@keyframes metric-trend-enter {
  from {
    clip-path: inset(0 100% 0 0);
    opacity: 0;
  }
  to {
    clip-path: inset(0);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dashboard-metric__spark.is-animated {
    animation: none;
  }
}
button.dashboard-metric__value:hover strong {
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
div.dashboard-metric__value {
  cursor: default;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { formatAmount } from '@/utils/format'

const props = defineProps<{
  rows: { key: string; label: string; value: number; color: string }[]
  unit: string
  label: string
  selectable?: boolean
  motion: boolean
}>()
defineEmits<{ select: [key: string] }>()
// Negative corrections remain visible in the legend, but cannot form a share of stock.
const total = computed(() => props.rows.reduce((sum, row) => sum + Math.max(0, row.value), 0))
const hasCorrection = computed(() => props.rows.some((row) => row.value < 0))
const share = (value: number) => (total.value ? (Math.max(0, value) / total.value) * 100 : 0)
</script>

<template>
  <div class="dashboard-distribution" :class="{ 'is-animated': motion }" :aria-label="label">
    <div class="distribution-total">
      <strong>{{ formatAmount(rows.reduce((sum, row) => sum + row.value, 0)) }}</strong>
      <span>{{ unit }}</span>
    </div>
    <div class="distribution-track" aria-hidden="true">
      <i
        v-for="row in rows"
        :key="row.key"
        :style="{ width: `${share(row.value)}%`, backgroundColor: row.color }"
      />
    </div>
    <div class="distribution-legend">
      <component
        :is="selectable ? 'button' : 'div'"
        v-for="row in rows"
        :key="row.key"
        :type="selectable ? 'button' : undefined"
        class="distribution-row"
        :class="{ 'has-correction': row.value < 0 }"
        @click="selectable && $emit('select', row.key)"
      >
        <i :style="{ background: row.color }" aria-hidden="true" />
        <span class="distribution-label">{{ row.label }}</span>
        <strong
          >{{ formatAmount(row.value) }} <small>{{ unit }}</small></strong
        >
        <span class="distribution-share">{{
          row.value < 0
            ? '数据差异'
            : hasCorrection || !total
              ? '—'
              : `${share(row.value).toFixed(1)}%`
        }}</span>
      </component>
    </div>
    <p v-if="!rows.length">暂无数据</p>
  </div>
</template>

<style scoped>
.dashboard-distribution {
  width: 100%;
  min-width: 0;
}
.distribution-total {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 8px 0 16px;
}
.distribution-total strong {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.8px;
  font-variant-numeric: tabular-nums;
  color: var(--wm-text);
}
.distribution-total > span,
p {
  color: var(--wm-muted);
  font-size: 12px;
}
.distribution-track {
  display: flex;
  height: 24px;
  gap: 3px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--wm-hover);
}
.distribution-track i {
  height: 100%;
  min-width: 0;
  background-image: repeating-linear-gradient(
    135deg,
    transparent,
    transparent 5px,
    #ffffff18 5px,
    #ffffff18 7px
  );
}
.is-animated .distribution-track i {
  transition: width 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
.is-animated .distribution-track {
  animation: distribution-reveal 650ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: left;
}
.distribution-legend {
  margin-top: 16px;
}
.distribution-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--wm-table-divider);
  background: transparent;
  color: var(--wm-text);
  font-size: 13px;
  text-align: left;
}
.distribution-row:last-child {
  border-bottom: 0;
}
button.distribution-row {
  cursor: pointer;
}
button.distribution-row:hover .distribution-label {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.distribution-row > i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
  flex-shrink: 0;
}
.distribution-label {
  flex: 1;
}
.distribution-row strong {
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.distribution-row small {
  font-size: 11px;
  font-weight: 400;
  color: var(--wm-muted);
}
.distribution-share {
  width: 60px;
  text-align: right;
  font-size: 12px;
  color: var(--wm-muted);
  font-variant-numeric: tabular-nums;
}
.has-correction strong,
.has-correction .distribution-share {
  color: var(--wm-danger-text);
}
@keyframes distribution-reveal {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-animated .distribution-track,
  .is-animated .distribution-track i {
    animation: none;
    transition: none;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import LedgerChart from './LedgerChart.vue'
import { useDashboardChart } from '@/composables/useDashboardChart'
import { formatAmount } from '@/utils/format'

const props = defineProps<{
  rows: { key: string; label: string; value: number; color: string }[]
  unit: string
  label: string
  motion?: boolean
  selectable?: boolean
}>()
const emit = defineEmits<{ select: [key: string] }>()
const { palette, tooltip } = useDashboardChart()
const total = computed(() => props.rows.reduce((sum, row) => sum + row.value, 0))
const correction = computed(() => props.rows.some((row) => row.value < 0))
const option = computed(() => ({
  tooltip: {
    ...tooltip.value,
    trigger: 'item',
    formatter: (item: { name: string; value: number }) =>
      `${item.name}：${formatAmount(item.value)} ${props.unit}`,
  },
  series: [
    {
      type: 'pie',
      radius: ['76%', '94%'],
      center: ['50%', '50%'],
      label: { show: false },
      emphasis: { scaleSize: props.selectable ? 4 : 0 },
      itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: palette.value?.surface || '#fff' },
      data:
        total.value > 0 && !correction.value
          ? props.rows.map((row) => ({
              name: row.label,
              value: row.value,
              itemStyle: { color: row.color },
            }))
          : [
              {
                value: 1,
                itemStyle: { color: palette.value?.border || '#e4e4e7' },
                tooltip: { show: false },
                emphasis: { disabled: true },
              },
            ],
    },
  ],
}))
function select(index: number) {
  if (props.selectable && total.value > 0 && !correction.value && props.rows[index])
    emit('select', props.rows[index]!.key)
}
</script>

<template>
  <div class="dashboard-donut" :aria-label="label">
    <div class="donut-graphic">
      <LedgerChart
        :option="option"
        :label="label"
        :motion="motion"
        smooth-update
        :enter-duration="700"
        :update-duration="400"
        @select="select($event.dataIndex)"
      />
      <div class="donut-center">
        <strong>{{ formatAmount(total) }}</strong
        ><span>{{ correction ? '数据差异' : total ? unit : '暂无数据' }}</span>
      </div>
    </div>
    <div class="donut-legend">
      <component
        :is="selectable ? 'button' : 'div'"
        v-for="row in rows"
        :key="row.key"
        :type="selectable ? 'button' : undefined"
        class="donut-row"
        @click="selectable && emit('select', row.key)"
      >
        <i :style="{ background: row.color }" aria-hidden="true" />
        <span>{{ row.label }}</span
        ><strong
          >{{ formatAmount(row.value) }} <small>{{ unit }}</small></strong
        >
      </component>
      <p v-if="!rows.length">暂无数据</p>
    </div>
  </div>
</template>

<style scoped>
.dashboard-donut {
  container-type: inline-size;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  min-height: 220px;
  padding-top: 10px;
}
.donut-graphic {
  --donut-size: clamp(160px, 38cqw, 280px);
  position: relative;
  width: var(--donut-size);
  height: var(--donut-size);
  flex: 0 0 var(--donut-size);
  margin: 0 auto;
}
.donut-graphic :deep(.ledger-chart-frame) {
  height: 100%;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}
.donut-center strong {
  font-size: clamp(25px, 4.5cqw, 32px);
  letter-spacing: -0.6px;
  font-weight: 600;
  color: var(--wm-text);
  font-variant-numeric: tabular-nums;
}
.donut-center span,
.donut-legend p {
  font-size: 12px;
  color: var(--wm-muted);
}
.donut-legend {
  flex: 1;
  min-width: 150px;
}
.donut-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--wm-table-divider);
  background: transparent;
  text-align: left;
  color: var(--wm-text);
  font-size: 12px;
}
.donut-row:last-child {
  border-bottom: 0;
}
.donut-row i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.donut-row > span {
  flex: 1;
}
.donut-row strong {
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.donut-row small {
  font-weight: 400;
  color: var(--wm-muted);
}
button.donut-row {
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 160ms;
}
button.donut-row:hover,
button.donut-row:focus-visible {
  background: var(--wm-hover);
}
@media (prefers-reduced-motion: reduce) {
  button.donut-row {
    transition: none;
  }
}
</style>

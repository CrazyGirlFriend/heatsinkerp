<script setup lang="ts">
import { computed } from 'vue'
import LedgerChart from './LedgerChart.vue'
import { dashboardBar, dashboardColors, useDashboardChart } from '@/composables/useDashboardChart'
import { formatAmount } from '@/utils/format'
import type { FactoryPerformance } from '@/types/factoryPerformance'
import type { Metric } from '@/types/materialAnalytics'

const props = defineProps<{
  rows: NonNullable<FactoryPerformance['activity']>['teams']
  metric: Metric
  motion: boolean
}>()
const emit = defineEmits<{ select: [teamId: number] }>()
const { plot, palette } = useDashboardChart()
const unit = computed(() => (props.metric === 'quantity' ? '件次' : 'kg'))
const option = computed(() => {
  const chart = plot(
    props.rows.map((row) => row.team_name),
    (
      [
        ['正常加工', 'completed', dashboardColors.primary],
        ['返工', 'rework', dashboardColors.warning],
      ] as const
    ).map(([name, key, color]) => ({
      ...dashboardBar(
        name,
        props.rows.map((row) => row[`${key}_${props.metric}`]),
        color,
      ),
      label: {
        show: true,
        position: 'right',
        color: palette.value?.text,
        fontSize: 12,
        formatter: ({ value }: { value: number }) => formatAmount(value),
      },
    })),
    unit.value,
    true,
  )
  return { ...chart, grid: { ...(chart.grid as object), right: 76 } }
})
function select(index: number) {
  const row = props.rows[index]
  if (row) emit('select', row.team_id)
}
</script>

<template>
  <LedgerChart
    class="team-production-chart"
    :style="{ height: `${Math.max(240, Math.min(rows.length, 8) * 52 + 60)}px` }"
    :option="option"
    :empty="!rows.length"
    :label="`各班组加工完成量，单位${unit}`"
    :motion="motion"
    smooth-update
    :enter-duration="800"
    :update-duration="400"
    @select="select($event.dataIndex)"
  />
</template>

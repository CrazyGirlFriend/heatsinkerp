<script setup lang="ts">
import { computed } from 'vue'
import LedgerChart from './LedgerChart.vue'
import StatePanel from './StatePanel.vue'
import DashboardCard from './DashboardCard.vue'
import TeamProductionChart from './TeamProductionChart.vue'
import {
  useDashboardChart,
  dashboardBar as bar,
  dashboardLine as line,
  dashboardColors,
} from '@/composables/useDashboardChart'
import type { FactoryPerformance, QualityBasis } from '@/types/factoryPerformance'
import type { Metric } from '@/types/materialAnalytics'

const props = defineProps<{
  data: FactoryPerformance
  scene: 'production' | 'quality'
  metric: Metric
  basis: QualityBasis
  motion: boolean
  aggregate?: boolean
  teamName?: string
}>()
const emit = defineEmits<{ team: [id: number] }>()
const { plot } = useDashboardChart()
const green = dashboardColors.primary,
  amber = dashboardColors.warning,
  rose = dashboardColors.danger
const periodLabel = computed(
  () => ({ day: '每日', week: '每周', month: '每月' })[props.data.period],
)
const unit = computed(() => (props.metric === 'quantity' ? '件次' : 'kg'))

const cards = computed(() => {
  const d = props.data
  if (props.scene === 'production') {
    if (props.aggregate && !props.teamName) return []
    const trend = (props.aggregate ? d.activity?.trend : d.production.trend) || []
    return [
      {
        key: 'production-trend',
        title: `${props.teamName ? `${props.teamName} · ` : ''}${periodLabel.value}加工完成量`,
        hint: props.aggregate
          ? '当前所选班组的实际加工登记，正常加工与返工分别统计。'
          : '当前班组、流水号、任务和工序的实际加工记录。',
        empty: !trend.some((row) => row.record_count),
        option: plot(
          trend.map((row) => row.date),
          [
            bar(
              '正常加工',
              trend.map((row) => row[`completed_${props.metric}`]),
              green,
            ),
            bar(
              '返工',
              trend.map((row) => row[`rework_${props.metric}`]),
              amber,
            ),
          ],
          unit.value,
        ),
      },
    ]
  }
  const matches = (row: QualityBasis) =>
    row.kind === props.basis.kind &&
    row.scope === props.basis.scope &&
    row.phase === props.basis.phase
  const materials = d.quality.materials.filter(matches),
    trend = d.quality.trend.filter(matches),
    dates = d.period_dates,
    palette = [
      green,
      dashboardColors.secondary,
      dashboardColors.success,
      amber,
      rose,
      dashboardColors.neutral,
    ],
    problems = d.issues.problems.slice(0, 10)
  return [
    {
      key: 'quality-materials',
      title: '各材质合格率',
      hint: '合格件次 ÷ 实际受检件次 · 不按班组百分比求平均',
      empty: !materials.some((row) => row.checked_quantity),
      option: plot(
        materials.map((row) => row.material_name || '未填写材质'),
        [
          bar(
            '合格率',
            materials.map((row) => row.pass_rate),
            green,
          ),
        ],
        '%',
        true,
        true,
      ),
    },
    {
      key: 'quality-trend',
      title: `${periodLabel.value}材质合格率`,
      hint: '各材质独立统计 · 周一至周日 / 自然月 · 未检日期留空',
      empty: !trend.length,
      option: plot(
        dates,
        materials.map((material, index) => {
          const values = new Map(
            trend
              .filter((row) => row.material_name === material.material_name)
              .map((row) => [row.date, row.pass_rate]),
          )
          return line(
            material.material_name || '未填写材质',
            dates.map((day) => values.get(day) ?? null),
            palette[index % palette.length]!,
          )
        }),
        '%',
        false,
        true,
      ),
    },
    {
      key: 'issue-problems',
      title: '检出问题分类',
      hint: '问题数前 10 项 · 导出包含全部分类',
      empty: !problems.length,
      option: plot(
        problems.map((row) => row.name),
        [
          bar(
            '问题数',
            problems.map((row) => row.issue_count),
            rose,
          ),
          bar(
            '未结束',
            problems.map((row) => row.unresolved_count),
            amber,
          ),
        ],
        '条',
        true,
      ),
    },
    {
      key: 'issue-teams',
      title: '涉及班组的问题',
      hint: '同一问题可涉及多个班组 · 各班组数量不能相加',
      empty: !d.issues.teams.length,
      option: plot(
        d.issues.teams.map((row) => row.team_name),
        [
          bar(
            '问题数',
            d.issues.teams.map((row) => row.issue_count),
            rose,
          ),
          bar(
            '未结束',
            d.issues.teams.map((row) => row.unresolved_count),
            amber,
          ),
        ],
        '条',
        true,
      ),
    },
  ]
})
const visibleCards = computed(() =>
  cards.value
    .filter((card) => !card.empty)
    .sort((a, b) => {
      if (a.key === 'quality-trend') return -1
      if (b.key === 'quality-trend') return 1
      return 0
    }),
)
</script>
<template>
  <section
    class="performance-charts"
    :class="{ 'performance-charts--single': scene === 'production' || visibleCards.length === 1 }"
    :aria-label="scene === 'production' ? '加工统计图' : '质量统计图'"
  >
    <DashboardCard
      v-if="scene === 'production' && aggregate && !teamName"
      title="各班组加工完成量"
      help="各班组分别统计实际加工登记，点击柱条查看该班组趋势。正常加工与返工分别展示，不跨班组合并。"
    >
      <template #actions
        ><span class="chart-unit">{{ unit }}</span></template
      >
      <TeamProductionChart
        :rows="data.activity?.teams || []"
        :metric="metric"
        :motion="motion"
        @select="emit('team', $event)"
      />
    </DashboardCard>
    <StatePanel
      v-else-if="!visibleCards.length"
      state="empty"
      :title="scene === 'quality' ? '当前范围暂无检查记录或质量问题' : '当前范围暂无加工记录'"
    />
    <DashboardCard
      v-for="card in visibleCards"
      :key="card.key"
      class="performance-chart"
      :data-chart="card.key"
      :title="card.title"
      :help="card.hint"
    >
      <template #actions
        ><span class="chart-unit">{{
          scene === 'production' ? unit : card.key.startsWith('quality') ? '%' : '条'
        }}</span></template
      >
      <LedgerChart
        :option="card.option"
        :empty="card.empty"
        :label="card.title"
        :motion="motion"
        smooth-update
        :enter-duration="800"
        :update-duration="400"
      />
    </DashboardCard>
  </section>
</template>
<style scoped>
.performance-charts {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 16px;
}
.performance-charts > :deep(.state-panel) {
  grid-column: 1 / -1;
  min-height: 180px;
}
.performance-charts--single {
  grid-template-columns: minmax(0, 1fr);
}
.performance-chart :deep(.ledger-chart-frame) {
  height: 285px;
}
.chart-unit {
  color: var(--wm-muted);
  font-size: 12px;
}
@media (max-width: 1000px) {
  .performance-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

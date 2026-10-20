<script setup lang="ts">
import { computed } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import LedgerChart from './LedgerChart.vue'
import { glassArea, glassFill, glassTooltip } from '@/utils/chartGlass'
import { formatAmount } from '@/utils/format'
import type { FactoryPerformance, QualityBasis } from '@/types/factoryPerformance'
import type { Metric } from '@/types/materialAnalytics'

const props = defineProps<{
  data: FactoryPerformance
  scene: 'production' | 'quality'
  metric: Metric
  basis: QualityBasis
  motion: boolean
}>()
const emit = defineEmits<{ team: [id: number] }>()
const green = '#58986f',
  amber = '#bf9658',
  rose = '#b87d72'
const unit = computed(() => (props.metric === 'quantity' ? '件次' : 'kg'))

function plot(
  names: string[],
  series: object[],
  suffix: string,
  horizontal = false,
  percentage = false,
): EChartsCoreOption {
  const category = {
    type: 'category',
    data: names,
    inverse: horizontal,
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: {
      color: '#64726a',
      fontSize: 13,
      hideOverlap: true,
      ...(horizontal ? { width: 108, overflow: 'truncate' } : {}),
    },
  }
  const numeric = {
    type: 'value',
    min: 0,
    ...(percentage ? { max: 100 } : {}),
    splitNumber: 4,
    axisLabel: { color: '#64726a', fontSize: 12 },
    splitLine: { lineStyle: { color: '#75978620', type: 'dashed' } },
  }
  return {
    textStyle: { fontFamily: 'HeatSink Inter, PingFang SC, Microsoft YaHei, sans-serif' },
    tooltip: {
      ...glassTooltip,
      trigger: 'axis',
      confine: true,
      valueFormatter: (value: number | null) =>
        value == null ? '未检查' : `${formatAmount(value)} ${suffix}`,
    },
    legend: {
      top: 0,
      right: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#64726a', fontSize: 12 },
    },
    grid: {
      top: 34,
      right: percentage ? 44 : 18,
      bottom: 8,
      left: 8,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: horizontal ? numeric : category,
    yAxis: horizontal ? category : numeric,
    series,
  }
}
function bar(name: string, data: (number | null)[], color: string) {
  return {
    name,
    type: 'bar',
    data,
    barMaxWidth: 16,
    itemStyle: {
      color: glassFill(color, true),
      borderColor: '#ffffffb3',
      borderWidth: 1,
      borderRadius: 4,
    },
  }
}
function line(name: string, data: (number | null)[], color: string) {
  return {
    name,
    type: 'line',
    data,
    connectNulls: false,
    showSymbol: data.length <= 1,
    symbolSize: 7,
    itemStyle: { color },
    lineStyle: { color, width: 2.5 },
    areaStyle: { color: glassArea(color) },
  }
}
const cards = computed(() => {
  const d = props.data
  if (props.scene === 'production') {
    const teams = d.production.teams,
      trend = d.production.trend
    return [
      {
        key: 'production-teams',
        title: '班组完成量',
        hint: '按完成任务累计 · 点击班组查看加工记录',
        empty: !teams.some((row) => row.record_count),
        option: plot(
          teams.map((row) => row.team_name),
          [
            bar(
              '正常加工',
              teams.map((row) => row[`completed_${props.metric}`]),
              green,
            ),
            bar(
              '返工',
              teams.map((row) => row[`rework_${props.metric}`]),
              amber,
            ),
          ],
          unit.value,
          true,
        ),
      },
      {
        key: 'production-trend',
        title: '每日完成量',
        hint: '按实际加工日期统计 · 出库不重复计产',
        empty: !trend.some((row) => row.record_count),
        option: plot(
          trend.map((row) => row.date.slice(5)),
          [
            line(
              '正常加工',
              trend.map((row) => row[`completed_${props.metric}`]),
              green,
            ),
            line(
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
  const groups = d.quality.groups.filter(matches),
    byDate = new Map(d.quality.trend.filter(matches).map((row) => [row.date, row])),
    dates = d.production.trend.map((row) => row.date),
    problems = d.issues.problems.slice(0, 10)
  return [
    {
      key: 'quality-teams',
      title: '受检班组合格率',
      hint: '仅依据实际受检件数 · 不推算责任班组合格率',
      empty: !groups.some((row) => row.checked_quantity),
      option: plot(
        groups.map((row) => row.team_name),
        [
          bar(
            '合格率',
            groups.map((row) => row.pass_rate),
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
      title: '每日合格率',
      hint: '没有检查的日期留空 · 不按 100% 计入',
      empty: !byDate.size,
      option: plot(
        dates.map((date) => date.slice(5)),
        [
          line(
            '合格率',
            dates.map((date) => byDate.get(date)?.pass_rate ?? null),
            green,
          ),
        ],
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
function select(key: string, index: number) {
  if (key !== 'production-teams') return
  const team = props.data.production.teams[index]
  if (team) emit('team', team.team_id)
}
</script>
<template>
  <section
    class="performance-charts"
    :aria-label="scene === 'production' ? '加工统计图' : '质量统计图'"
  >
    <article
      v-for="card in cards"
      :key="card.key"
      class="performance-chart chart-glass"
      :data-chart="card.key"
    >
      <header>
        <h2>{{ card.title }}</h2>
        <span>{{
          scene === 'production' ? unit : card.key.startsWith('quality') ? '%' : '条'
        }}</span>
      </header>
      <p>{{ card.hint }}</p>
      <LedgerChart
        :option="card.option"
        :empty="card.empty"
        :label="card.title"
        :motion="motion"
        @select="select(card.key, $event.dataIndex)"
      />
    </article>
  </section>
</template>
<style scoped>
.performance-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.performance-chart {
  min-width: 0;
  border-radius: var(--card-radius);
  padding: 16px 18px;
}
.performance-chart header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.performance-chart h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 550;
}
.performance-chart header > span,
.performance-chart p {
  color: var(--muted);
  font-size: 12px;
}
.performance-chart p {
  margin: 6px 0 12px;
  line-height: 18px;
}
.performance-chart .ledger-chart-frame {
  height: 260px;
}
@media (max-width: 1100px) {
  .performance-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (min-width: 1101px) and (max-height: 800px) {
  .performance-chart .ledger-chart-frame {
    height: 230px;
  }
}
</style>

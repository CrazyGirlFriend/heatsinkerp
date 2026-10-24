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
const green = '#58986f',
  amber = '#bf9658',
  rose = '#b87d72'
const periodLabel = computed(
  () => ({ day: '每日', week: '每周', month: '每月' })[props.data.period],
)
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
    ...(['件次', '条'].includes(suffix) ? { minInterval: 1 } : {}),
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
      type: 'scroll',
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
    ...(horizontal && names.length > 8
      ? {
          dataZoom: [
            {
              type: 'slider',
              yAxisIndex: 0,
              startValue: 0,
              endValue: 7,
              width: 8,
              right: 0,
              showDetail: false,
            },
          ],
        }
      : {}),
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
    showSymbol: true,
    symbolSize: data.filter((value) => value != null).length > 60 ? 3 : 6,
    itemStyle: { color },
    lineStyle: { color, width: 2.5 },
    areaStyle: { color: glassArea(color) },
  }
}
const cards = computed(() => {
  const d = props.data
  if (props.scene === 'production') {
    const trend = d.production.trend
    return [
      {
        key: 'production-trend',
        title: `${periodLabel.value}加工完成量`,
        hint: '仅当前班组、流水号、任务和工序 · 正常加工与返工分列',
        empty: !trend.some((row) => row.record_count),
        option: plot(
          trend.map((row) => row.date),
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
  const materials = d.quality.materials.filter(matches),
    trend = d.quality.trend.filter(matches),
    dates = d.period_dates,
    palette = [green, amber, rose, '#7a9c90', '#8f8c78', '#7f91a1'],
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
</script>
<template>
  <section
    class="performance-charts"
    :class="{ 'performance-charts--production': scene === 'production' }"
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
      <LedgerChart :option="card.option" :empty="card.empty" :label="card.title" :motion="motion" />
    </article>
  </section>
</template>
<style scoped>
.performance-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.performance-charts--production {
  grid-template-columns: minmax(0, 1fr);
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

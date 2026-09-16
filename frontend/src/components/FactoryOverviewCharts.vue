<script setup lang="ts">
import { computed } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import LedgerChart from './LedgerChart.vue'
import { materialTypeLabel } from '@/types/materialTransfer'
import type { Metric } from '@/types/materialAnalytics'
import type { FactoryOverview, FactoryTeam, FactoryScene } from '@/types/factoryOverview'
import type { ChartPoint } from '@/types/materialAnalytics'

const props = withDefaults(defineProps<{ data: FactoryOverview; metric: Metric; dark: boolean; scene?: FactoryScene; focusIndex?: number; motion?: boolean }>(), { scene: 'overview', motion: true })
const emit = defineEmits<{ team: [team: FactoryTeam] }>()
const unit = computed(() => props.metric === 'weight' ? 'kg' : '件')
const colors = computed(() => props.dark ? ['#ac9cff', '#62d6c2', '#f3bd75', '#f08fab'] : ['#8063e9', '#35ad9b', '#d99840', '#d66e8a'])
const ink = computed(() => props.dark ? '#a9b8ce' : '#70647f')
const fontSize = computed(() => 14)
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const common = computed(() => ({ color: colors.value, textStyle: { fontFamily: props.dark ? 'system-ui, sans-serif' : 'HeatSink Han, sans-serif', fontSize: fontSize.value, color: ink.value },
  tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (value: number) => `${format(value)} ${unit.value}` },
  legend: { top: 0, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: fontSize.value, color: ink.value } } }))
function plot(labels: string[], series: object[], horizontal = false, legend = true): EChartsCoreOption {
  const category = { type: 'category', data: labels, inverse: horizontal, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { fontSize: fontSize.value, color: ink.value, hideOverlap: true, ...(horizontal ? { width: props.dark ? 160 : 130, overflow: 'truncate' } : {}) } }
  const numeric = { type: 'value', min: 0, splitNumber: 3, axisLabel: { fontSize: fontSize.value, color: ink.value }, splitLine: { lineStyle: { color: props.dark ? '#26364f' : '#edf0f6' } } }
  return { ...common.value, legend: { ...common.value.legend, show: legend }, grid: { left: 8, right: 10, top: legend ? 34 : 12, bottom: 8, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    xAxis: horizontal ? numeric : category, yAxis: horizontal ? category : numeric, series }
}
const cards = computed(() => {
  const d = props.data, metric = props.metric
  const labels = d.trend.map(row => row.key.slice(5))
  const bar = (name: string, data: (number | null)[], stack?: string) => ({ id: name, name, data, type: 'bar', stack, barMaxWidth: 22, itemStyle: { borderRadius: 3 }, emphasis: { focus: 'none' } })
  const line = (name: string, data: number[]) => ({ id: name, name, data, type: 'line', showSymbol: false, smooth: false, lineStyle: { width: 2.5 } })
  const rank = (key: 'material' | 'serial', title: string) => {
    const rows = d[`${key}_ranking`]?.[metric] || []
    return { key: `${key}s`, title, hint: '当前全厂结存 · 前8项', empty: !rows.length,
      option: plot(rows.map(row => row.key), [bar('结存', rows.map(row => row[metric]))], true, false) }
  }
  const all = [
    { key: 'teams', title: '班组库存分布', hint: '当前在库 · 不含内部在途 · 点击查看班组', empty: !d.teams.some(team => team.balance && (team.balance[`on_hand_${metric}`] || 0) > 0),
      option: plot(d.teams.map(team => team.name + (!team.balance ? '（未配置）' : !team.active ? '（停用）' : '')), [bar('当前库存', d.teams.map(team => team.balance?.[`on_hand_${metric}`] ?? null))], true, false) },
    { key: 'flow', title: '全厂对外收发', hint: `近${d.days}天 · 内部转料不计入`, empty: !d.trend.some(row => row.inbound[metric] || row.outbound[metric] || row.shipment[metric]),
      option: plot(labels, [line('库房入库', d.trend.map(row => row.inbound[metric])), line('库房对外出库', d.trend.map(row => row.outbound[metric])), line('检验发货', d.trend.map(row => row.shipment[metric]))]) },
    { key: 'types', title: '物料类型', hint: '当前结存构成', empty: !d.material_types.some(row => row[metric] > 0),
      option: { ...common.value, tooltip: { ...common.value.tooltip, trigger: 'item' }, legend: { ...common.value.legend, top: undefined, bottom: 0, left: 'center', type: 'scroll' }, series: [{ type: 'pie', radius: ['43%', '70%'], center: ['50%', '43%'], label: { show: false }, itemStyle: { borderColor: props.dark ? '#19273c' : '#fff', borderWidth: 3 }, data: d.material_types.map(row => ({ name: row.key === 'unknown' ? '未填写类型' : materialTypeLabel(row.key), value: row[metric] })) }] } },
    { key: 'age', title: '库存停留', hint: '按剩余来源批次接收时间', empty: !d.stock_age.some(row => row[metric] > 0),
      option: plot(d.stock_age.map(row => ({ lt1: '<1天', '1_3': '1–3天', '3_7': '3–7天', ge7: '≥7天', unknown: '未知' })[row.key] || row.label || row.key), [bar('结存', d.stock_age.map(row => row[metric]))], false, false) },
    { key: 'waiting', title: '待交接时长', hint: '每笔转料只统计一次', empty: !d.waiting_age.some(row => row.internal[metric] || row.external[metric]),
      option: plot(['<1天', '1–3天', '3–7天', '≥7天'], [bar('内部待接收', d.waiting_age.map(row => row.internal[metric]), 'waiting'), bar('对外待确认', d.waiting_age.map(row => row.external[metric]), 'waiting')]) },
    { key: 'loss', title: '丢失趋势', hint: `近${d.days}天 ${format(d.period_totals.loss[metric])} ${unit.value} · 不含转废`, empty: !d.trend.some(row => row.loss[metric] > 0),
      option: plot(labels, [{ ...line('丢失', d.trend.map(row => row.loss[metric])), itemStyle: { color: colors.value[3] }, lineStyle: { color: colors.value[3], width: 2.5 }, areaStyle: { color: colors.value[3], opacity: .08 } }], false, false) },
    rank('serial', '流水号库存排行'), rank('material', '材质库存排行'),
    { key: 'outbound', title: '对外出库与发货', hint: `近${d.days}天 · 仅已确认`, empty: !(d.period_totals.outbound[metric] || d.period_totals.shipment[metric]),
      option: plot(['库房对外出库', '检验发货'], [bar('已确认', [d.period_totals.outbound[metric], d.period_totals.shipment[metric]])], false, false) },
  ]
  const keys = { overview: ['teams', 'flow', 'types'], stock: ['serials', 'materials', 'age'], handoff: ['waiting', 'loss', 'outbound'] }[props.scene]
  return keys.map(key => all.find(card => card.key === key)!)
})
function focus(key: string): (ChartPoint & { dataIndex: number }) | undefined {
  if (props.focusIndex === undefined) return
  const d = props.data
  let rows: (ChartPoint & { dataIndex: number })[] = []
  if (key === 'teams') rows = d.teams.flatMap((team, i) => team.balance?.on_hand_quantity != null && team.balance.on_hand_weight != null ? [{ key: team.name, quantity: team.balance.on_hand_quantity, weight: team.balance.on_hand_weight, dataIndex: i }] : [])
  else if (key === 'types') rows = d.material_types.map((row, i) => ({ ...row, key: row.key === 'unknown' ? '未填写类型' : materialTypeLabel(row.key), dataIndex: i }))
  else if (key === 'materials' || key === 'serials') rows = (d[key === 'materials' ? 'material_ranking' : 'serial_ranking']?.[props.metric] || []).map((row, i) => ({ ...row, dataIndex: i }))
  rows = rows.filter(row => row.quantity > 0 || row.weight > 0)
  return rows[props.focusIndex % rows.length]
}
function pick(key: string, index: number) { const team = props.data.teams[index]; if (key === 'teams' && team?.id && team.active) emit('team', team) }
</script>
<template>
  <section class="factory-charts" :class="{ 'factory-charts--screen': dark }" :data-scene="scene" aria-label="全厂物料分析">
    <article v-for="card in cards" :key="card.key" class="factory-chart" :class="`factory-chart--${card.key}`">
      <header><div><h2>{{ card.title }}</h2><p>{{ card.hint }}</p></div><span>{{ unit }}</span></header>
      <LedgerChart :option="card.option" :empty="card.empty" :label="`${card.title}，单位${unit}`" smooth-update :motion="motion" :highlight-index="focus(card.key)?.dataIndex" @select="pick(card.key, $event.dataIndex)" />
      <div v-if="focus(card.key)" class="chart-focus"><span :title="focus(card.key)!.key">{{ focus(card.key)!.key }}</span><strong>{{ format(focus(card.key)!.quantity) }} 件<span> / </span>{{ format(focus(card.key)!.weight) }} kg</strong></div>
    </article>
  </section>
</template>
<style scoped>
.factory-charts { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: minmax(280px, 1fr); gap: 18px; height: 100%; min-height: 280px; }
.factory-chart { grid-column: span 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 18px 18px 12px; border: 1px solid var(--dashboard-line); background: var(--dashboard-surface); border-radius: 14px; }
.factory-chart--teams, .factory-chart--serials, .factory-chart--waiting { grid-column: span 5; }.factory-chart--flow, .factory-chart--materials, .factory-chart--loss { grid-column: span 4; }
.factory-chart header { display: flex; flex-shrink: 0; justify-content: space-between; gap: 8px; margin-bottom: 14px; }.factory-chart h2 { font-size: 15px; line-height: 22px; font-weight: 600; margin: 0; letter-spacing: .2px; }.factory-chart p { font-size: 12px; line-height: 18px; color: var(--dashboard-muted); margin: 5px 0 0; }.factory-chart header > span { font-size: 12px; color: var(--dashboard-muted); line-height: 22px; }
.factory-charts--screen { gap: 22px; }.factory-charts--screen .factory-chart { padding: 22px 24px 16px; }.factory-charts--screen h2 { font-size: 18px; line-height: 26px; }.factory-charts--screen p, .factory-charts--screen header > span { font-size: 14px; line-height: 20px; }
.factory-charts:not(.factory-charts--screen) h2 { font-size: 16px; }
.factory-charts:not(.factory-charts--screen) :is(p, header > span) { font-size: 14px; line-height: 22px; }
.chart-focus { display: flex; flex-shrink: 0; justify-content: space-between; gap: 12px; padding-top: 12px; margin-top: 8px; border-top: 1px solid var(--dashboard-line); font-size: 13px; line-height: 22px; }.chart-focus > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.chart-focus strong { white-space: nowrap; font-weight: 500; font-variant-numeric: tabular-nums; }.chart-focus strong span { color: var(--dashboard-muted); }.factory-charts--screen .chart-focus { font-size: 14px; }
@media (max-width: 1200px) { .factory-charts { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: none; grid-auto-rows: 320px; height: auto; }.factory-chart { grid-column: span 1; }.factory-chart:last-child { grid-column: 1 / -1; } }
@media (max-width: 640px) { .factory-charts { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 310px; gap: 14px; }.factory-chart { padding: 18px 14px 12px; } }
</style>

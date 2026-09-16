<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElRadioButton, ElRadioGroup } from 'element-plus'
import type { EChartsCoreOption } from 'echarts/core'
import LedgerChart from './LedgerChart.vue'
import { materialTypeLabel } from '@/types/materialTransfer'
import type { AgeBand, ChartPoint, MaterialAnalytics, Metric, SerialParams } from '@/types/materialAnalytics'
const props = withDefaults(defineProps<{ data: MaterialAnalytics; metric: Metric; mode?: 'overview' | 'peers' }>(), { mode: 'overview' })
const emit = defineEmits<{ filter: [params: SerialParams, label: string] }>()
const lossMode = ref('trend')
const colors = ['#8063ef', '#43b8a6', '#e7a048', '#d86b86', '#62a5db', '#a595c9', '#8e9ea9', '#ccb46e']
const unit = computed(() => props.metric === 'weight' ? 'kg' : '件')
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const values = (items: ChartPoint[]) => items.map(item => item[props.metric])
const any = (items: ChartPoint[]) => items.some(item => item[props.metric] > 0)
const base = computed(() => ({ color: colors, textStyle: { fontFamily: 'HeatSink Han, sans-serif', fontSize: 14, color: '#70647f' },
  tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (value: number) => `${number(value)} ${unit.value}` } }))
function bars(labels: string[], series: { name: string; data: number[]; type?: string }[], horizontal = false): EChartsCoreOption {
  const category = { type: 'category', data: labels, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { width: horizontal ? 112 : undefined, overflow: 'truncate', fontSize: 14, hideOverlap: true }, inverse: horizontal }
  const numeric = { type: 'value', min: 0, splitNumber: 3, axisLabel: { fontSize: 14, hideOverlap: true }, splitLine: { lineStyle: { color: '#f0edf6' } } }
  return { ...base.value, grid: { left: horizontal ? 140 : 48, right: 20, top: series.length > 1 ? 48 : 12, bottom: 32 },
    legend: { show: series.length > 1, top: 0, itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 14, color: '#70647f' } },
    xAxis: horizontal ? numeric : category, yAxis: horizontal ? category : numeric,
    series: series.map(series => ({ ...series, type: series.type || 'bar', barMaxWidth: 16, showSymbol: series.type === 'line', symbolSize: 5, smooth: false,
      itemStyle: { borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] }, emphasis: { focus: 'series' } })) }
}
const cards = computed(() => {
  const d = props.data
  if (props.mode === 'peers') return (['incoming', 'outgoing'] as const).map(direction => ({ key: direction, title: direction === 'incoming' ? '接收来源' : '转出去向', hint: `近${d.days}天 · ${direction === 'incoming' ? '已接收' : '内部按提交 · 对外按确认'}`,
    empty: !any(d.peers[direction]), option: bars(d.peers[direction].map(row => row.label || row.key), [{ name: direction === 'incoming' ? '接收' : '转出', data: values(d.peers[direction]) }], true) }))
  const trendLabels = d.trend.map(row => row.key.slice(5))
  return [
    { key: 'trend', title: '收发趋势', hint: `近${d.days}天 · 内部转出按提交，接收按确认`, empty: !d.trend.some(row => row.incoming[props.metric] || row.outgoing[props.metric]), option: bars(trendLabels, ['incoming', 'outgoing'].map((direction, index) => ({ name: index ? '转出（内部提交／对外确认）' : '接收', data: d.trend.map(row => row[direction as 'incoming' | 'outgoing'][props.metric]) }))) },
    { key: 'ranking', title: '流水号库存排行', hint: '当前结存 · 前10位', empty: !any(d.stock_ranking), option: bars(d.stock_ranking.map(row => row.key), [{ name: '结存', data: values(d.stock_ranking) }], true) },
    { key: 'types', title: '物料类型构成', hint: '当前结存', empty: !any(d.material_types), option: { ...base.value, tooltip: { ...base.value.tooltip, trigger: 'item' }, legend: { orient: 'vertical', right: 0, top: 'middle', itemWidth: 7, itemHeight: 7, textStyle: { fontSize: 14, color: '#70647f' } }, series: [{ type: 'pie', radius: ['45%', '77%'], center: ['32%', '50%'], label: { show: false }, itemStyle: { borderColor: '#fff', borderWidth: 2 }, data: d.material_types.map(row => ({ name: row.key === 'unknown' ? '未填写类型' : materialTypeLabel(row.key), value: row[props.metric] })) }] } },
    { key: 'age', title: '库存停留时长', hint: '按剩余来源批次接收时间', empty: !any(d.stock_age), option: bars(d.stock_age.map(row => row.label || row.key), [{ name: '结存', data: values(d.stock_age) }]) },
    { key: 'waiting', title: '待交接时长', hint: '按转料登记时间', empty: !d.waiting_age.some(row => row.incoming[props.metric] || row.outgoing[props.metric]), option: bars(d.waiting_age.map(row => row.label || row.key), [{ name: '待本班接收', data: d.waiting_age.map(row => row.incoming[props.metric]) }, { name: '待转出确认', data: d.waiting_age.map(row => row.outgoing[props.metric]) }]) },
    { key: 'loss', title: '丢失情况', hint: `近${d.days}天 · 不含转废`, empty: lossMode.value === 'trend' ? !d.trend.some(row => row.loss?.[props.metric]) : !any(d.loss_ranking), option: lossMode.value === 'trend' ? bars(trendLabels, [{ name: '丢失', type: 'line', data: d.trend.map(row => row.loss?.[props.metric] || 0) }]) : bars(d.loss_ranking.map(row => row.key), [{ name: '丢失', data: values(d.loss_ranking) }], true) },
  ]
})
function pick(key: string, event: { dataIndex: number; seriesIndex: number }) {
  const d = props.data, i = event.dataIndex
  if (key === 'trend' && d.trend[i]) { const kind = event.seriesIndex ? 'outgoing' : 'incoming'; emit('filter', { activity_day: d.trend[i]!.key, activity_kind: kind }, `${d.trend[i]!.key} ${kind === 'incoming' ? '已接收' : '已转出'}`) }
  if (key === 'ranking' && d.stock_ranking[i]) emit('filter', { serial_no: d.stock_ranking[i]!.key }, d.stock_ranking[i]!.key)
  if (key === 'types' && d.material_types[i]) emit('filter', { material_type: d.material_types[i]!.key }, `库存类型：${materialTypeLabel(d.material_types[i]!.key)}`)
  if (key === 'age' && d.stock_age[i] && d.stock_age[i]!.key !== 'unknown') emit('filter', { stock_age: d.stock_age[i]!.key as AgeBand }, `库存停留：${d.stock_age[i]!.label}`)
  if (key === 'waiting' && d.waiting_age[i]) { const direction = event.seriesIndex ? 'outgoing' : 'incoming'; emit('filter', { waiting_direction: direction, waiting_age: d.waiting_age[i]!.key as AgeBand }, `${direction === 'incoming' ? '待本班接收' : '待转出确认'}：${d.waiting_age[i]!.label}`) }
  if (key === 'loss') {
    if (lossMode.value === 'ranking' && d.loss_ranking[i]) emit('filter', { serial_no: d.loss_ranking[i]!.key, has_loss: true }, `丢失记录：${d.loss_ranking[i]!.key}`)
    else if (d.trend[i]) emit('filter', { activity_day: d.trend[i]!.key, activity_kind: 'loss' }, `${d.trend[i]!.key} 丢失记录`)
  }
  if ((key === 'incoming' || key === 'outgoing') && d.peers[key][i]) emit('filter', { flow_direction: key, peer: d.peers[key][i]!.key }, `${key === 'incoming' ? '接收来源' : '转出去向'}：${d.peers[key][i]!.label}`)
}
</script>
<template>
  <section class="analytics-grid" :class="{ 'analytics-grid--peers': mode === 'peers' }" aria-label="班组物料分析图表">
    <article v-for="card in cards" :key="card.key" class="analytics-card">
      <header><div><h3>{{ card.title }}</h3><span>{{ card.hint }}</span></div><ElRadioGroup v-if="card.key === 'loss'" v-model="lossMode" size="small" aria-label="丢失图表形式"><ElRadioButton value="trend">趋势</ElRadioButton><ElRadioButton value="ranking">排行</ElRadioButton></ElRadioGroup><small v-else>{{ unit }}</small></header>
      <LedgerChart :option="card.option" :empty="card.empty" :label="`${card.title}，单位${unit}，点击筛选流水号`" @select="pick(card.key, $event)" />
    </article>
  </section>
</template>
<style scoped>
.analytics-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, 300px); gap: 20px; flex: 0 0 auto; min-height: 0; }
.analytics-card { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 16px 16px 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.analytics-card header { display: flex; flex-shrink: 0; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 4px; }
.analytics-card h3 { margin: 0; font-size: 16px; font-weight: 500; }
.analytics-card header span, .analytics-card header small { color: #60656f; font-size: 14px; }
.analytics-card :deep(.el-radio-button__inner) { padding: 4px 7px; font-size: 12px; }
.analytics-grid--peers { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); height: 340px; }
@media (max-width: 1400px) { .analytics-grid:not(.analytics-grid--peers) { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 300px; grid-template-rows: none; } }
@media (max-width: 600px) { .analytics-grid, .analytics-grid--peers, .analytics-grid:not(.analytics-grid--peers) { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 300px; grid-template-rows: none; }.analytics-grid--peers { height: min(65vh, 540px); overflow-y: auto; } }
</style>

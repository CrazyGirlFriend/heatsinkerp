<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import LedgerChart from './LedgerChart.vue'
import { materialTypeLabel, materialTypeOptions } from '@/types/materialTransfer'
import type { Metric } from '@/types/materialAnalytics'
import type { FactoryOverview, FactoryTeam, FactoryScene } from '@/types/factoryOverview'

const props = withDefaults(defineProps<{ data: FactoryOverview; metric: Metric; scene?: FactoryScene; motion?: boolean }>(), { scene: 'overview', motion: true })
const emit = defineEmits<{ team: [team: FactoryTeam] }>()
const chartsRoot = ref<HTMLElement>()
const unit = computed(() => props.metric === 'weight' ? 'kg' : '件')
const colors = computed(() => ['#58986f', '#79a9ce', '#c6a15c', '#a6afb6'])
const ink = computed(() => '#64726a')
const fontSize = computed(() => 14)
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const natureColors = ['#58986f', '#79a9ce', '#c6a15c', '#9c91b5', '#86b2a4', '#bd8979', '#899baf', '#aea68d', '#86a5ad']
const natureOrder = (key: string) => { const index = materialTypeOptions.findIndex(option => option.value === key); return index < 0 ? materialTypeOptions.length : index }
const materialTypes = computed(() => props.data.material_types.filter(row => row.quantity !== 0 || row.weight !== 0).sort((a, b) => natureOrder(a.key) - natureOrder(b.key)).map((row, index) => ({
  ...row, name: row.key === 'unknown' ? '未填写性质' : materialTypeLabel(row.key), color: natureColors[index % natureColors.length],
})))
function natureTooltipPosition(_point: number[], _params: unknown, _dom: unknown, _rect: unknown, size: { contentSize: number[]; viewSize: number[] }) {
  const bounds = chartsRoot.value?.querySelector('.factory-chart--types .ledger-chart')?.getBoundingClientRect()
  const width = size.contentSize[0]!, height = size.contentSize[1]!
  const left = (size.viewSize[0]! - width) / 2
  // The narrow ring cannot contain its tooltip; place it above, within the viewport.
  return bounds ? [Math.max(8 - bounds.left, Math.min(left, document.documentElement.clientWidth - bounds.left - width - 8)), Math.max(8 - bounds.top, -height - 10)] : [left, -height - 10]
}
const common = computed(() => ({ color: colors.value, textStyle: { fontFamily: 'HeatSink Inter, PingFang SC, Microsoft YaHei, sans-serif', fontSize: fontSize.value, color: ink.value },
  tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (value: number) => `${format(value)} ${unit.value}` },
  legend: { top: 0, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: fontSize.value, color: ink.value } } }))
function plot(labels: string[], series: object[], horizontal = false, legend = true): EChartsCoreOption {
  const category = { type: 'category', data: labels, inverse: horizontal, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { fontSize: fontSize.value, color: ink.value, hideOverlap: true, ...(horizontal ? { width: 130, overflow: 'truncate' } : {}) } }
  const numeric = { type: 'value', splitNumber: 3, axisLabel: { fontSize: fontSize.value, color: ink.value }, splitLine: { lineStyle: { color: '#edf0f6' } } }
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
    const option = plot(rows.map(row => row.key), [{ ...bar('未转出库存', rows.map(row => row[metric])), barMaxWidth: 12,
      showBackground: true, backgroundStyle: { color: '#f3f6f4', borderRadius: 3 },
      itemStyle: { borderRadius: 3, color: ({ dataIndex }: { dataIndex: number }) => dataIndex === 0 ? '#4f8f68' : '#9bbba7' },
      label: { show: true, position: 'right', distance: 10, color: '#354d3e', fontSize: 13, fontWeight: 500, formatter: ({ value }: { value: number }) => format(value) },
    }], true, false)
    option.grid = { left: 0, right: 84, top: 4, bottom: 4, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' }
    option.xAxis = { type: 'value', show: false }
    return { key: `${key}s`, title, hint: '全厂未转出库存 · 前8项', empty: !rows.length,
      option }
  }
  const all = [
    { key: 'teams', title: '班组库存分布', hint: '未转出库存 · 点击查看班组', empty: !d.teams.some(team => team.balance && (team.balance[`on_hand_${metric}`] || 0) !== 0),
      option: plot(d.teams.map(team => team.name + (!team.balance ? '（未配置）' : !team.active ? '（停用）' : '')), [bar('未转出库存', d.teams.map(team => team.balance?.[`on_hand_${metric}`] ?? null))], true, false) },
    { key: 'flow', title: '全厂对外收发', hint: `近${d.days}天 · 内部转料不计入`, empty: !d.trend.some(row => row.inbound[metric] || row.outbound[metric] || row.shipment[metric]),
      option: plot(labels, [line('库房入库', d.trend.map(row => row.inbound[metric])), line('库房对外出库', d.trend.map(row => row.outbound[metric])), line('检验发货', d.trend.map(row => row.shipment[metric]))]) },
    { key: 'types', title: '物料类型分布', hint: '未转出库存构成', empty: !materialTypes.value.some(row => row[metric] > 0),
      option: { ...common.value, tooltip: { ...common.value.tooltip, trigger: 'item', renderMode: 'html', appendTo: 'body', confine: false, position: natureTooltipPosition, className: 'factory-nature-tooltip', textStyle: { fontSize: 12 }, padding: [8, 10] }, legend: { show: false }, series: [{ type: 'pie', radius: ['55%', '86%'], center: ['50%', '50%'], label: { show: false }, itemStyle: { borderColor: '#fff', borderWidth: 2 }, data: materialTypes.value.filter(row => row[metric] >= 0).map(row => ({ name: row.name, value: row[metric], itemStyle: { color: row.color } })) }] } },
    { key: 'waiting', title: '待交接时长', hint: '每笔转料只统计一次', empty: !d.waiting_age.some(row => row.internal[metric] || row.external[metric]),
      option: plot(['<1天', '1–3天', '3–7天', '≥7天'], [bar('内部待签收', d.waiting_age.map(row => row.internal[metric]), 'waiting'), bar('对外待确认', d.waiting_age.map(row => row.external[metric]), 'waiting')]) },
    { key: 'loss', title: '丢失趋势', hint: `近${d.days}天 ${format(d.period_totals.loss[metric])} ${unit.value} · 不含转废`, empty: !d.trend.some(row => row.loss[metric] > 0),
      option: plot(labels, [{ ...line('丢失', d.trend.map(row => row.loss[metric])), itemStyle: { color: colors.value[3] }, lineStyle: { color: colors.value[3], width: 2.5 }, areaStyle: { color: colors.value[3], opacity: .08 } }], false, false) },
    rank('serial', '流水号库存排行'), rank('material', '材质库存排行'),
    { key: 'outbound', title: '对外出库与发货', hint: `近${d.days}天 · 仅已确认`, empty: !(d.period_totals.outbound[metric] || d.period_totals.shipment[metric]),
      option: plot(['库房对外出库', '检验发货'], [bar('已确认', [d.period_totals.outbound[metric], d.period_totals.shipment[metric]])], false, false) },
  ]
  const keys = { overview: ['teams', 'flow', 'types'], stock: ['serials', 'materials'], handoff: ['waiting', 'loss', 'outbound'] }[props.scene]
  return keys.map(key => all.find(card => card.key === key)!)
})
function pick(key: string, index: number) { const team = props.data.teams[index]; if (key === 'teams' && team?.id && team.active) emit('team', team) }
</script>
<template>
  <section ref="chartsRoot" class="factory-charts" :data-scene="scene" aria-label="全厂物料分析">
    <article v-for="card in cards" :key="card.key" class="factory-chart" :class="[`factory-chart--${card.key}`, { 'factory-chart--nature': card.key === 'types' && materialTypes.length }]">
      <header><h2 :title="card.hint">{{ card.title }}</h2><span v-if="card.key !== 'types'">{{ unit }}</span></header>
      <div class="factory-chart-content" :class="{ 'nature-content': card.key === 'types' && materialTypes.length }">
        <LedgerChart :option="card.option" :empty="card.empty" :label="`${card.title}，单位${unit}`" smooth-update :motion="motion" @select="pick(card.key, $event.dataIndex)" />
        <div v-if="card.key === 'types' && materialTypes.length" class="nature-table-scroll" tabindex="0" role="region" aria-label="物料类型库存明细">
        <table class="nature-table">
          <thead><tr><th scope="col">性质</th><th scope="col">{{ metric === 'weight' ? '重量 (kg)' : '件数' }}</th></tr></thead>
          <tbody><tr v-for="row in materialTypes" :key="row.key"><th scope="row"><i :style="{ background: row.color }" aria-hidden="true" />{{ row.name }}</th><td :class="{ 'nature-shortage': row[metric] < 0 }">{{ format(row[metric]) }}<small v-if="row[metric] < 0"> 账面缺口</small></td></tr></tbody>
        </table>
        </div>
      </div>
    </article>
  </section>
</template>
<style scoped>
.factory-charts { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); gap: 14px; height: 100%; min-height: 0; }
.factory-chart { grid-column: span 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 18px 20px 14px; border: 1px solid var(--dashboard-line); background: var(--dashboard-surface); border-radius: var(--card-radius, 12px); }
.factory-chart--teams, .factory-chart--waiting { grid-column: span 5; }.factory-chart--flow, .factory-chart--loss { grid-column: span 4; }
.factory-chart header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }.factory-chart h2 { font-size: 15px; line-height: 22px; font-weight: 550; margin: 0; }.factory-chart header > span { font-size: 12px; color: var(--dashboard-muted); line-height: 22px; }
.factory-chart--serials, .factory-chart--materials { grid-column: span 6; }
.factory-chart-content { display: flex; flex: 1; min-width: 0; min-height: 0; }
.factory-chart--teams, .factory-chart--types { grid-column: span 4; }
.factory-chart--nature { display: grid; grid-template-columns: minmax(100px, .8fr) minmax(0, 1.7fr); grid-template-rows: auto minmax(0, 1fr); gap: 8px 12px; }
.factory-chart--nature > header { grid-area: 1 / 1; }
.nature-content { display: contents; }
.nature-content .ledger-chart-frame { grid-area: 2 / 1; align-self: center; height: 130px; }
.nature-table-scroll { grid-area: 1 / 2 / -1 / 3; align-self: start; min-width: 0; max-height: 100%; overflow: auto; scrollbar-width: thin; }
.nature-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.nature-table th, .nature-table td { padding: 2px 3px; border-bottom: 1px solid var(--dashboard-line); text-align: right; }
.nature-table thead th { position: sticky; top: 0; z-index: 1; background: var(--dashboard-surface); color: var(--dashboard-muted); font-weight: 400; }
.nature-table th:first-child { padding-left: 0; text-align: left; }.nature-table tbody th { font-weight: 400; }.nature-table td:last-child, .nature-table th:last-child { padding-right: 0; }
.nature-table tbody tr:last-child > * { border-bottom: 0; }.nature-table i { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; vertical-align: 1px; }
.nature-table-scroll:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }
@media (min-width: 1101px) and (min-height: 801px) { .nature-table th, .nature-table td { padding-block: 5px; } }
@media (min-width: 1101px) and (max-height: 800px) { .factory-charts { gap: 12px; }.factory-chart { padding: 12px 16px 10px; }.factory-chart header { margin-bottom: 8px; } }
@media (max-width: 1100px) { .factory-charts { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: none; grid-auto-rows: 300px; height: auto; }.factory-chart { grid-column: span 1; }.factory-charts:not([data-scene="stock"]) .factory-chart:last-child { grid-column: 1 / -1; }.factory-charts[data-scene="stock"] { grid-auto-rows: 310px; } }
@media (max-width: 640px) { .factory-charts { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 280px; }.factory-chart { padding: 16px 14px 12px; }.factory-charts[data-scene="stock"] { grid-auto-rows: 300px; } }
.nature-shortage { color: var(--el-color-danger); }
</style>

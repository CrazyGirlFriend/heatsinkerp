<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsCoreOption, type ECharts } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, CanvasRenderer])
const props = withDefaults(defineProps<{ option: EChartsCoreOption; label: string; empty?: boolean; smoothUpdate?: boolean; motion?: boolean; highlightIndex?: number; pixelRatio?: number }>(), { motion: true })
const emit = defineEmits<{ select: [value: { dataIndex: number; seriesIndex: number }] }>()
const root = ref<HTMLElement>()
let chart: ECharts | undefined
let observer: ResizeObserver | undefined
function focusPoint() {
  chart?.dispatchAction({ type: 'downplay' })
  if (props.highlightIndex !== undefined) chart?.dispatchAction({ type: 'highlight', dataIndex: props.highlightIndex })
}
function render() {
  if (!root.value || !root.value.clientWidth || !root.value.clientHeight) return
  if (props.empty) { chart?.dispose(); chart = undefined; return }
  if (!chart) {
    chart = init(root.value, undefined, { devicePixelRatio: props.pixelRatio })
    chart.on('click', params => emit('select', { dataIndex: params.dataIndex, seriesIndex: params.seriesIndex ?? 0 }))
  }
  chart.setOption({ ...props.option, aria: { enabled: true, label: { description: props.label } }, animation: props.motion && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, animationDuration: props.smoothUpdate ? 600 : 300, animationDurationUpdate: props.smoothUpdate ? 600 : 220 }, { notMerge: !props.smoothUpdate, ...(props.smoothUpdate ? { replaceMerge: ['series'] } : {}) })
  chart.resize()
  focusPoint()
}
watch(() => [props.option, props.empty, props.motion], render, { flush: 'post' })
watch(() => props.highlightIndex, focusPoint)
watch(() => props.pixelRatio, () => { chart?.dispose(); chart = undefined; render() }, { flush: 'post' })
onMounted(() => { observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chart ? chart.resize() : render()) : undefined; if (root.value) observer?.observe(root.value); render() })
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); chart = undefined })
</script>
<template><div class="ledger-chart-frame"><div ref="root" class="ledger-chart" role="img" :aria-label="label" /><span v-if="empty" class="chart-empty">暂无符合条件的数据</span></div></template>
<style scoped>
.ledger-chart-frame { position: relative; flex: 1; min-height: 0; min-width: 0; }
.ledger-chart { width: 100%; height: 100%; }
.chart-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--subtle); font-size: 12px; pointer-events: none; }
</style>

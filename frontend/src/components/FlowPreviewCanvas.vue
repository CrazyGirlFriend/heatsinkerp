<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { SankeyChart, CustomChart } from 'echarts/charts'
import { AriaComponent, TooltipComponent, GridComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import type { FlowInteraction } from '@/utils/flowPreview'

use([SankeyChart, CustomChart, AriaComponent, TooltipComponent, GridComponent, DataZoomComponent, CanvasRenderer, SVGRenderer])
const props = defineProps<{ option: EChartsCoreOption; label: string; replay: number; motion: boolean; renderer?: 'canvas' | 'svg'; interaction?: FlowInteraction }>()
const emit = defineEmits<{ select: [value: { dataIndex: number; dataType?: string; data: unknown }]; zoom: [value: number] }>()
const root = ref<HTMLElement>()
const dragging = ref(false)
let chart: ECharts | undefined, observer: ResizeObserver | undefined
let motionQuery: MediaQueryList | undefined
function render(reset = false) {
  if (!root.value?.clientWidth || !root.value.clientHeight) return
  if (!chart) {
    chart = init(root.value, undefined, { renderer: props.renderer || 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) })
    chart.on('click', params => {
      if (props.interaction !== 'pan') emit('select', { dataIndex: params.dataIndex, dataType: params.dataType, data: params.data })
    })
    chart.on('datazoom', reportZoom)
  }
  const view = zoomStates()
  if (reset) chart.clear()
  const animation = props.motion && !motionQuery?.matches && !document.hidden
  if (!animation) chart.getZr().storage.getDisplayList().forEach(element => element.stopAnimation(undefined, true))
  const option: EChartsCoreOption & { dataZoom?: ZoomState[] } = { ...props.option, animation, aria: { enabled: true, label: { description: props.label } } }
  if (Array.isArray(option.dataZoom)) option.dataZoom = option.dataZoom.map(item => {
    const previous = view.find(state => state.id === item.id)
    return previous ? { ...item, start: previous.start, end: previous.end } : item
  })
  // Media options adjust axes/controls only; replaceMerge would remove their omitted series.
  chart.setOption(option, props.option.media ? {} : { replaceMerge: ['series'] })
  reportZoom()
}
function resize() {
  if (!chart) { render(); return }
  if (root.value && (root.value.clientWidth !== chart.getWidth() || root.value.clientHeight !== chart.getHeight())) chart.resize()
}
function changeMotion() { render() }
interface ZoomState { id?: string; type?: string; start?: number; end?: number; minSpan?: number }
function zoomStates() { return (chart?.getOption()?.dataZoom || []) as ZoomState[] }
function reportZoom() {
  const time = zoomStates().find(item => item.id === 'time')
  emit('zoom', time ? Math.round(10000 / Math.max(Number.EPSILON, (time.end ?? 100) - (time.start ?? 0))) : 100)
}
function zoom(direction: number) {
  chart?.dispatchAction({ type: 'dataZoom', batch: zoomStates().flatMap((item, index) => {
    if (item.type === 'slider') return []
    const start = item.start || 0, end = item.end ?? 100, center = (start + end) / 2
    const range = direction === 0 ? 100 : Math.max(item.minSpan ?? (item.id === 'teams' ? 10 : .05), Math.min(100, (end - start) * (direction > 0 ? .75 : 1.33)))
    const left = Math.max(0, Math.min(100 - range, center - range / 2))
    return [{ dataZoomIndex: index, start: left, end: left + range }]
  }) })
  reportZoom()
}
function keyboard(event: KeyboardEvent) {
  if (!['+', '=', '-', '0'].includes(event.key)) return
  event.preventDefault(); zoom(event.key === '0' ? 0 : event.key === '-' ? -1 : 1)
}
defineExpose({ zoom })
watch(() => [props.option, props.replay, props.motion], (value, previous) => render(value[1] !== previous[1]), { flush: 'post' })
onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionQuery.addEventListener('change', changeMotion)
  document.addEventListener('visibilitychange', changeMotion)
  observer = new ResizeObserver(resize); if (root.value) observer.observe(root.value)
  render()
})
onBeforeUnmount(() => {
  observer?.disconnect(); motionQuery?.removeEventListener('change', changeMotion)
  document.removeEventListener('visibilitychange', changeMotion)
  chart?.dispose(); chart = undefined
})
</script>
<template><div ref="root" class="flow-canvas" :class="{ panning: interaction === 'pan', dragging }" role="img" tabindex="0" :aria-label="label" @pointerdown="dragging = interaction === 'pan'" @pointerup="dragging = false" @pointercancel="dragging = false" @pointerleave="dragging = false" @dblclick="zoom(0)" @keydown="keyboard" /></template>
<style scoped>
.flow-canvas { width: 100%; height: 100%; min-height: 520px; outline: none; touch-action: none; }
.flow-canvas:focus-visible { outline: 2px solid #9280d9; outline-offset: -2px; }
.flow-canvas.panning, .flow-canvas.panning :deep(*) { cursor: grab !important; }
.flow-canvas.dragging, .flow-canvas.dragging :deep(*) { cursor: grabbing !important; }
</style>

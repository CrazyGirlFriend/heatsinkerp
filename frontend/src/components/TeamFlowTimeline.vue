<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElIcon, ElOption, ElSelect, ElTooltip } from 'element-plus'
import { Close, FullScreen, Pointer, Rank, RefreshRight, VideoPause, VideoPlay, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import FlowPreviewCanvas from './FlowPreviewCanvas.vue'
import type { SerialHistory } from '@/types/teamBusiness'
import { teamTimelineModel, teamTimelineOption } from '@/utils/teamFlowTimeline'
import { traceTime, type FlowInteraction } from '@/utils/flowPreview'
import { historyKindNames } from '@/utils/serialHistoryChart'

const props = defineProps<{ history: SerialHistory; example?: boolean }>()
const emit = defineEmits<{ select: [batchNo: string] }>()
const root = ref<HTMLElement>(), chart = ref<InstanceType<typeof FlowPreviewCanvas>>()
const interaction = ref<FlowInteraction>('select'), replay = ref(0), motion = ref(true), zoom = ref(100)
const selected = ref(''), fullscreen = ref(false), fullscreenError = ref('')
const zoomLabel = computed(() => zoom.value < 10000 ? String(zoom.value) : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(zoom.value))
const model = computed(() => teamTimelineModel(props.history))
const option = computed(() => teamTimelineOption(model.value, selected.value, interaction.value, motion.value))
const selectionOptions = computed(() => model.value.nodes.map(node => ({ id: node.id, label: node.event
  ? `${historyKindNames[node.event.kind]} · ${node.event.batch_no}` : `接收批次 · ${model.value.rows[node.row]!.lot.batch_no}` })))
const dense = computed(() => model.value.nodes.length > 8 || model.value.rows.some(row => {
  const events = model.value.nodes.filter(node => node.event && model.value.rows[node.row] === row)
  return events.some((node, index) => index > 0 && node.at - events[index - 1]!.at < model.value.span * .15)
}))
async function select(id: string) {
  selected.value = id
  const node = model.value.nodes.find(item => item.id === id)
  if (!node) return
  // The existing batch drawer teleports to body; leave fullscreen before opening it.
  if (document.fullscreenElement === root.value) {
    try { await document.exitFullscreen() }
    catch { fullscreenError.value = '请退出全屏后查看批次。'; return }
  }
  emit('select', node.event?.batch_no || model.value.rows[node.row]!.lot.batch_no)
}
function pick(event: { dataIndex: number }) { const node = model.value.nodes[event.dataIndex]; if (node) select(node.id) }
function shortcut(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, [contenteditable=true], [role=combobox]')) return
  if (event.key.toLowerCase() === 'v') { event.preventDefault(); interaction.value = 'select' }
  if (event.key.toLowerCase() === 'h') { event.preventDefault(); interaction.value = 'pan' }
  if (event.key === 'Escape') selected.value = ''
}
async function toggleFullscreen() {
  fullscreenError.value = ''
  try { if (document.fullscreenElement === root.value) await document.exitFullscreen(); else await root.value?.requestFullscreen() }
  catch { fullscreenError.value = '无法进入全屏，请使用窗口最大化查看。' }
}
function fullscreenChanged() { fullscreen.value = document.fullscreenElement === root.value }
watch(() => props.history.serial_no, () => { selected.value = ''; replay.value++ })
onMounted(() => document.addEventListener('fullscreenchange', fullscreenChanged))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', fullscreenChanged))
</script>

<template>
  <section ref="root" class="team-timeline" aria-label="本班组批次收发时间画布" @keydown="shortcut">
    <header class="timeline-legend">
      <ElSelect v-if="dense" :model-value="selected || undefined" filterable clearable :append-to="root" placeholder="查找收发节点" aria-label="查找收发节点" @change="select" @clear="selected = ''"><ElOption v-for="entry in selectionOptions" :key="entry.id" :value="entry.id" :label="entry.label" /></ElSelect>
      <div class="node-legend"><span><i class="marker received" />实心收进</span><span><i class="marker" />空心转出</span><span><ElIcon><Close /></ElIcon>丢失</span></div>
    </header>
    <div v-if="model.extent" class="timeline-scroll">
      <FlowPreviewCanvas ref="chart" :option="option" :replay="replay" :motion="motion" renderer="svg" :interaction="interaction" :label="`${history.team_name}，流水号 ${history.serial_no}，按业务及来源批次排列的收发时间图；件数和重量，滚轮缩放，H 平移，V 选择。`" @select="pick" @zoom="zoom = $event" />
    </div>
    <div v-else class="timeline-empty">所选日期内没有已入账的收发或结存。</div>
    <div v-if="model.extent" class="timeline-controls" role="group" aria-label="班组画布工具">
      <div class="tool-group tool-mode" :class="{ panning: interaction === 'pan' }">
        <ElTooltip content="选择批次 · V" :append-to="root" :show-after="350"><button type="button" aria-label="选择批次" :aria-pressed="interaction === 'select'" @click="interaction = 'select'"><ElIcon><Pointer /></ElIcon></button></ElTooltip>
        <ElTooltip content="平移画布 · H" :append-to="root" :show-after="350"><button type="button" aria-label="平移画布" :aria-pressed="interaction === 'pan'" @click="interaction = 'pan'"><ElIcon><Rank /></ElIcon></button></ElTooltip>
      </div>
      <div class="tool-group">
        <button type="button" aria-label="缩小画布" @click="chart?.zoom(-1)"><ElIcon><ZoomOut /></ElIcon></button>
        <ElTooltip :content="`还原视图 · 0（${zoom.toLocaleString()}%）`" :append-to="root"><button type="button" class="zoom-level" aria-label="还原画布" @click="chart?.zoom(0)">{{ zoomLabel }}%</button></ElTooltip>
        <button type="button" aria-label="放大画布" @click="chart?.zoom(1)"><ElIcon><ZoomIn /></ElIcon></button>
      </div>
      <div class="tool-group">
        <ElTooltip :content="motion ? '关闭动画' : '启用动画'" :append-to="root"><button type="button" :aria-label="motion ? '关闭动画' : '启用动画'" :aria-pressed="motion" @click="motion = !motion"><ElIcon><VideoPause v-if="motion" /><VideoPlay v-else /></ElIcon></button></ElTooltip>
        <ElTooltip content="重新绘制" :append-to="root"><button type="button" aria-label="重播收发路径" :disabled="!motion" @click="replay++"><ElIcon><RefreshRight /></ElIcon></button></ElTooltip>
        <button type="button" :aria-label="fullscreen ? '退出全屏' : '全屏画布'" @click="toggleFullscreen"><ElIcon><FullScreen /></ElIcon></button>
      </div>
    </div>
    <footer class="timeline-caption"><span>{{ example ? '演示快照 · 非实时 · ' : '' }}图示截至 {{ traceTime(model.closing) }}<template v-if="model.rows.length > 4"> · {{ model.rows.length }} 个接收批次</template></span><span>{{ fullscreenError || '滚轮缩放 · 拖动平移 · 点击节点查看批次' }}</span></footer>
  </section>
</template>

<style scoped>
.team-timeline { position: relative; display: flex; flex-direction: column; height: max(580px, calc(100dvh - 225px)); min-width: 0; border: 1px solid #e1e5ef; border-radius: 10px; background: #fff; color: #26354d; }
.team-timeline:fullscreen { width: 100%; height: 100dvh; border: 0; border-radius: 0; }
.timeline-legend { display: flex; align-items: center; justify-content: flex-end; gap: 22px; min-height: 42px; padding: 10px 24px 0; flex-shrink: 0; }
.timeline-legend .el-select { width: 210px; margin-right: auto; }
.node-legend, .node-legend span { display: flex; align-items: center; gap: 9px; }
.node-legend { gap: 24px; color: #657493; font-size: 13px; white-space: nowrap; }
.node-legend .marker { box-sizing: border-box; width: 12px; height: 12px; border: 2px solid #8670b6; border-radius: 50%; }
.node-legend .received { background: #8670b6; }.node-legend .el-icon { color: #cc3a66; font-size: 17px; }
.timeline-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; }.timeline-scroll :deep(.flow-canvas) { min-height: 0; min-width: 760px; height: 100%; }
.timeline-empty { flex: 1; display: grid; place-items: center; padding: 24px; color: #76849b; }
.timeline-controls { display: flex; align-items: center; gap: 10px; padding: 6px 8px; margin: 0 auto 12px; border: 1px solid #e0e5ee; border-radius: 16px; box-shadow: 0 4px 18px #263c6010; background: #ffffffed; }
.tool-group { display: flex; align-items: center; gap: 1px; }.tool-group + .tool-group { border-left: 1px solid #e5e9f1; padding-left: 10px; }
.timeline-controls button { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 9px; background: transparent; color: #344665; cursor: pointer; font: inherit; font-size: 16px; }
.timeline-controls .zoom-level { width: 64px; font-size: 14px; font-variant-numeric: tabular-nums; }.timeline-controls .el-icon { font-size: 19px; }
.timeline-controls button:hover { background: #f0f2f7; }.timeline-controls button:focus-visible { outline: 2px solid #8a70d4; outline-offset: 1px; }.timeline-controls button:disabled { opacity: .35; cursor: default; }
.tool-mode { position: relative; }.tool-mode::before { position: absolute; left: 0; top: 0; content: ''; width: 40px; height: 40px; border-radius: 9px; background: #edf0f5; transition: transform .16s ease; }.tool-mode.panning::before { transform: translateX(41px); }.tool-mode button { position: relative; }
.timeline-caption { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 18px; padding: 0 18px 14px; color: #73819c; font-size: 12px; line-height: 20px; }
@media(max-width: 760px) { .team-timeline { height: 640px; }.timeline-legend { flex-wrap: wrap; gap: 8px; padding-inline: 14px; }.node-legend { gap: 14px; }.timeline-controls { gap: 3px; padding: 5px; }.timeline-controls button { width: 32px; height: 40px; }.timeline-controls .zoom-level { width: 48px; }.tool-group + .tool-group { padding-left: 3px; }.tool-mode::before { width: 32px; }.tool-mode.panning::before { transform: translateX(33px); } }
@media(prefers-reduced-motion: reduce) { .tool-mode::before { transition: none; } }
</style>

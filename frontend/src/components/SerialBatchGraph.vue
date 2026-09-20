<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElButton, ElCheckbox } from 'element-plus'
import { RefreshRight, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { materialTraceGraph, traceNodeSize } from '@/utils/materialTraceGraph'
import { historyNumber as num, purposePalette } from '@/utils/serialHistoryChart'
import { materialSourceLabel, materialTypeLabel, materialTransferStatusLabel, isExternalTransfer } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'
import type { TraceBatch } from '@/types/materialTrace'
import type { CalendarRange } from '@/types/recordFilters'

const props = defineProps<{ items: TraceBatch[]; dates: CalendarRange; focusTeam?: number | null }>()
const emit = defineEmits<{ select: [batch: TraceBatch] }>()
const showVoided = ref(false), scale = ref(1), replay = ref(0)
const viewport = ref<HTMLElement>()
const graph = computed(() => materialTraceGraph(props.items.filter(row => showVoided.value || row.status !== 'voided')))
const voidedCount = computed(() => props.items.filter(row => row.status === 'voided').length)
const color = (batch: TraceBatch) => batch.status === 'voided' ? '#97a2b4' : colors.value.get(batch.purpose_name || '未分类')
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
function dimmed(batch: TraceBatch) {
  if (props.focusTeam && Number(batch.next_team.id) !== props.focusTeam && Number(batch.source_team.id) !== props.focusTeam) return true
  if (!props.dates.from && !props.dates.to) return false
  const at = new Date(batch.transferred_at)
  if (!Number.isFinite(at.getTime())) return true
  const day = dayFormat.format(at)
  return Boolean(props.dates.from && day < props.dates.from || props.dates.to && day > props.dates.to)
}
const purposes = computed(() => [...new Set(props.items.filter(row => row.status !== 'voided').map(row => row.purpose_name || '未分类'))])
const colors = computed(() => purposePalette(purposes.value))
watch(() => props.focusTeam, async team => {
  if (!team) return
  await nextTick()
  const node = graph.value.nodes.find(node => Number(node.batch.next_team.id) === team && (node.batch.on_hand_quantity || node.batch.on_hand_weight))
  if (node && viewport.value) viewport.value.scrollTo({
    left: node.x * scale.value - (viewport.value.clientWidth - traceNodeSize.width * scale.value) / 2,
    top: node.y * scale.value - (viewport.value.clientHeight - traceNodeSize.height * scale.value) / 2,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
})
</script>

<template>
  <section class="batch-graph" aria-label="流水号真实批次全链路">
    <header class="graph-toolbar"><div class="graph-legend"><span v-for="purpose in purposes" :key="purpose"><i :style="{ background: colors.get(purpose) }" />{{ purpose }}</span></div><div class="graph-tools"><ElCheckbox v-if="voidedCount" v-model="showVoided">作废 {{ voidedCount }}</ElCheckbox><ElButton :icon="ZoomOut" aria-label="缩小链路" :disabled="scale <= .6" text @click="scale = Math.max(.6, scale - .1)" /><button class="graph-scale" @click="scale = 1">{{ Math.round(scale * 100) }}%</button><ElButton :icon="ZoomIn" aria-label="放大链路" :disabled="scale >= 1.3" text @click="scale = Math.min(1.3, scale + .1)" /><ElButton :icon="RefreshRight" text @click="replay++">重播</ElButton></div></header>
    <div v-if="graph.nodes.length" ref="viewport" class="graph-viewport" :style="{ maxHeight: graph.height * scale > 1000 ? 'min(76vh, 900px)' : undefined }" tabindex="0" aria-label="批次链路画布，可横向和纵向滚动">
      <div :style="{ width: `${graph.width * scale}px`, height: `${graph.height * scale}px`, minWidth: '100%' }">
        <div :style="{ width: `${graph.width * scale}px`, height: `${graph.height * scale}px`, marginInline: 'auto' }">
        <div :key="replay" class="graph-canvas" :style="{ width: `${graph.width}px`, height: `${graph.height}px`, transform: `scale(${scale})` }">
          <svg :width="graph.width" :height="graph.height" class="graph-connections" aria-hidden="true">
            <defs><mask v-for="edge in graph.edges" :id="`trace-reveal-${edge.target.batch.id}`" :key="edge.target.batch.id" maskUnits="userSpaceOnUse" x="0" y="0" :width="graph.width" :height="graph.height"><path :d="edge.path" pathLength="1" stroke="white" stroke-width="8" fill="none" class="edge-reveal" :style="{ animationDelay: `${Math.min(edge.source.depth * 100, 600)}ms` }" /></mask></defs>
            <path v-for="edge in graph.edges" :key="edge.target.batch.id" :d="edge.path" fill="none" :stroke="color(edge.target.batch)" stroke-width="2" :stroke-dasharray="edge.target.batch.status === 'pending' ? '6 5' : undefined" :opacity="dimmed(edge.target.batch) ? .15 : .5" :mask="`url(#trace-reveal-${edge.target.batch.id})`" />
          </svg>
          <button v-for="node in graph.nodes" :key="node.batch.id" class="batch-node" :class="{ dimmed: dimmed(node.batch), voided: node.batch.status === 'voided', pending: node.batch.status === 'pending' }" :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${traceNodeSize.width}px`, height: `${traceNodeSize.height}px`, '--batch-color': color(node.batch), '--node-delay': `${Math.min(node.depth * 100, 600)}ms` }" :aria-label="`${node.batch.batch_no}，${node.batch.next_team.name}，${node.batch.quantity}件，${node.batch.weight}kg，${materialTransferStatusLabel(node.batch.status, node.batch.entry_kind)}`" @click="emit('select', node.batch)">
            <span class="batch-node__top"><span :title="node.batch.batch_no">{{ node.batch.batch_no }}</span><i :class="node.batch.status">{{ materialTransferStatusLabel(node.batch.status, node.batch.entry_kind) }}</i></span>
            <strong class="batch-node__team" :title="node.batch.next_team.name">{{ node.batch.next_team.name }}</strong>
            <span class="batch-node__purpose"><b>{{ node.batch.purpose_name || materialTypeLabel(node.batch.material_type) }}</b><span v-if="!node.batch.source_transfer_id" :title="materialSourceLabel(node.batch)">{{ node.detached ? '来源未关联' : materialSourceLabel(node.batch) }}</span></span>
            <span class="batch-node__amount">{{ num(node.batch.quantity) }} <small>件</small><i>/</i>{{ num(node.batch.weight) }} <small>kg</small></span>
            <span class="batch-node__balance" v-if="node.batch.on_hand_quantity !== null">结存 <b>{{ num(node.batch.on_hand_quantity) }} 件 / {{ num(node.batch.on_hand_weight || 0) }} kg</b></span>
            <span class="batch-node__balance" v-else>{{ node.batch.status === 'voided' ? '已撤销，不占用库存' : isExternalTransfer(node.batch) ? `外部去向 · ${node.batch.external_destination}` : node.batch.status === 'pending' ? '已转出，尚未接收' : '历史批次，未纳入库存' }}</span>
            <span class="batch-node__footer"><time>{{ formatDateTime(node.batch.transferred_at) }}</time><b v-if="node.batch.loss_records?.length" class="node-loss">丢失 {{ num(node.batch.loss_records.reduce((sum, loss) => sum + loss.quantity, 0)) }} 件 / {{ num(node.batch.loss_records.reduce((sum, loss) => sum + loss.weight, 0)) }} kg</b></span>
          </button>
        </div>
        </div>
      </div>
    </div>
    <div v-else class="graph-empty">暂无有效批次<span v-if="voidedCount">，可勾选「作废」查看历史单据。</span></div>
    <footer class="graph-caption"><span>实线：已确认 · 虚线：待确认 · 点击批次查看单据及丢失记录</span><span>{{ dates.from || dates.to || focusTeam ? '已高亮所选范围，保留完整来源链路' : '每个节点为独立批次，分支表示拆批，重复班组表示回流' }}</span></footer>
  </section>
</template>

<style scoped>
.batch-graph { border: 1px solid #e0e5ee; background: #fff; border-radius: 12px; overflow: hidden; }
.graph-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 15px 24px; border-bottom: 1px solid #e8edf4; }
.graph-legend, .graph-tools { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }.graph-legend { color: #55667e; font-size: 14px; flex: 1; }.graph-legend > span { display: inline-flex; align-items: center; gap: 7px; }.graph-legend i { width: 18px; height: 3px; border-radius: 2px; }.graph-tools { gap: 4px; }.graph-tools :deep(.el-button) { margin: 0; color: #52617a; }.graph-scale { border: 0; padding: 6px; background: none; font: inherit; font-size: 14px; color: #58657c; cursor: pointer; }
.graph-viewport { min-height: 360px; overflow: auto; background: radial-gradient(circle, #c8d2e050 .7px, transparent 1px) 0 0 / 22px 22px, #f8fafd; scrollbar-width: thin; scrollbar-color: #c7cdda transparent; }
.graph-canvas { position: relative; transform-origin: 0 0; }.graph-connections { position: absolute; inset: 0; pointer-events: none; }
.edge-reveal { stroke-dasharray: 1; animation: trace-edge-draw 1000ms ease-out both; }
.batch-node { box-sizing: border-box; position: absolute; display: flex; flex-direction: column; gap: 7px; border: 1px solid #dce2ed; border-top: 3px solid var(--batch-color); border-radius: 10px; background: #fff; box-shadow: 0 4px 12px #29426409; text-align: left; padding: 14px 16px; color: #1f2e46; cursor: pointer; font: inherit; animation: trace-node-enter .45s var(--node-delay) both; transition: box-shadow .2s, border-color .2s; }.batch-node:hover { border-color: var(--batch-color); box-shadow: 0 4px 20px #29426419; }.batch-node:focus-visible { outline: 3px solid var(--batch-color); outline-offset: 3px; }.batch-node.dimmed { background: #fafbfd; color: #8e98a8; opacity: .45; }.batch-node.voided { border-top-color: #a4abba; }.batch-node.pending { border-right-style: dashed; border-bottom-style: dashed; border-left-style: dashed; }
.batch-node__top { display: flex; align-items: center; gap: 6px; color: #78869a; font-size: 11px; letter-spacing: .015em; }.batch-node__top > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }.batch-node__top i { font-size: 11px; font-style: normal; flex-shrink: 0; padding: 2px 4px; border-radius: 3px; background: #edf6f2; color: #318269; }.batch-node__top .pending { background: #fff4e5; color: #a97023; }.batch-node__top .voided { background: #f0f1f5; color: #7e8798; }
.batch-node__team { display: block; font-size: 21px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.batch-node__purpose { display: flex; gap: 8px; font-size: 13px; color: #7b889c; white-space: nowrap; min-height: 18px; }.batch-node__purpose b { font-weight: 500; color: var(--batch-color); flex-shrink: 0; max-width: 125px; overflow: hidden; text-overflow: ellipsis; }.batch-node__purpose > span { overflow: hidden; text-overflow: ellipsis; }
.batch-node > span, .batch-node > strong { flex-shrink: 0; }.batch-node__top { font-size: 12px; }
.batch-node__amount { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.3; }.batch-node__amount small { font-size: 12px; font-weight: 400; color: #6d7c92; }.batch-node__amount i { font-size: 16px; color: #bdc5d2; font-style: normal; font-weight: 400; margin-inline: 7px; }
.batch-node__balance { font-size: 12px; color: #7b889b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.batch-node__balance b { font-weight: 500; color: #53667e; margin-left: 5px; }
.batch-node__footer { display: grid; gap: 3px; margin-top: auto; padding-top: 6px; border-top: 1px solid #f0f2f6; font-size: 11px; color: #8a95a7; }.node-loss { font-size: 11px; font-weight: 500; color: #ba5265; }.graph-caption { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 15px 24px; color: #748199; font-size: 13px; line-height: 1.7; }.graph-empty { padding: 80px 24px; color: #79869b; text-align: center; }
@keyframes trace-edge-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes trace-node-enter { from { opacity: 0; } to { opacity: 1; } }
.batch-node.dimmed { animation: none; }
@media(prefers-reduced-motion: reduce) { .edge-reveal, .batch-node { animation: none; }.batch-node { transition: none; } }
</style>

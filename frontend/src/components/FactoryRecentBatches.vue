<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElTag } from 'element-plus'
import type { FactoryRecentBatch } from '@/types/factoryOverview'
import { dispatchStatusLabel } from '@/types/teamMaterials'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ rows: FactoryRecentBatch[]; motion: boolean }>()
const emit = defineEmits<{ open: [row: FactoryRecentBatch] }>()
const start = ref(0), cycle = ref(0), paused = ref(false), hovered = ref(false), focused = ref(false)
const scrollable = computed(() => props.rows.length > 3)
const playing = computed(() => scrollable.value && props.motion && !paused.value && !hovered.value && !focused.value)
const visible = computed(() => scrollable.value
  ? Array.from({ length: 4 }, (_, index) => props.rows[(start.value + index) % props.rows.length]!)
  : props.rows)
watch(() => props.rows.map(row => row.batch_no).join('|'), () => { start.value = 0; cycle.value++ })
function move(direction: number) {
  start.value = (start.value + direction + props.rows.length) % props.rows.length
  cycle.value++
}
function advance() {
  if (playing.value) start.value = (start.value + 1) % props.rows.length
}
function focusOut(event: FocusEvent) {
  focused.value = (event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)
}
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const label = (row: FactoryRecentBatch) => row.entry_kind === 'warehouse_receipt' ? '已入库' : dispatchStatusLabel(row.status, row.entry_kind)
</script>
<template>
  <section class="factory-recent" aria-label="近期转料动态" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <header><h2>近期转料动态</h2><div class="recent-actions"><div v-if="scrollable" class="recent-pagination"><ElButton text aria-label="上一条近期转料" @click="move(-1)">上一条</ElButton><small>{{ start + 1 }} / {{ rows.length }}</small><ElButton text aria-label="下一条近期转料" @click="move(1)">下一条</ElButton><ElButton text :disabled="!motion" :aria-label="paused || !motion ? '播放近期转料' : '暂停近期转料'" @click="paused = !paused">{{ paused || !motion ? '播放' : '暂停' }}</ElButton></div><slot name="actions" /></div></header>
    <div v-if="!rows.length" class="recent-empty">暂无转料记录</div>
    <div v-else class="recent-table-scroll" tabindex="0" role="region" aria-label="近期转料表格" @focusin="focused = true" @focusout="focusOut">
      <div class="recent-table-window">
        <table class="recent-table">
          <thead><tr><th scope="col">批次号</th><th scope="col">来源</th><th scope="col">去向</th><th scope="col" class="recent-number">件数</th><th scope="col" class="recent-number">重量 <span>(kg)</span></th><th scope="col">状态</th><th scope="col">更新时间</th></tr></thead>
          <tbody :key="cycle" :class="{ 'recent-rolling': scrollable && motion }" :style="{ animationPlayState: playing ? 'running' : 'paused' }" @animationiteration.self="advance"><tr v-for="(row, index) in visible" :key="row.batch_no" :aria-hidden="index === 3 ? true : undefined" :inert="index === 3">
            <td><ElButton link type="primary" @click="emit('open', row)">{{ row.batch_no }}</ElButton></td>
            <td><span class="recent-location" :title="row.source_name || '库房手工入库'">{{ row.source_name || '库房手工入库' }}</span></td>
            <td><span class="recent-location" :title="row.target_name || row.external_destination || '—'">{{ row.target_name || row.external_destination || '—' }}</span></td>
            <td class="recent-number">{{ format(row.quantity) }}</td><td class="recent-number">{{ format(row.weight) }}</td>
            <td><ElTag size="small" :type="row.status === 'voided' ? 'info' : row.status === 'pending' || row.status === 'partial' ? 'warning' : 'success'">{{ label(row) }}</ElTag></td>
            <td><time :datetime="row.updated_at">{{ formatDateTime(row.updated_at) }}</time></td>
          </tr></tbody>
        </table>
      </div>
    </div>
  </section>
</template>
<style scoped>
.factory-recent { --recent-row-height: 46px; --recent-head-height: 36px; flex-shrink: 0; overflow: hidden; border: 1px solid var(--dashboard-line); border-radius: var(--card-radius, 12px); background: var(--dashboard-surface); }.factory-recent > header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 20px; }.factory-recent h2 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 550; }.recent-actions, .recent-pagination { display: flex; align-items: center; gap: 12px; }.recent-pagination { gap: 6px; }.recent-actions :deep(.el-button) { font-size: 12px; height: 26px; }.recent-pagination .el-button { padding: 4px 8px; }.recent-pagination small { color: var(--dashboard-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.recent-table-scroll { overflow-x: auto; }.recent-table-window { min-width: 800px; height: calc(var(--recent-head-height) + 3 * var(--recent-row-height)); overflow: hidden; }.recent-table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 13px; }.recent-table thead { position: relative; z-index: 1; }.recent-table th { height: var(--recent-head-height); white-space: nowrap; padding: 8px 16px; background: #f7f9f8; color: var(--dashboard-muted); font-size: 12px; line-height: 18px; font-weight: 400; text-align: left; border-block: 1px solid var(--line-light); }.recent-table th:first-child { width: 22%; }.recent-table th:nth-child(4), .recent-table th:nth-child(5) { width: 10%; }.recent-table th:nth-child(6) { width: 11%; }.recent-table th:last-child { width: 18%; }.recent-table td { height: var(--recent-row-height); padding: 8px 16px; border-bottom: 1px solid var(--line-light); line-height: 22px; }.recent-table tbody tr { transition: background 150ms ease; }.recent-table tbody tr:hover { background: var(--table-hover-bg); }.recent-table :is(th, td):first-child { padding-left: 20px; }.recent-table :is(th, td):last-child { padding-right: 20px; }.recent-table .recent-number { text-align: right; font-variant-numeric: tabular-nums; }.recent-table .el-button { font-size: 13px; font-weight: 500; padding: 0; max-width: 100%; }.recent-table :deep(.el-button > span), .recent-location { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.recent-table .el-tag { border: 0; font-size: 12px; }.recent-table time { color: var(--dashboard-muted); font-size: 12px; white-space: nowrap; }.recent-empty { display: grid; min-height: 110px; place-items: center; color: var(--dashboard-muted); font-size: 13px; }
/* Keep three rows in view; the fourth enters as the first slides behind the fixed header. */
.recent-rolling { animation: recent-roll 5s cubic-bezier(.22, .61, .36, 1) infinite; }
@keyframes recent-roll { 0%, 85% { transform: translateY(0); } 100% { transform: translateY(calc(-1 * var(--recent-row-height))); } }
@media (min-width: 1101px) and (max-height: 800px) { .factory-recent { --recent-row-height: 36px; --recent-head-height: 32px; }.factory-recent > header { padding-block: 7px; }.recent-table th { padding-block: 6px; }.recent-table td { padding-block: 5px; } }
@media (min-width: 1101px) and (max-height: 700px) { .factory-recent { --recent-row-height: 32px; --recent-head-height: 28px; }.factory-recent > header { padding-block: 4px; }.recent-table th, .recent-table td { padding-block: 4px; } }
@media (max-width: 640px) { .factory-recent > header { padding: 12px 14px; }.recent-actions { gap: 8px; }.recent-pagination { gap: 2px; }.recent-pagination .el-button { padding-inline: 4px; }.recent-table :is(th, td):first-child { padding-left: 14px; } }
@media (prefers-reduced-motion: reduce) { .recent-rolling { animation: none; } }
</style>

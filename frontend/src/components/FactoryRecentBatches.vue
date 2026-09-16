<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElTag } from 'element-plus'
import type { FactoryRecentBatch } from '@/types/factoryOverview'
import { dispatchStatusLabel } from '@/types/teamMaterials'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ rows: FactoryRecentBatch[]; group: number; motion: boolean }>()
const emit = defineEmits<{ open: [row: FactoryRecentBatch] }>()
const pages = computed(() => Math.max(1, Math.ceil(props.rows.length / 3)))
const page = computed(() => props.group % pages.value)
const visible = computed(() => props.rows.slice(page.value * 3, page.value * 3 + 3))
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const label = (row: FactoryRecentBatch) => row.entry_kind === 'warehouse_receipt' ? '已入库' : dispatchStatusLabel(row.status, row.entry_kind)
</script>
<template>
  <section class="factory-recent" aria-label="近期转料动态">
    <header><h2>近期转料动态</h2><span>最近 {{ rows.length }} 批 · 最新状态</span><small v-if="rows.length">{{ page + 1 }} / {{ pages }}</small></header>
    <div v-if="!rows.length" class="recent-empty">暂无转料记录</div>
    <Transition v-else name="recent-fade" mode="out-in" :css="motion">
      <div :key="page" class="recent-batches">
        <article v-for="row in visible" :key="row.batch_no" class="recent-batch">
          <div><ElButton link type="primary" @click="emit('open', row)">{{ row.batch_no }}</ElButton><ElTag size="small" :type="row.status === 'voided' ? 'info' : row.status === 'pending' || row.status === 'partial' ? 'warning' : 'success'">{{ label(row) }}</ElTag></div>
          <p :title="`${row.source_name || '库房手工入库'} → ${row.target_name || row.external_destination || '—'}`">{{ row.source_name || '库房手工入库' }} <span>→</span> {{ row.target_name || row.external_destination || '—' }}</p>
          <footer><strong>{{ format(row.quantity) }} 件 / {{ format(row.weight) }} kg</strong><time>{{ formatDateTime(row.updated_at) }}</time></footer>
        </article>
      </div>
    </Transition>
  </section>
</template>
<style scoped>
.factory-recent { flex-shrink: 0; border-top: 1px solid var(--dashboard-line); padding-top: 12px; }.factory-recent > header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }.factory-recent h2 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; }.factory-recent header > span, .factory-recent small { color: var(--dashboard-muted); font-size: 12px; }.factory-recent small { margin-left: auto; }.recent-batches { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }.recent-batch { min-width: 0; }.recent-batch > div, .recent-batch footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.recent-batch .el-button { height: 22px; max-width: 70%; font-size: 12px; padding: 0; }.recent-batch :deep(.el-button > span) { display: block; overflow: hidden; text-overflow: ellipsis; }.recent-batch p { font-size: 13px; line-height: 22px; margin: 3px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.recent-batch p span { color: var(--dashboard-muted); margin: 0 5px; }.recent-batch strong { font-size: 12px; font-weight: 500; white-space: nowrap; }.recent-batch time { color: var(--dashboard-muted); font-size: 11px; white-space: nowrap; }.recent-empty { color: var(--dashboard-muted); font-size: 13px; padding: 16px 0; }
.recent-fade-enter-active, .recent-fade-leave-active { transition: opacity 180ms ease, transform 180ms ease; }.recent-fade-enter-from { opacity: 0; transform: translateY(5px); }.recent-fade-leave-to { opacity: 0; transform: translateY(-5px); }
.factory-overview--screen .factory-recent { padding-top: 16px; }.factory-overview--screen .factory-recent h2 { font-size: 16px; }.factory-overview--screen .recent-batch p, .factory-overview--screen .recent-batch .el-button, .factory-overview--screen .recent-batch strong { font-size: 14px; }.factory-overview--screen .recent-batch time { font-size: 12px; }
@media (max-width: 1200px) { .recent-batches { grid-template-columns: 1fr; gap: 14px; }.recent-batch { padding-bottom: 8px; border-bottom: 1px solid var(--dashboard-line); } }
@media (prefers-reduced-motion: reduce) { .recent-fade-enter-active, .recent-fade-leave-active { transition: none; } }
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElTag } from 'element-plus'
import type { FactoryRecentBatch } from '@/types/factoryOverview'
import { dispatchStatusLabel } from '@/types/teamMaterials'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ rows: FactoryRecentBatch[]; motion: boolean }>()
const emit = defineEmits<{ open: [row: FactoryRecentBatch] }>()
const pages = computed(() => Math.max(1, Math.ceil(props.rows.length / 3)))
const page = ref(0)
watch(pages, value => { page.value = Math.min(page.value, value - 1) })
const visible = computed(() => props.rows.slice(page.value * 3, page.value * 3 + 3))
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const label = (row: FactoryRecentBatch) => row.entry_kind === 'warehouse_receipt' ? '已入库' : dispatchStatusLabel(row.status, row.entry_kind)
</script>
<template>
  <section class="factory-recent" aria-label="近期转料动态">
    <header><h2>近期转料动态</h2><div class="recent-actions"><div v-if="pages > 1" class="recent-pagination"><ElButton text :disabled="page === 0" aria-label="上一组近期转料" @click="page--">上一组</ElButton><small>{{ page + 1 }} / {{ pages }}</small><ElButton text :disabled="page === pages - 1" aria-label="下一组近期转料" @click="page++">下一组</ElButton></div><slot name="actions" /></div></header>
    <div v-if="!rows.length" class="recent-empty">暂无转料记录</div>
    <Transition v-else name="recent-fade" :mode="motion ? 'out-in' : undefined" :css="motion">
      <div :key="page" class="recent-table-scroll" tabindex="0" role="region" aria-label="近期转料表格">
        <table class="recent-table">
          <thead><tr><th scope="col">批次号</th><th scope="col">来源</th><th scope="col">去向</th><th scope="col" class="recent-number">件数</th><th scope="col" class="recent-number">重量 <span>(kg)</span></th><th scope="col">状态</th><th scope="col">更新时间</th></tr></thead>
          <tbody><tr v-for="row in visible" :key="row.batch_no">
            <td><ElButton link type="primary" @click="emit('open', row)">{{ row.batch_no }}</ElButton></td>
            <td><span class="recent-location" :title="row.source_name || '库房手工入库'">{{ row.source_name || '库房手工入库' }}</span></td>
            <td><span class="recent-location" :title="row.target_name || row.external_destination || '—'">{{ row.target_name || row.external_destination || '—' }}</span></td>
            <td class="recent-number">{{ format(row.quantity) }}</td><td class="recent-number">{{ format(row.weight) }}</td>
            <td><ElTag size="small" :type="row.status === 'voided' ? 'info' : row.status === 'pending' || row.status === 'partial' ? 'warning' : 'success'">{{ label(row) }}</ElTag></td>
            <td><time :datetime="row.updated_at">{{ formatDateTime(row.updated_at) }}</time></td>
          </tr></tbody>
        </table>
      </div>
    </Transition>
  </section>
</template>
<style scoped>
.factory-recent { flex-shrink: 0; overflow: hidden; border: 1px solid var(--dashboard-line); border-radius: var(--card-radius, 12px); background: var(--dashboard-surface); }.factory-recent > header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 20px; }.factory-recent h2 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 550; }.recent-actions, .recent-pagination { display: flex; align-items: center; gap: 12px; }.recent-pagination { gap: 6px; }.recent-actions :deep(.el-button) { font-size: 12px; height: 26px; }.recent-pagination .el-button { padding: 4px 8px; }.recent-pagination small { color: var(--dashboard-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.recent-table-scroll { overflow-x: auto; min-height: 173px; }.recent-table { width: 100%; min-width: 800px; border-collapse: collapse; table-layout: fixed; font-size: 13px; }.recent-table th { padding: 8px 16px; background: #f7f9f8; color: var(--dashboard-muted); font-size: 12px; line-height: 18px; font-weight: 400; text-align: left; border-block: 1px solid var(--line-light); }.recent-table th:first-child { width: 22%; }.recent-table th:nth-child(4), .recent-table th:nth-child(5) { width: 10%; }.recent-table th:nth-child(6) { width: 11%; }.recent-table th:last-child { width: 18%; }.recent-table td { height: 46px; padding: 8px 16px; border-bottom: 1px solid var(--line-light); line-height: 22px; }.recent-table tbody tr:last-child td { border-bottom: 0; }.recent-table tbody tr { transition: background 150ms ease; }.recent-table tbody tr:hover { background: var(--table-hover-bg); }.recent-table :is(th, td):first-child { padding-left: 20px; }.recent-table :is(th, td):last-child { padding-right: 20px; }.recent-table .recent-number { text-align: right; font-variant-numeric: tabular-nums; }.recent-table .el-button { font-size: 13px; font-weight: 500; padding: 0; max-width: 100%; }.recent-table :deep(.el-button > span), .recent-location { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.recent-table .el-tag { border: 0; font-size: 12px; }.recent-table time { color: var(--dashboard-muted); font-size: 12px; white-space: nowrap; }.recent-empty { display: grid; min-height: 110px; place-items: center; color: var(--dashboard-muted); font-size: 13px; }
.recent-fade-enter-active, .recent-fade-leave-active { transition: opacity 180ms ease, transform 180ms ease; }.recent-fade-enter-from { opacity: 0; transform: translateY(5px); }.recent-fade-leave-to { opacity: 0; transform: translateY(-5px); }
@media (min-width: 1101px) and (max-height: 800px) { .factory-recent > header { padding-block: 7px; }.recent-table-scroll { min-height: 139px; }.recent-table th { padding-block: 6px; }.recent-table td { height: 36px; padding-block: 5px; } }
@media (min-width: 1101px) and (max-height: 700px) { .factory-recent > header { padding-block: 4px; }.recent-table-scroll { min-height: 123px; }.recent-table th, .recent-table td { padding-block: 4px; }.recent-table td { height: 32px; } }
@media (max-width: 640px) { .factory-recent > header { padding: 12px 14px; }.recent-actions { gap: 8px; }.recent-pagination { gap: 2px; }.recent-pagination .el-button { padding-inline: 4px; }.recent-table :is(th, td):first-child { padding-left: 14px; } }
@media (prefers-reduced-motion: reduce) { .recent-fade-enter-active, .recent-fade-leave-active { transition: none; } }
</style>

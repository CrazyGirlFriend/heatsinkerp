<script setup lang="ts">
import type { TraceBatch } from '@/types/materialTrace'
import { isExternalTransfer, materialSourceLabel, materialTypeLabel, materialTransferStatusLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'
import { historyNumber as num } from '@/utils/serialHistoryChart'

defineProps<{ batch: TraceBatch | null; origin?: TraceBatch; example?: boolean }>()
defineEmits<{ open: [code: string] }>()
</script>

<template>
  <section class="trace-detail" aria-label="选中批次收发详情" aria-live="polite">
    <template v-if="batch">
      <header><strong>{{ materialSourceLabel(batch) }} → {{ batch.next_team.name }}</strong><span class="detail-status" :class="{ pending: batch.status === 'pending' }">{{ materialTransferStatusLabel(batch.status, batch.entry_kind) }}</span><span class="detail-batch">{{ batch.batch_no }}</span><button v-if="!example" type="button" @click="$emit('open', batch.batch_no)">查看单据</button></header>
      <dl>
        <div><dt>本次物料</dt><dd>{{ num(batch.quantity) }} 件 / {{ num(batch.weight) }} kg</dd></div>
        <div><dt>物料性质</dt><dd>{{ materialTypeLabel(batch.material_type) }}</dd></div>
        <div><dt>{{ batch.entry_kind === 'serial_reallocation' ? '转投时间' : batch.entry_kind === 'warehouse_receipt' ? '入库时间' : batch.entry_kind === 'opening_stock' ? '登记时间' : '转出时间' }}</dt><dd>{{ formatDateTime(batch.transferred_at) }}</dd></div>
        <div v-if="!['warehouse_receipt', 'opening_stock', 'serial_reallocation'].includes(batch.entry_kind || '')"><dt>{{ isExternalTransfer(batch) ? '对外确认' : '签收时间' }}</dt><dd>{{ batch.status === 'pending' ? '待确认' : formatDateTime(isExternalTransfer(batch) ? batch.dispatched_at : batch.received_at) }}</dd></div>
        <div><dt>来源批次</dt><dd>{{ origin?.entry_kind === 'warehouse_receipt' ? origin.batch_no : '未关联库房入库批次' }}</dd></div>
        <div><dt>上一批次</dt><dd>{{ batch.source_transfer_batch_no || '—' }}</dd></div>
        <div v-if="batch.entry_kind === 'serial_reallocation'"><dt>原流水号</dt><dd>{{ batch.source_serial_no || '—' }}</dd></div>
        <div v-if="batch.purpose_name"><dt>接收业务</dt><dd>{{ batch.purpose_name }}</dd></div>
      </dl>
      <p v-if="batch.status === 'pending'">待确认的 {{ num(batch.weight) }} kg 仍计入{{ batch.source_team.name }}库存，已占用可转额度。</p>
    </template>
    <div v-else class="detail-empty">点击图中节点，查看本次收发、来源批次和上一批次</div>
  </section>
</template>

<style scoped>
.trace-detail { flex-shrink: 0; margin-top: 8px; padding: 13px 16px; border: 1px solid var(--line); border-radius: 9px; background: var(--workspace-bg); font-size: 12px; }
header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }header strong { font-weight: 600; font-size: 14px; }.detail-status { padding: 3px 7px; border-radius: 4px; color: var(--primary); background: var(--surface-soft); }.detail-status.pending { color: #946d30; background: #faf2e4; }.detail-batch { margin-left: auto; color: var(--muted); }button { border: 0; background: transparent; color: var(--primary); font: inherit; cursor: pointer; }
dl { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 10px 0 0; }dl > div { display: flex; gap: 8px; min-width: 0; }dt { color: var(--muted); white-space: nowrap; }dd { margin: 0; color: var(--text); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }p { margin: 8px 0 0; color: #946d30; }.detail-empty { color: var(--muted); padding: 8px 0; text-align: center; }
@media (max-width: 700px) { .detail-batch { margin-left: 0; }dl { display: grid; grid-template-columns: 1fr; } }
</style>

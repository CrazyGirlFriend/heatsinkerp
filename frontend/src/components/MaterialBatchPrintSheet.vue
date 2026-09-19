<script setup lang="ts">
import { computed } from 'vue'
import BarcodeCard from './BarcodeCard.vue'
import { materialDocumentTextFields, materialTypeLabel, materialTransferStatusLabel, materialSourceLabel, isExternalEntryKind, type MaterialTransfer } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ items: MaterialTransfer[] }>()
const opening = computed(() => props.items.length > 0 && props.items.every(item => item.entry_kind === 'opening_stock'))
const totals = computed(() => props.items.filter(item => item.status !== 'voided').reduce((sum, item) => ({ quantity: sum.quantity + item.quantity, weight: Math.round((sum.weight + item.weight) * 1000) / 1000 }), { quantity: 0, weight: 0 }))
function details(item: MaterialTransfer) {
  return [`转料用途：${item.purpose_name || '未分类'}`, ...materialDocumentTextFields.filter(field => item[field.key]).map(field => `${field.label}：${item[field.key]}`),
    ...(item.finished_quantity != null ? [`成品件数：${item.finished_quantity}`] : []),
    ...(item.notes ? [`说明：${item.notes}`] : [])].join('；')
}
</script>

<template>
  <article class="material-batches-print-sheet" aria-label="多批次转料打印单">
    <header><h1>{{ opening ? '期初库存入账单' : '物料流转单' }}</h1><span>共 {{ items.length }} 个独立批次</span></header>
    <table aria-label="批次转料明细">
      <colgroup><col style="width: 31%" /><col style="width: 19%" /><col style="width: 19%" /><col style="width: 12%" /><col style="width: 9%" /><col style="width: 10%" /></colgroup>
      <thead><tr><th>批次条码 / 流水号</th><th>材质 / 类型</th><th>{{ opening ? '来源 / 入账班组' : '上序 / 下序' }}</th><th>状态</th><th>件数</th><th>重量 kg</th></tr></thead>
      <tbody v-for="item in items" :key="item.batch_no" :data-batch-no="item.batch_no">
        <tr><td><BarcodeCard :value="item.batch_no" entity-label="批次号" compact /><div>{{ item.serial_no }}</div></td><td>{{ item.material_name || '—' }}<br />{{ materialTypeLabel(item.material_type) }}</td><td>{{ materialSourceLabel(item) }}<br />{{ isExternalEntryKind(item.entry_kind) ? item.external_destination : item.next_team.name }}</td><td>{{ materialTransferStatusLabel(item.status, item.entry_kind) }}</td><td>{{ item.quantity }}</td><td>{{ item.weight }}</td></tr>
        <tr><td colspan="6" class="batch-note">{{ opening ? '登记' : '转出' }}：{{ item.transferred_by || '—' }} · {{ formatDateTime(item.transferred_at) }}；确认：{{ item.received_by || item.dispatched_by || '—' }} · {{ formatDateTime(item.received_at || item.dispatched_at) }}<br v-if="details(item)" />{{ details(item) }}</td></tr>
      </tbody>
      <tfoot><tr><th colspan="4">合计（不含作废批次）</th><td>{{ totals.quantity }}</td><td>{{ totals.weight }}</td></tr></tfoot>
    </table>
    <footer><span>{{ opening ? '登记人' : '转出方' }}签字：________________</span><span>{{ opening ? '班组复核' : '接收 / 确认方' }}签字：________________</span></footer>
  </article>
</template>

<style scoped>
.material-batches-print-sheet { box-sizing: border-box; width: 100%; color: #111; background: #fff; padding: 12px; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 12px; } h1 { margin: 0; font-size: 24px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
th, td { border: 1px solid #444; padding: 6px; text-align: center; overflow-wrap: anywhere; } th { background: #f3f3f3; }
thead { display: table-header-group; } tbody { break-inside: avoid; } tfoot { display: table-row-group; }
.batch-note { text-align: left; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
:deep(.barcode-card) { min-height: 48px; overflow: visible; padding: 0 3mm; box-sizing: border-box; }
:deep(.barcode-card svg) { width: 100%; max-width: 100%; min-width: 0; }
footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 24px; font-size: 12px; break-inside: avoid; }
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  :global(body.material-batches-printing > :not(.material-batches-print-sheet)) { display: none !important; }
  .material-batches-print-sheet { display: block !important; width: 190mm; padding: 0; print-color-adjust: exact; }
  table { font-size: 9pt; } .batch-note { font-size: 8pt; }
}
</style>

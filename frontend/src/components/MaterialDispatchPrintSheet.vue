<script setup lang="ts">
import { computed } from 'vue'
import MaterialDocumentTable from './MaterialDocumentTable.vue'
import BarcodeCard from './BarcodeCard.vue'
import type { MaterialDispatchDocument } from '@/types/teamMaterials'
import { dispatchDocumentTitle, dispatchStatusLabel } from '@/types/teamMaterials'
import { isExternalEntryKind, materialTransferStatusLabel, materialTypeLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ dispatch: MaterialDispatchDocument }>()
const documentFields = computed(() => [
  { label: '转出班组', value: props.dispatch.source_team.name },
  { label: isExternalEntryKind(props.dispatch.entry_kind) ? '外部去向' : '接收班组', value: props.dispatch.next_team.name },
  { label: '登记人', value: props.dispatch.created_by || '—' },
  { label: '创建时间', value: formatDateTime(props.dispatch.created_at) },
  { label: '整批确认人', value: props.dispatch.confirmed_by || '—' },
  { label: '确认时间', value: formatDateTime(props.dispatch.confirmed_at) },
])
</script>

<template>
  <article class="material-dispatch-print-sheet" aria-label="A4 批次汇总单">
    <header class="dispatch-print-heading"><h1>{{ dispatchDocumentTitle(dispatch.entry_kind) }}</h1><strong>{{ dispatch.dispatch_no }}</strong><span>{{ dispatchStatusLabel(dispatch.status, dispatch.entry_kind) }}</span></header>
    <div class="dispatch-print-barcode"><BarcodeCard :value="dispatch.barcode_payload" entity-label="整批出库" compact /><small>Code 128 · 整批条码</small></div>
    <MaterialDocumentTable class="dispatch-print-meta" :fields="documentFields" label="批次单据资料" />
    <table class="dispatch-print-lines">
      <colgroup><col style="width: 6%" /><col style="width: 24%" /><col style="width: 22%" /><col style="width: 15%" /><col style="width: 10%" /><col style="width: 12%" /><col style="width: 11%" /></colgroup>
      <thead><tr><th scope="col">序号</th><th scope="col">流水号</th><th scope="col">材质 / 规格</th><th scope="col">物料类型</th><th scope="col">件数</th><th scope="col">重量 / kg</th><th scope="col">状态</th></tr></thead>
      <tbody><tr v-for="(item, index) in dispatch.items" :key="item.batch_no" :data-line-no="index + 1"><td>{{ index + 1 }}</td><td>{{ item.serial_no }}</td><td>{{ item.material_name || '—' }}<br v-if="item.transfer_specification || item.finished_specification" /><span v-if="item.transfer_specification || item.finished_specification">{{ item.transfer_specification || item.finished_specification }}</span></td><td>{{ materialTypeLabel(item.material_type) }}</td><td>{{ item.quantity }}</td><td>{{ item.weight }}</td><td>{{ item.status === 'pending' ? '待确认' : materialTransferStatusLabel(item.status, item.entry_kind) }}</td></tr></tbody>
      <tfoot><tr><th colspan="4" scope="row">共 {{ dispatch.line_count }} 条物料明细 · 合计不含作废明细</th><td>{{ dispatch.total_quantity }} 件</td><td>{{ dispatch.total_weight }} kg</td><td></td></tr><tr v-if="dispatch.notes"><th scope="row">说明</th><td colspan="6">{{ dispatch.notes }}</td></tr></tfoot>
    </table>
    <footer class="dispatch-print-signatures"><span>转出班组签字：________________</span><span>{{ isExternalEntryKind(dispatch.entry_kind) ? '本班组确认人' : '接收班组' }}签字：________________</span></footer>
  </article>
</template>

<style scoped>
.material-dispatch-print-sheet { display: none; width: 186mm; color: #111; background: white; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 9pt; }
.dispatch-print-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 2mm 5mm; padding-bottom: 3mm; border-bottom: 1pt solid #222; }
.dispatch-print-heading h1 { margin: 0; font-size: 18pt; letter-spacing: .08em; }
.dispatch-print-heading > strong { font-size: 10pt; overflow-wrap: anywhere; }
.dispatch-print-barcode { display: grid; justify-items: center; padding: 3mm 0 2mm; break-inside: avoid; }
.dispatch-print-barcode :deep(.barcode-card) { min-height: 14mm; overflow: visible; }
.dispatch-print-barcode :deep(svg) { max-width: 165mm; }
.dispatch-print-barcode small { font-size: 7pt; }
.dispatch-print-meta { margin: 2mm 0 4mm; }
.dispatch-print-lines { width: 100%; table-layout: fixed; border-collapse: collapse; }
.dispatch-print-lines thead { display: table-header-group; }
.dispatch-print-lines tr { break-inside: avoid; }
.dispatch-print-lines th, .dispatch-print-lines td { border: .6pt solid #333; padding: 1.5mm 1.3mm; font-size: 9pt; line-height: 1.45; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
.dispatch-print-lines th { background: #f1f1f1; }.dispatch-print-lines td:nth-child(5), .dispatch-print-lines td:nth-child(6) { text-align: right; font-variant-numeric: tabular-nums; }
.dispatch-print-lines tfoot { display: table-row-group; }
.dispatch-print-lines tfoot td { text-align: right; font-weight: 600; }
.dispatch-print-lines tfoot tr:last-child td[colspan] { text-align: left; font-weight: 400; }
.dispatch-print-signatures { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 5mm; padding-top: 7mm; break-inside: avoid; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  :global(body.material-dispatch-printing) { background: white !important; }
  :global(body.material-dispatch-printing > :not(.material-dispatch-print-sheet)) { display: none !important; }
  .material-dispatch-print-sheet { display: block !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>

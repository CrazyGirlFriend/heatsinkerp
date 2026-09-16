<script setup lang="ts">
import BarcodeCard from '@/components/BarcodeCard.vue'
import { computed } from 'vue'
import type { MaterialTransfer } from '@/types/materialTransfer'
import { externalActionLabel, isExternalTransfer, isWarehouseReceipt, materialDocumentTitle, materialDocumentTextFields, materialTransferNotesLabel, materialTransferStatusLabel, materialTypeLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ transfer: MaterialTransfer }>()
const receipt = computed(() => isWarehouseReceipt(props.transfer))
const external = computed(() => isExternalTransfer(props.transfer))
const verb = computed(() => externalActionLabel(props.transfer.entry_kind))
const copies = computed(() => external.value ? [{ key: 'source', name: `${verb.value}留存联` }, { key: 'target', name: `${verb.value}凭证联` }] : receipt.value ? [{ key: 'source', name: '库房留存联' }, { key: 'target', name: '入库凭证联' }] : [{ key: 'source', name: '转出留存联' }, { key: 'target', name: '接收确认联' }])
const fields = computed(() => {
  const transfer = props.transfer
  return [
    { label: '流水号', value: transfer.serial_no },
    { label: '状态', value: materialTransferStatusLabel(transfer.status, transfer.entry_kind) },
    { label: '物料类型', value: materialTypeLabel(transfer.material_type) },
    { label: '原单批号', value: transfer.source_batch_no || '—' },
    { label: '材质', value: transfer.material_name || '—' },
    { label: '客户代码', value: transfer.customer_code || '—' },
    { label: '成品规格', value: transfer.finished_specification || '—' },
    { label: '转料规格', value: transfer.transfer_specification || '—' },
    { label: receipt.value ? '入库件数' : external.value ? `${verb.value}件数` : '转料件数', value: `${transfer.quantity} 件` },
    { label: receipt.value ? '入库重量' : external.value ? `${verb.value}重量` : '转料重量', value: `${transfer.weight} kg` },
    { label: '成品件数', value: transfer.finished_quantity == null ? '—' : `${transfer.finished_quantity} 件` },
    { label: receipt.value || external.value ? '登记人' : '转料人', value: transfer.transferred_by || '—' },
    { label: receipt.value ? '入库来源' : external.value ? `${verb.value}班组` : '转出班组', value: transfer.source_team.name },
    { label: receipt.value ? '入库库房' : external.value ? `${verb.value}去向` : '接收班组', value: external.value ? transfer.external_destination || '—' : transfer.next_team.name },
    ...(external.value ? [{ label: `${verb.value}确认人`, value: transfer.dispatched_by || '—' }, { label: `${verb.value}确认时间`, value: formatDateTime(transfer.dispatched_at) }] : []),
    ...materialDocumentTextFields.filter(field => field.group === 'extra' && !field.multiline && transfer[field.key]).map(field => ({ label: field.label, value: transfer[field.key]! })),
  ]
})
const fieldRows = computed(() => Array.from({ length: Math.ceil(fields.value.length / 2) }, (_, index) => fields.value.slice(index * 2, index * 2 + 2)))
const longFields = computed(() => [
  ...materialDocumentTextFields.filter(field => field.multiline && props.transfer[field.key]).map(field => ({ label: field.label, value: props.transfer[field.key]! })),
  { label: materialTransferNotesLabel(props.transfer), value: props.transfer.notes || '无' },
])
const extended = computed(() => fields.value.length > 18 || fields.value.some(field => field.value.length > 40) || longFields.value.reduce((sum, field) => sum + field.value.length, 0) > 220)
</script>

<template>
  <article class="material-transfer-print-sheet" :class="{ 'material-transfer-print-sheet--extended': extended }" :aria-label="external ? `A4 双联${verb}单` : receipt ? 'A4 双联入库单' : 'A4 双联转料单'">
    <section class="material-transfer-print-page">
      <template v-for="copy in copies" :key="copy.key">
        <section class="material-transfer-print-copy" :aria-label="copy.name">
          <header>
            <div><h1>{{ materialDocumentTitle(transfer) }}</h1><span>{{ copy.name }}</span></div>
            <strong>批次号：{{ transfer.batch_no }}</strong>
          </header>

          <div class="print-barcode">
            <BarcodeCard :value="transfer.barcode_payload || transfer.batch_no" compact :entity-label="receipt ? '入库批次号' : external ? `${verb}批次号` : '转料批次号'" />
            <small>Code 128 · {{ transfer.batch_no }}</small>
          </div>

          <table class="print-fields" :aria-label="copy.name + '单据资料'"><colgroup><col style="width: 14%" /><col /><col style="width: 14%" /><col /></colgroup><tbody>
            <tr v-for="(row, index) in fieldRows" :key="index"><template v-for="field in row" :key="field.label"><th scope="row">{{ field.label }}</th><td :colspan="row.length === 1 ? 3 : 1">{{ field.value }}</td></template></tr>
            <tr v-for="field in longFields" :key="field.label" class="print-notes"><th scope="row">{{ field.label }}</th><td colspan="3">{{ field.value }}</td></tr>
          </tbody></table>

          <footer v-if="external"><div><span>登记人签字：________________</span><small>创建时间：{{ formatDateTime(transfer.transferred_at) }}</small></div><div><span>{{ verb }}确认人签字：________________</span><small>确认人：{{ transfer.dispatched_by || '—' }}</small><small>确认时间：{{ formatDateTime(transfer.dispatched_at) }}</small></div></footer>
          <footer v-else-if="receipt"><div><span>登记人签字：________________</span><small>登记人：{{ transfer.transferred_by || '—' }}</small></div><div><span>库房复核签字：________________</span><small>入库时间：{{ formatDateTime(transfer.transferred_at) }}</small></div></footer>
          <footer v-else>
            <div><span>转出方签字：________________</span><small>转料时间：{{ formatDateTime(transfer.transferred_at) }}</small></div>
            <div><span>接收方签字：________________</span><small>接收人：{{ transfer.received_by || '—' }}</small><small>接收时间：{{ formatDateTime(transfer.received_at) }}</small></div>
          </footer>
        </section>
        <div v-if="copy.key === 'source'" class="print-cut"><span>沿虚线裁切</span></div>
      </template>
    </section>
  </article>
</template>

<style scoped>
.material-transfer-print-sheet { display: none; color: #111; background: #fff; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
.material-transfer-print-page { box-sizing: border-box; width: 186mm; }
.material-transfer-print-copy { box-sizing: border-box; min-height: 130mm; padding: 2mm; break-inside: avoid; }
.material-transfer-print-copy header { display: flex; align-items: flex-end; justify-content: space-between; min-height: 13mm; padding: 0 2mm 3mm; border-bottom: 1.2pt solid #111; break-inside: avoid; }
.material-transfer-print-copy header > div { display: flex; align-items: baseline; gap: 4mm; }
.material-transfer-print-copy h1 { margin: 0; font-size: 18pt; letter-spacing: .16em; }
.material-transfer-print-copy header span { padding: .8mm 2mm; border: 1px solid #111; font-size: 8pt; font-weight: 700; }
.material-transfer-print-copy header > strong { font-size: 9pt; }
.print-barcode { display: grid; align-content: center; justify-items: center; height: 22mm; border-right: 1px solid #222; border-bottom: 1px solid #222; border-left: 1px solid #222; break-inside: avoid; }
.print-barcode :deep(.barcode-card) { width: 96mm; min-height: 16mm; overflow: visible; }
.print-barcode :deep(svg) { max-width: 94mm; min-width: 0; }
.print-barcode small { font-size: 6.5pt; }
.print-fields { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 2mm 0 0; }
.print-fields tr { break-inside: avoid; }
.print-fields th, .print-fields td { min-width: 0; padding: 1.1mm 1.5mm; border: 1px solid #222; font-size: 8pt; line-height: 1.5; text-align: left; vertical-align: top; }
.print-fields th { background: #f1f1f1; font-weight: 700; }
.print-fields td { overflow-wrap: anywhere; white-space: pre-wrap; }
.print-fields .print-notes { break-inside: auto; }
.material-transfer-print-copy footer { display: flex; justify-content: space-between; margin-top: 5mm; padding-inline: 3mm; font-size: 8pt; }
.material-transfer-print-copy footer > div { display: grid; gap: 1mm; }
.material-transfer-print-copy footer small { font-size: 7pt; }
.print-cut { display: flex; align-items: center; height: 9mm; border-top: 1px dashed #555; border-bottom: 1px dashed #555; color: #555; }
.print-cut span { margin-inline: auto; padding: 0 3mm; background: #fff; font-size: 7pt; }
.material-transfer-print-sheet--extended .material-transfer-print-copy { min-height: 0; break-inside: auto; break-before: page; }
.material-transfer-print-sheet--extended .material-transfer-print-copy:first-child { break-before: auto; }
.material-transfer-print-sheet--extended .print-cut { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  :global(body.material-transfer-printing) { background: #fff !important; }
  :global(body.material-transfer-printing > :not(.material-transfer-print-sheet)) { display: none !important; }
  .material-transfer-print-sheet { display: block !important; width: 186mm; margin: 0; padding: 0; color: #000; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>

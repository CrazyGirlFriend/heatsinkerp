<script setup lang="ts">
import { computed } from 'vue'
import MaterialDocumentTable, { type DocumentField } from './MaterialDocumentTable.vue'
import { externalActionLabel, isExternalTransfer, isWarehouseReceipt, materialSourceLabel, receiptSourceLabel, materialDocumentTextFields, materialTransferNotesLabel, materialTransferStatusLabel, materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const props = withDefaults(defineProps<{ transfer: MaterialTransfer; group?: 'basic' | 'extra' | 'all' }>(), { group: 'basic' })
const fields = computed<DocumentField[]>(() => {
  const t = props.transfer, receipt = isWarehouseReceipt(t), external = isExternalTransfer(t), verb = externalActionLabel(t.entry_kind)
  const material = [
    { label: '物料类型', value: materialTypeLabel(t.material_type) },
    { label: '成品件数', value: t.finished_quantity == null ? '—' : `${t.finished_quantity} 件` },
    ...materialDocumentTextFields.filter(field => props.group === 'all' ? field.group === 'basic' || t[field.key] : field.group === props.group).map(field => ({ label: field.label, value: t[field.key] || '—', fullWidth: field.multiline })),
  ]
  if (props.group !== 'all') return props.group === 'extra' ? material.slice(2) : material
  return [
    { label: '批次号', value: t.dispatch_no || t.batch_no },
    { label: '状态', value: materialTransferStatusLabel(t.status, t.entry_kind) },
    { label: receipt ? '入库来源' : external ? `${verb}班组` : '转出班组', value: materialSourceLabel(t) },
    { label: receipt ? '入库库房' : external ? `${verb}去向` : '接收班组', value: external ? t.external_destination || '—' : t.next_team.name },
    { label: '流水号', key: 'serial', value: t.serial_no },
    { label: '来源批次', value: t.source_transfer_batch_no || '—' },
    { label: receipt ? '入库件数' : external ? `${verb}件数` : '转料件数', value: `${t.quantity} ${t.quantity_unit}` },
    { label: receipt ? '入库重量' : external ? `${verb}重量` : '转料重量', value: `${t.weight} ${t.weight_unit}` },
    ...material,
    ...(receipt ? [{ label: '入库来源类别', value: receiptSourceLabel(t) }, { label: '原出库批次', value: t.return_dispatch_no || '未关联' }] : []),
    ...(t.rejection_reason ? [{ label: '退回核对原因', value: t.rejection_reason, fullWidth: true }] : []),
    { label: receipt || external ? '登记人' : '转料人', value: t.transferred_by || '—' },
    { label: receipt ? '入库时间' : external ? '创建时间' : '转料时间', value: formatDateTime(t.transferred_at) },
    ...(!receipt ? [
      { label: external ? `${verb}确认人` : '接收人', value: (external ? t.dispatched_by : t.received_by) || '—' },
      { label: external ? `${verb}确认时间` : '接收时间', value: formatDateTime(external ? t.dispatched_at : t.received_at) },
    ] : []),
    ...(t.status === 'voided' ? [{ label: '作废人', value: t.voided_by || '—' }, { label: '作废时间', value: formatDateTime(t.voided_at) }] : []),
    { label: materialTransferNotesLabel(t), value: t.notes || '无', fullWidth: true },
  ]
})
</script>

<template>
  <MaterialDocumentTable :fields="fields" :label="group === 'all' ? '转料单据资料' : group === 'basic' ? '物料明细' : '补充信息'">
    <template #serial="{ field }"><slot name="serial">{{ field.value }}</slot></template>
  </MaterialDocumentTable>
</template>

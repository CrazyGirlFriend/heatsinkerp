<script setup lang="ts">
import { computed } from 'vue'
import { externalActionLabel, isExternalTransfer, materialEntryLabel, materialDocumentTextFields, materialTransferNotesLabel, materialTransferStatusLabel, materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ transfer: MaterialTransfer }>()
const events = computed(() => [...(props.transfer.history ?? [])].sort((left, right) => right.id - left.id))
const actions = { created: '创建转料单', updated: '修改转料单', received: '确认接收', voided: '作废转料单', stocked: '手工入库已入账', dispatched: '确认出库', rejected: '库房退回核对' }
const labels: Record<string, string> = {
  receipt_kind: '入库来源类别', external_source: '外部来源单位', return_dispatch_no: '原出库批次', rejection_reason: '退回核对原因',
  main_system_schema_version: '主系统接口版本', main_system_revision: '主系统资料版本',
  main_system_updated_at: '主系统资料更新时间', main_system_snapshot_hash: '主系统资料校验值',
  ...Object.fromEntries(materialDocumentTextFields.map(field => [field.key, field.label])),
  material_type: '物料类型', finished_quantity: '成品件数', serial_no: '流水号', quantity: '转料件数', weight: '转料重量',
  notes: '备注', source_team_id: '转出班组', next_team_id: '接收班组', status: '状态',
  external_destination: '外部去向', dispatched_by: '确认人', dispatched_at: '确认时间', dispatched_by_user_id: '确认账号',
  entry_kind: '单据类型', stock_tracked: '纳入库存',
  batch_no: '单据批次号', created_by: '登记人', created_at: '登记时间', next_team_code: '接收班组编码', next_team_name: '接收班组',
  received_at: '接收时间', received_by: '接收人', voided_at: '作废时间', voided_by: '作废人', locked: '锁定', version: '版本',
}
function actionLabel(action: keyof typeof actions): string {
  if (isExternalTransfer(props.transfer)) {
    const verb = externalActionLabel(props.transfer.entry_kind)
    return action === 'created' ? `创建${verb}单` : action === 'updated' ? `修改${verb}单` : action === 'dispatched' ? `确认${verb}` : action === 'voided' ? `作废${verb}单` : actions[action]
  }
  return actions[action]
}
function fieldLabel(field: string): string {
  if (isExternalTransfer(props.transfer) && ['quantity', 'weight', 'external_destination', 'dispatched_by', 'dispatched_at'].includes(field)) {
    const suffix: Record<string, string> = { quantity: '件数', weight: '重量', external_destination: '去向', dispatched_by: '确认人', dispatched_at: '确认时间' }
    return externalActionLabel(props.transfer.entry_kind) + suffix[field]
  }
  if (field === 'notes') return materialTransferNotesLabel(props.transfer)
  if (props.transfer.entry_kind === 'warehouse_receipt') {
    const intakeLabels: Record<string, string> = { quantity: '入库件数', weight: '入库重量', source_team_id: '入库来源', next_team_id: '入库库房', next_team_code: '入库库房编码', next_team_name: '入库库房', received_at: '入库时间', received_by: '登记人' }
    if (intakeLabels[field]) return intakeLabels[field]
  }
  return labels[field] || field
}
function valueText(field: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (field === 'entry_kind') return materialEntryLabel(String(value) as MaterialTransfer['entry_kind'])
  if (field === 'material_type') return materialTypeLabel(String(value))
  if (field === 'receipt_kind') return value === 'return' ? '外部退回' : '外部来料'
  if (field === 'status') return materialTransferStatusLabel(String(value), props.transfer.entry_kind)
  if (field.endsWith('_at')) return formatDateTime(String(value))
  if (field === 'quantity' || field === 'finished_quantity') return `${value} 件`
  if (field === 'weight') return `${value} kg`
  if (field === 'source_team_id' && String(value) === String(props.transfer.source_team.id)) return props.transfer.source_team.name
  if (field === 'next_team_id' && String(value) === String(props.transfer.next_team.id)) return props.transfer.next_team.name
  if (field.endsWith('_team_id')) return `班组 ${value}`
  if (typeof value === 'boolean') return value ? '是' : '否'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
</script>

<template>
  <div v-if="events.length" class="history-table-scroll">
    <table class="document-history business-document-table" :aria-label="transfer.entry_kind === 'warehouse_receipt' ? '入库单记录' : '转料单修改记录'">
      <thead><tr><th scope="col">时间</th><th scope="col">操作人</th><th scope="col">操作</th><th scope="col">变更内容</th></tr></thead>
      <tbody><tr v-for="event in events" :key="event.id">
        <td><time :datetime="event.occurred_at">{{ formatDateTime(event.occurred_at) }}</time></td>
        <td>{{ event.actor || '—' }}</td><td>{{ actionLabel(event.action) }}</td>
        <td class="table-prose"><details v-if="Object.keys(event.changes).length"><summary>查看 {{ Object.keys(event.changes).length }} 项变更</summary><dl><div v-for="(change, field) in event.changes" :key="field"><dt>{{ fieldLabel(field) }}</dt><dd><span class="history-before">{{ valueText(field, change.before) }}</span><span aria-label="变更为"> → </span><span>{{ valueText(field, change.after) }}</span></dd></div></dl></details><span v-else>—</span></td>
      </tr></tbody>
    </table>
  </div>
  <p v-else class="history-empty">暂无修改记录</p>
</template>

<style scoped>
.history-table-scroll { min-width: 0; overflow-x: auto; }
.document-history { width: 100%; min-width: 600px; table-layout: fixed; border-collapse: collapse; color: #303133; font-size: 14px; line-height: 1.7; }
.document-history th, .document-history td { padding: 10px 12px; border: 1px solid #cdd3dc; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.document-history th { background: var(--table-header-bg); font-weight: 500; }
.document-history th:nth-child(1) { width: 24%; }
.document-history th:nth-child(2) { width: 16%; }
.document-history th:nth-child(3) { width: 22%; }
.document-history summary { color: var(--primary); cursor: pointer; }
.document-history dl { margin: 10px 0 0; }
.document-history dl > div + div { margin-top: 10px; }
.document-history dt { font-weight: 500; }
.document-history dd { margin: 0; white-space: pre-wrap; }
.history-before { color: #6b7280; }
.history-empty { margin: 0; padding: 12px 0; color: var(--subtle); font-size: 14px; }
</style>

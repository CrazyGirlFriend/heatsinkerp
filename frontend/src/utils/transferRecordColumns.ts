import { processingStateLabels } from '@/types/materialProcessing'
import { teamWorkspaceProfile } from '@/config/teamWorkspaces'
import {
  isExternalEntryKind,
  materialEntryLabel,
  materialPurposeLabel,
  materialSenderName,
  materialSourceLabel,
  materialTransferStatusLabel,
  materialTypeLabel,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

function column<Key extends string>(
  key: Key,
  label: string,
  minWidth: number,
  value: (row: MaterialTransfer) => string | number | null | undefined,
  defaultVisible = false,
  exportKey: string = key,
) {
  return {
    key,
    label,
    minWidth,
    className: `transfer-${key.replaceAll('_', '-')}-cell`,
    defaultVisible,
    exportKey,
    value: (row: MaterialTransfer): string | number => {
      const result = value(row)
      return result == null || (typeof result === 'string' && !result.trim()) ? '—' : result
    },
  }
}

function isInternalTransfer(row: MaterialTransfer) {
  return !row.entry_kind || row.entry_kind === 'transfer'
}

export const transferRecordColumns = [
  column('material', '材质', 150, (row) => row.material_name, true, 'material_name'),
  column('source', '来源', 156, materialSourceLabel, true),
  column(
    'destination',
    '去向',
    110,
    (row) =>
      isExternalEntryKind(row.entry_kind)
        ? row.external_destination || row.next_team.name
        : teamWorkspaceProfile(row.next_team.code)?.name || row.next_team.name,
    true,
  ),
  column('purpose', '接收业务', 125, materialPurposeLabel, true),
  column('material_type', '物料类型', 120, (row) => materialTypeLabel(row.material_type), true),
  column('quantity', '数量', 120, (row) => row.quantity, true),
  column('weight', '重量', 140, (row) => row.weight, true),
  column(
    'status',
    '状态',
    140,
    (row) => materialTransferStatusLabel(row.status, row.entry_kind),
    true,
  ),
  column('transfer_specification', '实际尺寸', 180, (row) => row.transfer_specification, true),
  column(
    'sent_employee_name',
    '转料人',
    120,
    (row) =>
      isInternalTransfer(row) || isExternalEntryKind(row.entry_kind)
        ? materialSenderName(row)
        : '—',
    true,
  ),
  column(
    'received_employee_name',
    '接收人',
    120,
    (row) =>
      isInternalTransfer(row) && row.status === 'received'
        ? row.received_employee_name?.trim() || '未登记'
        : '—',
    true,
  ),
  column(
    'received_at',
    '签收时间',
    170,
    (row) => (isInternalTransfer(row) ? formatDateTime(row.received_at) : '—'),
    true,
  ),
  column('sent_processing_status', '转出时加工状态', 170, (row) =>
    row.sent_processing_status ? processingStateLabels[row.sent_processing_status] : '未登记',
  ),
  column('entry_kind', '转料方式', 130, (row) => materialEntryLabel(row.entry_kind)),
  column('finished_specification', '成品规格', 180, (row) => row.finished_specification),
  column('source_transfer_batch_no', '上一批次号', 210, (row) => row.source_transfer_batch_no),
  column('source_batch_no', '原单批号', 160, (row) => row.source_batch_no),
  column('customer_code', '客户代码', 140, (row) => row.customer_code),
  column('delivery_date', '要求发货日期', 150, (row) => row.delivery_date),
  column('delivery_quantity', '应发成品件数', 150, (row) => row.delivery_quantity),
  column('warehouse_location', '仓位', 140, (row) => row.warehouse_location),
  column('notes', '说明', 220, (row) => row.notes),
  column('transferred_by', '开单操作账号', 160, (row) => row.transferred_by),
] as const

export type TransferRecordColumnKey = (typeof transferRecordColumns)[number]['key']

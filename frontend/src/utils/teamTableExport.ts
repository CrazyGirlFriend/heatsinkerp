import { teamWorkspaceProfile } from '@/config/teamWorkspaces'
import {
  isExternalEntryKind,
  materialEntryLabel,
  materialPurposeLabel,
  materialSourceLabel,
  materialTransferStatusLabel,
  materialTypeLabel,
  receiptSourceLabel,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import type { MaterialLoss } from '@/types/teamMaterials'
import { formatDateTime } from '@/utils/format'
import type { TableExportField } from './tableExport'

export function transferExportFields(
  section: 'pending' | 'receipts' | 'outgoing',
  warehouse: boolean,
): TableExportField<MaterialTransfer>[] {
  const field = (
    key: string,
    label: string,
    value: (row: MaterialTransfer) => string | number | null | undefined,
  ): TableExportField<MaterialTransfer> => ({ key, label, value })
  return [
    ...(section === 'receipts' && warehouse
      ? [field('warehouse_location', '仓位', (row) => row.warehouse_location || '未填写')]
      : []),
    field('batch_no', '批次号', (row) => row.batch_no),
    field('serial_no', '流水号', (row) => row.serial_no),
    ...(section === 'receipts'
      ? [
          field('received_at', '入库时间', (row) => formatDateTime(row.received_at)),
          ...(warehouse ? [field('receipt_source', '来源类别', receiptSourceLabel)] : []),
          field('source', '来源', materialSourceLabel),
        ]
      : []),
    field('material_name', '材质', (row) => row.material_name),
    field('material_type', '物料类型', (row) => materialTypeLabel(row.material_type)),
    ...(section === 'outgoing'
      ? [
          field('entry_kind', '出库方式', (row) => materialEntryLabel(row.entry_kind)),
          field('destination', '下序 / 去向', (row) =>
            isExternalEntryKind(row.entry_kind)
              ? row.external_destination || row.next_team.name
              : teamWorkspaceProfile(row.next_team.code)?.name || row.next_team.name,
          ),
        ]
      : []),
    field('purpose', '接收业务', materialPurposeLabel),
    field('quantity', '件数', (row) => row.quantity),
    field('weight', '重量 (kg)', (row) => row.weight),
    ...(section === 'pending'
      ? [field('source', '上序', (row) => row.source_team.name)]
      : [
          field('status', '状态', (row) =>
            section === 'outgoing' &&
            !isExternalEntryKind(row.entry_kind) &&
            row.status === 'pending'
              ? '转出待签收'
              : materialTransferStatusLabel(row.status, row.entry_kind),
          ),
        ]),
    ...(section === 'receipts'
      ? [field('received_by', '接收人', (row) => row.received_by)]
      : [
          field(
            'transferred_by',
            section === 'pending' ? '转出人' : '登记人',
            (row) => row.transferred_by,
          ),
          field('transferred_at', section === 'pending' ? '转出时间' : '登记时间', (row) =>
            formatDateTime(row.transferred_at),
          ),
        ]),
  ]
}

export const lossExportFields: TableExportField<MaterialLoss>[] = [
  { key: 'loss_no', label: '丢失记录号', value: (row) => row.loss_no },
  { key: 'batch_no', label: '来源批次号', value: (row) => row.batch_no },
  { key: 'serial_no', label: '流水号', value: (row) => row.serial_no },
  { key: 'material_name', label: '材质', value: (row) => row.material_name },
  { key: 'quantity', label: '件数', value: (row) => row.quantity },
  { key: 'weight', label: '重量 (kg)', value: (row) => row.weight },
  { key: 'reason', label: '原因', value: (row) => row.reason },
  { key: 'created_by', label: '登记人', value: (row) => row.created_by },
  { key: 'created_at', label: '登记时间', value: (row) => formatDateTime(row.created_at) },
]

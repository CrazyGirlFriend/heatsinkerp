import type { components } from '@/types/generated/api'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { processingStateLabels } from '@/types/materialProcessing'
import type { TableQueryColumn } from '@/types/tableQuery'
import { formatDateTime } from '@/utils/format'

export type InventorySerial = components['schemas']['InventorySerialRow']
type SerialColumn = {
  key: keyof InventorySerial
  label: string
  width: number
  kind: TableQueryColumn['kind']
  defaultVisible: boolean
  editor?: TableQueryColumn['editor']
}

export const serialStockColumns: SerialColumn[] = [
  { key: 'serial_no', label: '流水号', width: 200, kind: 'text', defaultVisible: true },
  {
    key: 'stock_status',
    label: '库存状态',
    width: 135,
    kind: 'text',
    defaultVisible: true,
    editor: 'choices',
  },
  {
    key: 'material_name',
    label: '材质',
    width: 125,
    kind: 'text',
    defaultVisible: true,
    editor: 'choices',
  },
  { key: 'on_hand_quantity', label: '在库件数', width: 115, kind: 'number', defaultVisible: true },
  {
    key: 'on_hand_weight',
    label: '在库重量（kg）',
    width: 145,
    kind: 'number',
    defaultVisible: true,
  },
  {
    key: 'processing_state',
    label: '加工状态',
    width: 145,
    kind: 'select',
    defaultVisible: true,
    editor: 'choices',
  },
  { key: 'last_activity_at', label: '变动时间', width: 175, kind: 'date', defaultVisible: true },
  {
    key: 'stock_total_quantity',
    label: '库存合计（件）',
    width: 125,
    kind: 'number',
    defaultVisible: false,
  },
  {
    key: 'stock_total_weight',
    label: '库存合计（kg）',
    width: 125,
    kind: 'number',
    defaultVisible: false,
  },
  {
    key: 'in_transit_quantity',
    label: '转出待签收件数',
    width: 150,
    kind: 'number',
    defaultVisible: false,
  },
  {
    key: 'in_transit_weight',
    label: '转出待签收重量（kg）',
    width: 180,
    kind: 'number',
    defaultVisible: false,
  },
]
const states: Record<string, string> = {
  ...processingStateLabels,
  mixed: '多种加工状态',
  not_required: '无需加工',
}
export const serialStockHeaders: Record<string, TableQueryColumn> = Object.fromEntries(
  serialStockColumns.map(({ key, kind, editor }) => [
    key,
    {
      field: key,
      kind,
      editor: editor || 'input',
      ...(key === 'processing_state'
        ? { valueLabel: (value: string | null) => states[value || ''] || '—' }
        : {}),
    },
  ]),
)
export function serialStockValue(row: InventorySerial, key: keyof InventorySerial) {
  if (key === 'serial_no')
    return row.serial_no || row.shared_unallocated ? sharedSerialLabel(row) : '未登记流水号'
  if (key === 'last_activity_at') return formatDateTime(row.last_activity_at)
  if (key === 'processing_state') return states[row.processing_state] || '—'
  const value = row[key]
  return typeof value === 'number' || typeof value === 'string' ? value : null
}

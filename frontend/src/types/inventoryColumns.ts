import type { SerialMetaField, SerialSummary } from './materialAnalytics'
import { formatDateTime } from '@/utils/format'

const amount = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const meta = (row: SerialSummary, key: SerialMetaField, multiple = '多值') => row[`${key}_count`] > 1 ? multiple : row[key] ?? '—'

// Only serial-level attributes and totals belong here. Batch numbers, peers and
// individual movement fields remain in the serial detail drawer.
export const inventoryColumns = [
  { key: 'material_name', label: '材质', width: 128, format: (row: SerialSummary) => meta(row, 'material_name', '多材质') },
  { key: 'transfer_specification', label: '规格', width: 144, format: (row: SerialSummary) => meta(row, 'transfer_specification', '多规格') },
  { key: 'available_quantity', label: '可用件数', width: 110, numeric: true, format: (row: SerialSummary) => amount(row.available_quantity) },
  { key: 'available_weight', label: '可用重量 (kg)', width: 150, numeric: true, format: (row: SerialSummary) => amount(row.available_weight) },
  { key: 'customer_code', label: '客户编号', width: 150, format: (row: SerialSummary) => meta(row, 'customer_code') },
  { key: 'product_code', label: '产品编号', width: 150, format: (row: SerialSummary) => meta(row, 'product_code') },
  { key: 'finished_specification', label: '成品规格', width: 160, format: (row: SerialSummary) => meta(row, 'finished_specification', '多规格') },
  { key: 'finished_quantity', label: '成品件数', width: 120, numeric: true, format: (row: SerialSummary) => row.finished_quantity_count > 1 ? '多值' : amount(row.finished_quantity) },
  { key: 'pending_incoming_quantity', label: '待接收件数', width: 140, numeric: true, format: (row: SerialSummary) => amount(row.pending_incoming_quantity) },
  { key: 'pending_incoming_weight', label: '待接收重量 (kg)', width: 170, numeric: true, format: (row: SerialSummary) => amount(row.pending_incoming_weight) },
  { key: 'pending_outgoing_quantity', label: '转出待确认件数', width: 170, numeric: true, format: (row: SerialSummary) => amount(row.pending_outgoing_quantity) },
  { key: 'pending_outgoing_weight', label: '转出待确认重量 (kg)', width: 200, numeric: true, format: (row: SerialSummary) => amount(row.pending_outgoing_weight) },
  { key: 'lost_quantity', label: '累计丢失件数', width: 150, numeric: true, format: (row: SerialSummary) => amount(row.lost_quantity) },
  { key: 'lost_weight', label: '累计丢失重量 (kg)', width: 180, numeric: true, format: (row: SerialSummary) => amount(row.lost_weight) },
  { key: 'urgency', label: '加急状态', width: 120, format: (row: SerialSummary) => row.urgency?.urgent ? '加急' : '普通' },
  { key: 'last_activity_at', label: '最近流转时间', width: 200, format: (row: SerialSummary) => formatDateTime(row.last_activity_at) },
  { key: 'scrap_quantity', label: '废料结存件数', width: 150, numeric: true, format: (row: SerialSummary) => amount(row.scrap_quantity) },
  { key: 'scrap_weight', label: '废料结存 (kg)', width: 170, numeric: true, format: (row: SerialSummary) => amount(row.scrap_weight) },
] as const
export type InventoryColumnKey = typeof inventoryColumns[number]['key']
export const serialNumberColumn = { key: 'serial_no', label: '流水号', width: 250, format: (row: SerialSummary) => row.serial_no } as const
export const inventorySearchColumns = [serialNumberColumn, ...inventoryColumns]
export type InventorySearchField = 'all' | typeof inventorySearchColumns[number]['key']
export const inventorySearchKind = (field: InventorySearchField) => field === 'urgency' ? 'status' : field === 'last_activity_at' ? 'date' : inventoryColumns.some(column => column.key === field && 'numeric' in column) ? 'number' : 'text'
export interface InventoryColumnChoice { key: InventoryColumnKey; visible: boolean }
export const defaultInventoryColumns = (): InventoryColumnChoice[] => inventoryColumns.map((column, index) => ({ key: column.key, visible: index < 4 }))

export function normalizeInventoryColumns(value: unknown): InventoryColumnChoice[] {
  if (!Array.isArray(value)) return defaultInventoryColumns()
  const result: InventoryColumnChoice[] = []
  for (const item of value) {
    if (item && inventoryColumns.some(column => column.key === item.key) && typeof item.visible === 'boolean' && !result.some(column => column.key === item.key)) {
      result.push({ key: item.key, visible: item.visible })
    }
  }
  return [...result, ...defaultInventoryColumns().filter(column => !result.some(item => item.key === column.key))]
}

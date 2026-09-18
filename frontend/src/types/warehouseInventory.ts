import type { MaterialBalance, MaterialPageParams } from './teamMaterials'
import type { SerialSummary, SerialParams } from './materialAnalytics'
import { inventoryColumns } from './inventoryColumns'
import { materialTypeLabel, type MaterialType } from './materialTransfer'
import { formatDateTime } from '@/utils/format'

export type WarehouseSource = 'external' | 'return' | 'internal'
export interface WarehouseInventoryRow extends MaterialBalance {
  group_id: number
  batch_count: number
  serial_no: string
  material_name: string
  transfer_specification: string
  material_type: MaterialType | ''
  receipt_source: WarehouseSource
  source_team_id: number | null
  external_source: string
  source_name: string | null
  urgency?: SerialSummary['urgency']
  last_activity_at: string | null
  customer_code: string | null
  customer_code_count: number
  product_code: string | null
  product_code_count: number
  finished_specification: string | null
  finished_specification_count: number
  finished_quantity: number | null
  finished_quantity_count: number
}
export const warehouseSourceNames: Record<WarehouseSource, string> = { external: '外部来料', return: '外部退回', internal: '车间转入' }
export const warehouseSourceLabel = (row: WarehouseInventoryRow) => `${warehouseSourceNames[row.receipt_source]} · ${row.source_name || '未登记'}`
const amount = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const extraKeys = ['customer_code', 'product_code', 'finished_specification', 'finished_quantity', 'lost_quantity', 'lost_weight', 'urgency', 'last_activity_at'] as const
function extraValue(row: WarehouseInventoryRow, key: typeof extraKeys[number]) {
  if (key === 'urgency') return row.urgency?.urgent ? '加急' : '普通'
  if (key === 'last_activity_at') return formatDateTime(row.last_activity_at)
  if (key === 'lost_quantity' || key === 'lost_weight') return amount(row[key])
  if (row[`${key}_count`] > 1) return '多值'
  return key === 'finished_quantity' ? amount(row[key]) : row[key] || '—'
}
export const warehouseColumns = [
  { key: 'material_name', label: '材质', width: 180, defaultVisible: true, format: (row: WarehouseInventoryRow) => row.material_name || '—' },
  { key: 'transfer_specification', label: '规格', width: 180, defaultVisible: true, format: (row: WarehouseInventoryRow) => row.transfer_specification || '—' },
  { key: 'material_type', label: '物料类型', width: 150, defaultVisible: true, format: (row: WarehouseInventoryRow) => materialTypeLabel(row.material_type || null) },
  { key: 'source', label: '来源', width: 270, defaultVisible: true, format: warehouseSourceLabel },
  { key: 'on_hand_quantity', label: '当前件数', width: 140, defaultVisible: true, numeric: true, format: (row: WarehouseInventoryRow) => amount(row.on_hand_quantity) },
  { key: 'on_hand_weight', label: '当前重量 (kg)', width: 170, defaultVisible: true, numeric: true, format: (row: WarehouseInventoryRow) => amount(row.on_hand_weight) },
  ...inventoryColumns.filter(column => extraKeys.includes(column.key as typeof extraKeys[number])).map(column => ({
    ...column, key: column.key as typeof extraKeys[number], defaultVisible: false, format: (row: WarehouseInventoryRow) => extraValue(row, column.key as typeof extraKeys[number]),
  })),
] as const
export type WarehouseColumnKey = typeof warehouseColumns[number]['key']
export const warehouseSerialColumn = { key: 'serial_no', label: '流水号', width: 180, format: (row: WarehouseInventoryRow) => row.serial_no } as const
export const warehouseSearchColumns = [warehouseSerialColumn, ...warehouseColumns.filter(column => column.key !== 'material_type')]
export type WarehouseSearchField = 'all' | typeof warehouseSearchColumns[number]['key']
export const warehouseSearchKind = (field: WarehouseSearchField) => field === 'urgency' ? 'status' : field === 'last_activity_at' ? 'date' : warehouseColumns.some(column => column.key === field && 'numeric' in column) ? 'number' : 'text'
export interface WarehouseInventoryParams extends Omit<SerialParams, 'availability' | 'search_field'> {
  availability?: 'current' | 'all' | 'available' | 'scrap'
  search_field?: WarehouseSearchField
  receipt_source?: WarehouseSource
  source_team_id?: number
}
export interface WarehouseGroupParams extends MaterialPageParams { current_only?: boolean }

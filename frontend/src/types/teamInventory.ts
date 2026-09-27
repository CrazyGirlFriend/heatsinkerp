import type { MaterialBalance, MaterialPageParams } from './teamMaterials'
import type { SerialSummary, SerialParams } from './materialAnalytics'
import { inventoryColumns } from './inventoryColumns'
import { isScrapType, materialTypeLabel, type MaterialType } from './materialTransfer'
import { formatDateTime } from '@/utils/format'

export type WarehouseSource = 'external' | 'return' | 'internal' | 'opening'
export interface TeamInventoryRow extends MaterialBalance {
  group_id: number
  batch_count: number
  current_batch_count: number
  purpose_id: number | null
  purpose_name: string
  oldest_received_at: string | null
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
export const warehouseSourceNames: Record<WarehouseSource, string> = { external: '外部来料', return: '外部退回', internal: '车间转入', opening: '期初库存' }
export const warehouseSourceLabel = (row: TeamInventoryRow) => row.receipt_source === 'opening' ? '期初库存' : `${warehouseSourceNames[row.receipt_source]} · ${row.source_name || '未登记'}`
export const inventorySourceLabel = (row: TeamInventoryRow, warehouse = false) => row.receipt_source === 'opening' ? '期初库存' : warehouse ? warehouseSourceLabel(row) : row.source_name || '上序未登记'
export const inventoryAmount = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const amount = inventoryAmount
export function inventoryDispatchable(row: TeamInventoryRow) {
  const prefix = isScrapType(row.material_type || null) ? 'scrap_available' : 'available'
  return { quantity: row[`${prefix}_quantity`], weight: row[`${prefix}_weight`] }
}
export const inventoryCanDispatch = (row: TeamInventoryRow) => Object.values(inventoryDispatchable(row)).some(value => value != null && value > 0)
const extraKeys = ['customer_code', 'product_code', 'finished_specification', 'finished_quantity', 'lost_quantity', 'lost_weight', 'urgency', 'last_activity_at'] as const
const balanceKeys = ['available_quantity', 'available_weight', 'pending_outgoing_quantity', 'pending_outgoing_weight', 'scrap_quantity', 'scrap_weight'] as const
function extraBalance(row: TeamInventoryRow, key: typeof balanceKeys[number]) {
  return amount(key === 'pending_outgoing_quantity' ? row.reserved_quantity : key === 'pending_outgoing_weight' ? row.reserved_weight : row[key])
}
function extraValue(row: TeamInventoryRow, key: typeof extraKeys[number]) {
  if (key === 'urgency') return row.urgency?.urgent ? '加急' : '普通'
  if (key === 'last_activity_at') return formatDateTime(row.last_activity_at)
  if (key === 'lost_quantity' || key === 'lost_weight') return amount(row[key])
  if (row[`${key}_count`] > 1) return '多值'
  return key === 'finished_quantity' ? amount(row[key]) : row[key] || '—'
}
export const warehouseColumns = [
  { key: 'material_name', label: '材质', width: 160, defaultVisible: true, format: (row: TeamInventoryRow) => row.material_name || '—' },
  { key: 'transfer_specification', label: '规格', width: 180, defaultVisible: false, format: (row: TeamInventoryRow) => row.transfer_specification || '—' },
  { key: 'material_type', label: '物料类型', width: 140, defaultVisible: true, format: (row: TeamInventoryRow) => materialTypeLabel(row.material_type || null) },
  { key: 'purpose_name', label: '本班组业务', width: 150, defaultVisible: true, format: (row: TeamInventoryRow) => row.purpose_name || '—' },
  { key: 'source', label: '来源', width: 120, defaultVisible: true, format: warehouseSourceLabel },
  { key: 'owned_quantity', label: '库存件数', width: 140, defaultVisible: true, numeric: true, format: (row: TeamInventoryRow) => amount(row.owned_quantity) },
  { key: 'owned_weight', label: '库存重量 (kg)', width: 170, defaultVisible: true, numeric: true, format: (row: TeamInventoryRow) => amount(row.owned_weight) },
  { key: 'dispatchable_quantity', label: '可转出件数', width: 150, defaultVisible: false, numeric: true, format: (row: TeamInventoryRow) => amount(inventoryDispatchable(row).quantity) },
  { key: 'dispatchable_weight', label: '可转出重量 (kg)', width: 180, defaultVisible: false, numeric: true, format: (row: TeamInventoryRow) => amount(inventoryDispatchable(row).weight) },
  { key: 'in_transit_quantity', label: '待签收件数', width: 150, defaultVisible: false, numeric: true, format: (row: TeamInventoryRow) => amount(row.in_transit_quantity) },
  { key: 'in_transit_weight', label: '待签收重量 (kg)', width: 180, defaultVisible: false, numeric: true, format: (row: TeamInventoryRow) => amount(row.in_transit_weight) },
  { key: 'on_hand_quantity', label: '在库件数', width: 140, defaultVisible: false, numeric: true, format: (row: TeamInventoryRow) => amount(row.on_hand_quantity) },
  { key: 'on_hand_weight', label: '在库重量 (kg)', width: 170, defaultVisible: false, numeric: true, format: (row: TeamInventoryRow) => amount(row.on_hand_weight) },
  ...inventoryColumns.filter(column => extraKeys.includes(column.key as typeof extraKeys[number])).map(column => ({
    ...column, key: column.key as typeof extraKeys[number], defaultVisible: false, format: (row: TeamInventoryRow) => extraValue(row, column.key as typeof extraKeys[number]),
  })),
  ...inventoryColumns.filter(column => balanceKeys.includes(column.key as typeof balanceKeys[number])).map(column => ({
    ...column, key: column.key as typeof balanceKeys[number], defaultVisible: false, format: (row: TeamInventoryRow) => extraBalance(row, column.key as typeof balanceKeys[number]),
  })),
] as const
export type WarehouseColumnKey = typeof warehouseColumns[number]['key']
export const warehouseLegacyColumnKeys = {
  stock_balance: ['on_hand_quantity', 'on_hand_weight'],
  owned_balance: ['owned_quantity', 'owned_weight'],
  dispatchable_balance: ['dispatchable_quantity', 'dispatchable_weight'],
  pending_transfer: ['in_transit_quantity', 'in_transit_weight'],
} satisfies Record<string, WarehouseColumnKey[]>
export const warehouseSerialColumn = { key: 'serial_no', label: '流水号', width: 170, format: (row: TeamInventoryRow) => row.serial_no } as const
export const warehouseSearchColumns = [warehouseSerialColumn, ...warehouseColumns.filter(column => !['material_type', 'dispatchable_quantity', 'dispatchable_weight', 'in_transit_quantity', 'in_transit_weight'].includes(column.key))]
export type WarehouseSearchField = 'all' | typeof warehouseSearchColumns[number]['key']
export const warehouseSearchKind = (field: WarehouseSearchField) => field === 'urgency' ? 'status' : field === 'last_activity_at' ? 'date' : warehouseColumns.some(column => column.key === field && 'numeric' in column) ? 'number' : 'text'
export interface TeamInventoryParams extends Omit<SerialParams, 'availability' | 'search_field'> {
  availability?: 'current' | 'owned' | 'all' | 'available' | 'scrap'
  search_field?: WarehouseSearchField
  receipt_source?: WarehouseSource
  source_team_id?: number
}
export interface WarehouseGroupParams extends MaterialPageParams { current_only?: boolean }

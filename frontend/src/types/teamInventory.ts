import { formatAmount as inventoryAmount } from '@/utils/format'
import { materialWeightToleranceKg } from '@/config/materialRules'
import { sharedSerialLabel, type SharedMaterialFields } from './sharedMaterial'
import type { MaterialBalance, MaterialPageParams } from './teamMaterials'
import {
  processingRoleLabels,
  type ProcessingRole,
  type ProcessingSummary,
  type ProcessingState,
} from './materialProcessing'
import type { SerialSummary, SerialParams } from './materialAnalytics'
import { inventoryColumns } from './inventoryColumns'
import {
  isScrapType,
  isWeightOnlyType,
  materialTypeLabel,
  type MaterialType,
} from './materialTransfer'
import { formatDateTime } from '@/utils/format'
import { inventoryScheduleDue, inventoryScheduleLabel } from '@/utils/inventorySchedule'
import type { InventoryScheduleSummary } from './productionSchedule'

export type WarehouseSource =
  'external' | 'return' | 'internal' | 'opening' | 'processing' | 'rework'
export interface TeamInventoryRow extends MaterialBalance, ProcessingSummary, SharedMaterialFields {
  process_route?: import('./processRoute').ProcessRouteContext | null
  group_id: number
  delivery_schedule?: InventoryScheduleSummary
  rework_pending?: boolean
  rework_count?: number
  inspection_hold_count?: number
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
  processing_role?: ProcessingRole | null
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
export const warehouseSourceNames: Record<WarehouseSource, string> = {
  external: '外部来料',
  return: '外部退回',
  internal: '车间转入',
  opening: '初始库存',
  processing: '本班组加工',
  rework: '返工料划分',
}
export const warehouseSourceLabel = (row: TeamInventoryRow) =>
  row.receipt_source === 'opening'
    ? '初始库存'
    : `${warehouseSourceNames[row.receipt_source]} · ${row.source_name || '未登记'}`
export const inventorySourceLabel = (row: TeamInventoryRow, warehouse = false) =>
  row.receipt_source === 'rework'
    ? '返工料划分'
    : row.receipt_source === 'processing'
      ? '本班组加工'
      : row.receipt_source === 'opening'
        ? '初始库存'
        : warehouse
          ? warehouseSourceLabel(row)
          : row.source_name || '上序未登记'
export { formatAmount as inventoryAmount } from '@/utils/format'
const amount = inventoryAmount
export const inventoryQuantity = (
  quantity: number | null | undefined,
  materialType?: string | null,
) => (isWeightOnlyType(materialType) ? '—' : amount(quantity))
export function inventoryDispatchable(row: TeamInventoryRow) {
  const prefix = isScrapType(row.material_type || null) ? 'scrap_available' : 'available'
  return { quantity: row[`${prefix}_quantity`], weight: row[`${prefix}_weight`] }
}
export const inventoryCanDispatch = (row: TeamInventoryRow) =>
  row.batch_count > 0 && Object.values(inventoryDispatchable(row)).every((value) => value != null)
export const inventoryHasPending = (row: TeamInventoryRow) =>
  [
    row.reserved_quantity,
    row.reserved_weight,
    row.in_transit_quantity,
    row.in_transit_weight,
    row.external_pending_quantity,
    row.external_pending_weight,
  ].some((value) => value != null && value > 0)
export function inventoryStockStatus(row: TeamInventoryRow) {
  if (row.inspection_hold_count) return `巡检待处理 · ${row.inspection_hold_count} 批`
  if (
    (row.max_weight_difference ?? 0) > materialWeightToleranceKg ||
    (row.shortage_weight ?? 0) > 0 ||
    (row.on_hand_weight ?? 0) < 0
  )
    return '重量差异'
  const available = Object.values(inventoryDispatchable(row)).some(
    (value) => value != null && value > 0,
  )
  if (inventoryHasPending(row)) {
    const external =
      (row.external_pending_quantity ?? 0) > 0 || (row.external_pending_weight ?? 0) > 0
    return `${available ? '部分' : '全部'}${external ? '待确认' : '待签收'}`
  }
  if (available) return isScrapType(row.material_type || null) ? '可处理' : '可出库'
  return Object.values(inventoryDispatchable(row)).some((value) => value == null)
    ? '库存待核对'
    : '暂无库存'
}
const extraKeys = [
  'customer_code',
  'product_code',
  'finished_specification',
  'finished_quantity',
  'lost_quantity',
  'lost_weight',
  'urgency',
  'last_activity_at',
] as const
const balanceKeys = [
  'available_quantity',
  'available_weight',
  'pending_outgoing_quantity',
  'pending_outgoing_weight',
] as const
function extraBalance(row: TeamInventoryRow, key: (typeof balanceKeys)[number]) {
  const value =
    key === 'pending_outgoing_quantity'
      ? row.reserved_quantity
      : key === 'pending_outgoing_weight'
        ? row.reserved_weight
        : row[key]
  return key.endsWith('quantity') ? inventoryQuantity(value, row.material_type) : amount(value)
}
function extraValue(row: TeamInventoryRow, key: (typeof extraKeys)[number]) {
  if (key === 'urgency') return row.urgency?.urgent ? '加急' : '普通'
  if (key === 'last_activity_at') return formatDateTime(row.last_activity_at)
  if (key === 'lost_quantity') return inventoryQuantity(row[key], row.material_type)
  if (key === 'lost_weight') return amount(row[key])
  if (row[`${key}_count`] > 1) return '各批不同'
  return key === 'finished_quantity' ? amount(row[key]) : row[key] || '—'
}
export const warehouseColumns = [
  {
    key: 'material_name',
    label: '材质',
    width: 160,
    defaultVisible: true,
    format: (row: TeamInventoryRow) => row.material_name || '—',
  },
  {
    key: 'process_route',
    label: '当前工艺工序',
    width: 180,
    defaultVisible: true,
    format: (row: TeamInventoryRow) =>
      row.process_route ? `${row.process_route.sequence_no} · ${row.process_route.step_name}` : '—',
  },
  {
    key: 'material_type',
    label: '物料类型',
    width: 140,
    defaultVisible: true,
    format: (row: TeamInventoryRow) => materialTypeLabel(row.material_type || null),
  },
  {
    key: 'rework',
    label: '返工属性',
    width: 130,
    defaultVisible: true,
    format: (row: TeamInventoryRow) =>
      row.process_route?.route_kind === 'rework'
        ? '返工中'
        : row.rework_pending
          ? '待返工'
          : row.rework_count
            ? `已返工 ${row.rework_count} 次`
            : '—',
  },
  {
    key: 'processing_role',
    label: '加工分类',
    width: 110,
    defaultVisible: true,
    format: (row: TeamInventoryRow) =>
      row.processing_role ? processingRoleLabels[row.processing_role] : '—',
  },
  {
    key: 'transfer_specification',
    label: '实际尺寸',
    width: 180,
    defaultVisible: true,
    format: (row: TeamInventoryRow) => row.transfer_specification || '—',
  },
  {
    key: 'purpose_name',
    label: '加工任务',
    width: 150,
    defaultVisible: true,
    format: (row: TeamInventoryRow) => row.purpose_name || '—',
  },
  { key: 'source', label: '来源', width: 120, defaultVisible: true, format: warehouseSourceLabel },
  {
    key: 'owned_quantity',
    label: '含待确认件数',
    width: 140,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) => inventoryQuantity(row.owned_quantity, row.material_type),
  },
  {
    key: 'owned_weight',
    label: '含待确认重量 (kg)',
    width: 170,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) => amount(row.owned_weight),
  },
  {
    key: 'delivery_due_at',
    label: '要求交货时间',
    width: 180,
    defaultVisible: true,
    format: (row: TeamInventoryRow) => inventoryScheduleDue(row.delivery_schedule),
  },
  {
    key: 'delivery_schedule_status',
    label: '排期状态',
    width: 125,
    defaultVisible: true,
    format: (row: TeamInventoryRow) => inventoryScheduleLabel(row.delivery_schedule),
  },
  {
    key: 'shortage_weight',
    label: '重量差异 (kg)',
    width: 180,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) => amount(row.shortage_weight),
  },
  {
    key: 'stock_status',
    label: '库存状态',
    width: 150,
    defaultVisible: true,
    format: inventoryStockStatus,
  },
  {
    key: 'dispatchable_quantity',
    label: '可转出件数',
    width: 150,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) =>
      inventoryQuantity(inventoryDispatchable(row).quantity, row.material_type),
  },
  {
    key: 'dispatchable_weight',
    label: '可转出重量 (kg)',
    width: 180,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) => amount(inventoryDispatchable(row).weight),
  },
  {
    key: 'in_transit_quantity',
    label: '待签收件数',
    width: 150,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) =>
      inventoryQuantity(row.in_transit_quantity, row.material_type),
  },
  {
    key: 'in_transit_weight',
    label: '待签收重量 (kg)',
    width: 180,
    defaultVisible: false,
    numeric: true,
    format: (row: TeamInventoryRow) => amount(row.in_transit_weight),
  },
  {
    key: 'on_hand_quantity',
    label: '数量（件）',
    width: 140,
    defaultVisible: true,
    numeric: true,
    format: (row: TeamInventoryRow) => inventoryQuantity(row.on_hand_quantity, row.material_type),
  },
  {
    key: 'on_hand_weight',
    label: '重量（kg）',
    width: 170,
    defaultVisible: true,
    numeric: true,
    format: (row: TeamInventoryRow) => amount(row.on_hand_weight),
  },
  ...inventoryColumns
    .filter((column) => extraKeys.includes(column.key as (typeof extraKeys)[number]))
    .map((column) => ({
      ...column,
      key: column.key as (typeof extraKeys)[number],
      defaultVisible: false,
      format: (row: TeamInventoryRow) => extraValue(row, column.key as (typeof extraKeys)[number]),
    })),
  ...inventoryColumns
    .filter((column) => balanceKeys.includes(column.key as (typeof balanceKeys)[number]))
    .map((column) => ({
      ...column,
      key: column.key as (typeof balanceKeys)[number],
      defaultVisible: false,
      format: (row: TeamInventoryRow) =>
        extraBalance(row, column.key as (typeof balanceKeys)[number]),
    })),
] as const
export type WarehouseColumnKey = (typeof warehouseColumns)[number]['key']
export const warehouseLegacyColumnKeys = {
  material_type: ['material_type', 'processing_role', 'transfer_specification'],
  stock_balance: ['on_hand_quantity', 'on_hand_weight'],
  owned_balance: ['owned_quantity', 'owned_weight'],
  dispatchable_balance: ['dispatchable_quantity', 'dispatchable_weight'],
  pending_transfer: ['in_transit_quantity', 'in_transit_weight'],
} satisfies Record<string, WarehouseColumnKey[]>
export const warehouseSerialColumn = {
  key: 'serial_no',
  label: '流水号',
  width: 170,
  format: (row: TeamInventoryRow) => sharedSerialLabel(row),
} as const
export const warehouseSearchColumns = [
  warehouseSerialColumn,
  { key: 'source_batch_no', label: '来源批次' } as const,
  ...warehouseColumns.filter(
    (column) =>
      ![
        'process_route',
        'material_type',
        'processing_role',
        'stock_status',
        'delivery_due_at',
        'delivery_schedule_status',
        'dispatchable_quantity',
        'dispatchable_weight',
      ].includes(column.key),
  ),
]
export type WarehouseSearchField = 'all' | (typeof warehouseSearchColumns)[number]['key']
export const warehouseSearchKind = (field: WarehouseSearchField) =>
  field === 'urgency'
    ? 'status'
    : field === 'last_activity_at'
      ? 'date'
      : warehouseColumns.some((column) => column.key === field && 'numeric' in column)
        ? 'number'
        : 'text'
export interface TeamInventoryParams extends Omit<SerialParams, 'availability' | 'search_field'> {
  availability?: 'current' | 'owned' | 'all' | 'available' | 'scrap'
  search_field?: WarehouseSearchField
  rework?: 'pending' | 'worked'
  receipt_source?: WarehouseSource
  location_status?: 'unassigned'
  processing_state?: ProcessingState | 'mixed' | 'not_required'
  processing_role?: ProcessingRole
  route_status?: 'linked' | 'unlinked'
  source_team_id?: number
  /** 0 selects receipts without an assigned receiving business. */
  purpose_id?: number
}
export interface WarehouseGroupParams extends MaterialPageParams {
  current_only?: boolean
}

import type { EntityId, TeamKind } from '@/services/adminApi'
import type { MaterialLoss } from './teamMaterials'

export type MaterialTransferStatus = 'pending' | 'received' | 'voided' | 'dispatched'
export type ExternalEntryKind = 'warehouse_outbound' | 'inspection_shipment'
export type MaterialEntryKind = 'transfer' | 'warehouse_receipt' | ExternalEntryKind
export type MaterialTransferAction = 'edit' | 'void' | 'confirm' | string

export const materialTypeOptions = [
  { value: 'finished', label: '成品' },
  { value: 'semi_finished', label: '半成品' },
  { value: 'finished_surplus', label: '成品余料' },
  { value: 'semi_finished_surplus', label: '半成品余料' },
  { value: 'defective', label: '废品' },
  { value: 'waste', label: '废料' },
  { value: 'sludge', label: '废泥' },
  { value: 'scrap_chips', label: '废屑' },
] as const
export type MaterialType = typeof materialTypeOptions[number]['value']

export const materialSearchModes = [
  { value: 'contains', label: '包含匹配' },
  { value: 'exact', label: '精确匹配' },
  { value: 'prefix', label: '前缀匹配' },
] as const
export const materialSearchFields = [
  { value: 'all', label: '全部字段' },
  { value: 'batch_no', label: '转料批次号' },
  { value: 'serial_no', label: '流水号' },
  { value: 'source_batch_no', label: '原单批号' },
  { value: 'product_code', label: '编号' },
  { value: 'customer_code', label: '客户代码' },
  { value: 'material_name', label: '材质' },
] as const
export type MaterialSearchMode = typeof materialSearchModes[number]['value']
export type MaterialSearchField = typeof materialSearchFields[number]['value']

export const materialDocumentTextFields = [
  { key: 'source_batch_no', label: '原单批号', maxLength: 80, group: 'basic', multiline: false },
  { key: 'material_name', label: '材质', maxLength: 160, group: 'basic', multiline: false },
  { key: 'finished_specification', label: '成品规格', maxLength: 240, group: 'basic', multiline: false },
  { key: 'transfer_specification', label: '转料规格', maxLength: 240, group: 'basic', multiline: false },
  { key: 'customer_code', label: '客户代码', maxLength: 80, group: 'basic', multiline: false },
  { key: 'technical_requirements', label: '技术要求', maxLength: 4000, group: 'basic', multiline: true },
  { key: 'product_code', label: '编号', maxLength: 80, group: 'extra', multiline: false },
  { key: 'part_no', label: '件号', maxLength: 80, group: 'extra', multiline: false },
  { key: 'material_shape', label: '形状', maxLength: 80, group: 'extra', multiline: false },
  { key: 'material_description', label: '物料说明', maxLength: 2000, group: 'extra', multiline: true },
  { key: 'outsourced_unit', label: '外委单位', maxLength: 160, group: 'extra', multiline: false },
  { key: 'purpose_category', label: '用途分类', maxLength: 80, group: 'extra', multiline: false },
  { key: 'category_level3', label: '三级类别', maxLength: 80, group: 'extra', multiline: false },
  { key: 'order_category', label: '订单分类', maxLength: 80, group: 'extra', multiline: false },
  { key: 'special_process', label: '特殊工艺说明', maxLength: 2000, group: 'extra', multiline: true },
] as const
export type MaterialTransferTextField = typeof materialDocumentTextFields[number]['key']
export type MaterialTransferDocumentFields = Record<MaterialTransferTextField, string | null> & {
  material_type: MaterialType | null
  finished_quantity: number | null
}

export interface MaterialTransferHistoryEntry {
  id: number
  action: 'created' | 'updated' | 'received' | 'voided' | 'stocked' | 'dispatched'
  actor: string
  occurred_at: string
  changes: Record<string, { before: unknown; after: unknown }>
}

export interface MaterialTransferTeam {
  id: EntityId
  code: string
  name: string
  kind?: TeamKind
}

export interface MaterialTransfer extends Partial<MaterialTransferDocumentFields> {
  urgency?: import('./recordFilters').SerialUrgency
  entry_kind?: MaterialEntryKind
  external_destination?: string | null
  dispatched_by?: string | null
  dispatched_by_user_id?: EntityId | null
  dispatched_at?: string | null
  id: EntityId
  batch_no: string
  barcode_payload: string
  barcode_type: 'CODE128' | string
  serial_no: string
  source_team: MaterialTransferTeam
  next_team: MaterialTransferTeam
  quantity: number
  quantity_unit: '件' | string
  weight: number
  weight_unit: 'kg' | string
  status: MaterialTransferStatus
  notes: string | null
  transferred_by: string | null
  transferred_at: string
  received_by: string | null
  received_at: string | null
  voided_by: string | null
  voided_at: string | null
  updated_at: string
  locked: boolean
  locked_at: string | null
  allowed_actions: MaterialTransferAction[]
  version?: number | null
  history?: MaterialTransferHistoryEntry[]
  source_transfer_id?: number | null
  source_transfer_batch_no?: string | null
  dispatch_no?: string | null
  stock_tracked?: boolean
  loss_records?: MaterialLoss[]
}

export interface MaterialTransferListParams {
  date_from?: string; date_to?: string; urgent_only?: boolean
  team_id?: EntityId
  direction?: MaterialTransferDirection
  query?: string
  search_mode?: MaterialSearchMode
  search_field?: MaterialSearchField
  material_type?: MaterialType
  serial_no?: string
  source_team_id?: EntityId
  next_team_id?: EntityId
  status?: MaterialTransferStatus | 'all'
  page?: number
  page_size?: number
}

export type MaterialTransferDirection = 'all' | 'outgoing' | 'incoming'

export type MaterialTransferFilterParams = Omit<MaterialTransferListParams, 'status' | 'page' | 'page_size'>

export interface MaterialTransferListResponse {
  items: MaterialTransfer[]
  total: number
  page: number
  page_size: number
}

export type MaterialTransferStatusCounts = Record<MaterialTransferStatus | 'all', number>

export interface CreateMaterialTransferPayload extends Partial<MaterialTransferDocumentFields> {
  serial_no: string
  next_team_id: EntityId
  quantity: number
  weight: number
  notes?: string | null
  idempotency_key?: string
}

export type UpdateMaterialTransferPayload = Partial<Omit<CreateMaterialTransferPayload, 'idempotency_key'>> & { expected_version?: number }

export interface ConfirmMaterialTransferPayload {
  idempotency_key: string
  expected_version?: number
}

export function materialTypeLabel(type: MaterialType | string | null | undefined): string {
  return materialTypeOptions.find(option => option.value === type)?.label ?? (type || '未填写')
}

export function materialTransferNotesLabel(transfer: MaterialTransfer): string {
  if (isExternalTransfer(transfer)) return `${externalActionLabel(transfer.entry_kind)}说明`
  return isWarehouseReceipt(transfer) || transfer.next_team.kind === 'warehouse' ? '入库说明' : '备注'
}

export function isWarehouseReceipt(transfer: MaterialTransfer): boolean {
  return transfer.entry_kind === 'warehouse_receipt'
}

export function isExternalEntryKind(kind?: MaterialEntryKind | string): kind is ExternalEntryKind {
  return kind === 'warehouse_outbound' || kind === 'inspection_shipment'
}
export function isExternalTransfer(transfer: Pick<MaterialTransfer, 'entry_kind'>): boolean {
  return isExternalEntryKind(transfer.entry_kind)
}
export function externalActionLabel(kind?: MaterialEntryKind): string {
  return kind === 'inspection_shipment' ? '发货' : '出库'
}
export function materialEntryLabel(kind?: MaterialEntryKind): string {
  return kind === 'warehouse_receipt' ? '库房手工入库' : kind === 'warehouse_outbound' ? '对外出库' : kind === 'inspection_shipment' ? '检验发货' : '内部转料'
}
export function materialDocumentTitle(transfer: MaterialTransfer): string {
  return isWarehouseReceipt(transfer) ? '库房入库单' : isExternalTransfer(transfer) ? `${externalActionLabel(transfer.entry_kind)}单` : '物料转料单'
}

export function materialTransferVersion(transfer: MaterialTransfer): { expected_version?: number } {
  return Number.isSafeInteger(transfer.version) && Number(transfer.version) > 0 ? { expected_version: Number(transfer.version) } : {}
}

export function materialTransferStatusLabel(status: MaterialTransferStatus | string, entryKind?: MaterialEntryKind): string {
  if (isExternalEntryKind(entryKind) && status === 'pending') return `待${externalActionLabel(entryKind)}确认`
  if (status === 'dispatched') return `已${externalActionLabel(entryKind)}`
  if (status === 'received' && entryKind === 'warehouse_receipt') return '已入库'
  const labels: Record<string, string> = {
    pending: '待接收',
    received: '已接收',
    voided: '已作废',
  }
  return labels[status.toLowerCase()] || status || '未知'
}

export function materialTransferStatusTone(
  status: MaterialTransferStatus | string,
): 'success' | 'warning' | 'danger' | 'info' {
  if (['received', 'dispatched'].includes(status.toLowerCase())) return 'success'
  if (status.toLowerCase() === 'pending') return 'warning'
  if (status.toLowerCase() === 'voided') return 'info'
  return 'info'
}

function hasAction(transfer: MaterialTransfer, action: MaterialTransferAction): boolean {
  return !isWarehouseReceipt(transfer) && transfer.allowed_actions.includes(action)
}

export function canEditMaterialTransfer(transfer: MaterialTransfer): boolean {
  return transfer.status === 'pending' && !transfer.locked && hasAction(transfer, 'edit')
}

export function canVoidMaterialTransfer(transfer: MaterialTransfer): boolean {
  return transfer.status === 'pending' && !transfer.locked && hasAction(transfer, 'void')
}

export function canConfirmMaterialTransfer(transfer: MaterialTransfer): boolean {
  return !isExternalTransfer(transfer) && transfer.status === 'pending' && !transfer.locked && hasAction(transfer, 'confirm')
}

export function canConfirmOutbound(transfer: MaterialTransfer): boolean {
  return isExternalTransfer(transfer) && transfer.status === 'pending' && !transfer.locked && hasAction(transfer, 'confirm_outbound')
}

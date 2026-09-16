import { externalActionLabel, isExternalEntryKind, type ExternalEntryKind, type MaterialEntryKind, type MaterialTransfer, type MaterialTransferDocumentFields, type MaterialTransferTeam, type MaterialType } from './materialTransfer'

export const balanceFields = ['received', 'dispatched', 'reserved', 'in_transit', 'lost', 'on_hand', 'available'] as const
export type MaterialBalance = Record<`${typeof balanceFields[number]}_${'quantity' | 'weight'}`, number | null>
export interface TeamMaterialOverview {
  team_id: number
  totals: MaterialBalance
  materials: (MaterialBalance & { material_name: string | null })[]
  pending_incoming: { quantity: number | null; weight: number | null; count: number | null }
  legacy_received_count: number
}
export interface StockBatch extends MaterialBalance { transfer: MaterialTransfer }
export interface MaterialLoss {
  urgency?: import('./recordFilters').SerialUrgency
  id: number; loss_no: string; source_transfer_id: number; batch_no: string; serial_no: string
  material_name: string | null; quantity: number; weight: number; reason: string
  created_by: string; created_at: string; team_id: number
}
export type DispatchKind = 'transfer' | ExternalEntryKind
export type DispatchStatus = 'pending' | 'partial' | 'received' | 'voided' | 'dispatched'
export interface MaterialDispatch {
  id?: number; barcode_payload?: string; barcode_type?: string; source_team?: MaterialTransferTeam
  revision?: string; allowed_actions?: string[]; pending_line_count?: number; locked?: boolean
  confirmed_by?: string | null; confirmed_by_user_id?: number | null; confirmed_at?: string | null
  entry_kind?: DispatchKind; external_destination?: string | null
  dispatch_no: string; source_team_id: number; next_team: MaterialTransferTeam
  created_by: string; created_at: string; notes: string | null; status: DispatchStatus
  total_quantity: number; total_weight: number; line_count: number; items: MaterialTransfer[]
}
export interface MaterialDispatchDocument extends MaterialDispatch {
  id: number; barcode_payload: string; barcode_type: string; source_team: MaterialTransferTeam
  revision: string; allowed_actions: string[]; pending_line_count: number; locked: boolean
}
export const isDispatchNumber = (code: string): boolean => /^CK[A-Z0-9-]+$/i.test(code.trim())
export const dispatchDocumentTitle = (kind?: MaterialEntryKind): string => kind === 'inspection_shipment' ? '批次发货单' : '批次出库单'
export const dispatchConfirmLabel = (kind?: MaterialEntryKind): string => isExternalEntryKind(kind) ? `确认整批${externalActionLabel(kind)}` : '确认整批接收'
export interface MaterialPage<T> { items: T[]; total: number; page: number; page_size: number }
export type MaterialPageParams = import('./recordFilters').RecordFilterParams & { query?: string; serial_no?: string; page?: number; page_size?: number }
export interface StockParams extends MaterialPageParams { material_type?: MaterialType; availability?: 'available' | 'all' }
export interface WarehouseReceiptParams extends MaterialPageParams { material_type?: MaterialType }
export interface CreateWarehouseReceipt extends Partial<MaterialTransferDocumentFields> {
  serial_no: string
  material_name: string
  material_type: MaterialType
  quantity: number
  weight: number
  notes: string
  idempotency_key: string
}
export interface DispatchParams extends MaterialPageParams { next_team_id?: string | number; status?: DispatchStatus; entry_kind?: DispatchKind }
export interface DispatchLine { source_transfer_id: number; quantity: number; weight: number; material_type?: MaterialType | null }
export type CreateDispatch = { notes?: string | null; idempotency_key: string; lines: DispatchLine[] } & (
  { entry_kind?: 'transfer'; next_team_id: number; external_destination?: never }
  | { entry_kind: ExternalEntryKind; next_team_id?: null; external_destination: string }
)
export interface CreateLoss { source_transfer_id: number; quantity: number; weight: number; reason: string; idempotency_key: string }
export const dispatchStatusLabels: Record<DispatchStatus, string> = { pending: '待确认', partial: '部分完成', received: '已接收', dispatched: '已出库 / 发货', voided: '已作废' }
export function dispatchStatusLabel(status: DispatchStatus, kind?: MaterialEntryKind): string {
  if (isExternalEntryKind(kind)) return status === 'pending' ? `待${externalActionLabel(kind)}确认` : status === 'partial' ? `部分${externalActionLabel(kind)}` : status === 'dispatched' ? `已${externalActionLabel(kind)}` : dispatchStatusLabels[status]
  return status === 'pending' ? '待接收' : status === 'partial' ? '部分接收' : dispatchStatusLabels[status]
}

import type { MaterialTransfer, MaterialType, MaterialEntryKind } from './materialTransfer'
export interface TeamPurpose { id: number; team_id: number; name: string; active: boolean; version: number }
export interface OpeningLine {
  serial_no: string; material_name: string; material_type: MaterialType | ''; transfer_specification: string
  quantity: number | undefined; weight: number | undefined; notes?: string | null; purpose_id?: number | null
}
export interface OpeningState { enabled: boolean; completed: boolean; has_stock_history: boolean; can_submit: boolean; items: MaterialTransfer[] }
export interface SerialHistoryEvent {
  id: string; at: string; kind: 'incoming' | 'opening' | 'outgoing' | 'adjusted' | 'voided' | 'loss'
  batch_no: string; source_batch_no: string; counterpart: string; material_type: MaterialType | null
  source_material_type: MaterialType | null; quantity: number; weight: number
  delta_quantity: number; delta_weight: number; balance_quantity: number; balance_weight: number; status: string
}
export interface SerialHistoryGroup {
  key: string; purpose_id: number | null; name: string
  incoming_quantity: number; incoming_weight: number; outgoing_quantity: number; outgoing_weight: number
  lost_quantity: number; lost_weight: number; on_hand_quantity: number; on_hand_weight: number
  baseline_quantity: number; baseline_weight: number; events: SerialHistoryEvent[]
}
export interface SerialHistory {
  serial_no: string; found: boolean; groups: SerialHistoryGroup[]; date_from: string | null; date_to: string | null
  untracked_count: number; pending_incoming_count: number
  team_name: string; flows: SerialHistoryFlow[]
  observed_at?: string; closing_at?: string; lots?: SerialHistoryLot[]
}
export interface SerialHistoryLot {
  batch_no: string; group_key: string; received_at: string; from_name: string
  quantity: number; weight: number; on_hand_quantity: number; on_hand_weight: number
  baseline_quantity: number; baseline_weight: number; closing_quantity: number; closing_weight: number
  last_event_at: string
}
export interface SerialHistoryFlow {
  id: string; group_key: string; direction: 'incoming' | 'outgoing'; batch_no: string; at: string
  from_name: string; to_name: string; quantity: number; weight: number; status: string; entry_kind: MaterialEntryKind
}

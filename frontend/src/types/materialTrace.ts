import type { MaterialTransfer } from './materialTransfer'

export interface TraceBatch extends MaterialTransfer {
  on_hand_quantity: number | null
  on_hand_weight: number | null
  owned_quantity?: number | null
  owned_weight?: number | null
  processing_delta_weight?: number
  weight_difference?: number
  weight_root_transfer_id?: number
}
export interface TraceAmount { quantity: number; weight: number }
export interface TraceHolding {
  team_id: number; team_code: string; team_name: string
  material_types: Array<TraceAmount & { material_type: string | null }>
}
export interface MaterialTrace {
  reallocations?: MaterialTransfer[]
  shortage?: TraceAmount
  processing_delta_weight?: number
  weight_difference?: number
  max_weight_difference?: number
  serial_no: string
  observed_at?: string
  items: TraceBatch[]
  totals: Record<'on_hand' | 'in_transit' | 'external_pending' | 'dispatched' | 'lost', TraceAmount>
  positions: Array<TraceAmount & { team_id: number; team_name: string; batch_count: number }>
  holdings?: TraceHolding[]
  untracked_count: number
}

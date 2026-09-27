import type { MaterialTransfer } from './materialTransfer'

export interface TraceBatch extends MaterialTransfer {
  on_hand_quantity: number | null
  on_hand_weight: number | null
}
export interface TraceAmount { quantity: number; weight: number }
export interface TraceHolding {
  team_id: number; team_code: string; team_name: string
  material_types: Array<TraceAmount & { material_type: string | null }>
}
export interface MaterialTrace {
  serial_no: string
  observed_at?: string
  items: TraceBatch[]
  totals: Record<'on_hand' | 'in_transit' | 'external_pending' | 'dispatched' | 'lost', TraceAmount>
  positions: Array<TraceAmount & { team_id: number; team_name: string; batch_count: number }>
  holdings?: TraceHolding[]
  untracked_count: number
}

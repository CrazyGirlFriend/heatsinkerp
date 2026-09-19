import type { MaterialTransfer } from './materialTransfer'

export interface TraceBatch extends MaterialTransfer {
  on_hand_quantity: number | null
  on_hand_weight: number | null
}
export interface TraceAmount { quantity: number; weight: number }
export interface MaterialTrace {
  serial_no: string
  items: TraceBatch[]
  totals: Record<'on_hand' | 'in_transit' | 'external_pending' | 'dispatched' | 'lost', TraceAmount>
  positions: Array<TraceAmount & { team_id: number; team_name: string; batch_count: number }>
  untracked_count: number
}

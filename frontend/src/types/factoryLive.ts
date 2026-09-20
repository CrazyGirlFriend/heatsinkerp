import type { FactoryOverview, FactoryRecentBatch, FactoryTeam } from './factoryOverview'
import type { Amount, ChartPoint } from './materialAnalytics'

export interface LiveTransfer {
  batch_no: string
  serial_no: string
  source_id: number | null
  target_id: number
  source_name: string | null
  quantity: number
  weight: number
  updated_at: string
}
export interface LiveTeam extends FactoryTeam {
  incoming: number | null
  outgoing: number | null
  pending_transfers: LiveTransfer[]
  material_types: ChartPoint[]
}
export interface LiveBatch extends FactoryRecentBatch {
  source_id: number | null
  target_id: number | null
  serial_count: number
  material_count: number
  material_name: string | null
  waiting_since: string | null
}
export interface LiveLink {
  source_id: number
  target_id: number
  pending_batches: number
  confirmed_batches: number
  pending_quantity: number
  pending_weight: number
}
export interface FactoryLive extends Pick<
  FactoryOverview,
  'as_of' | 'totals' | 'pending' | 'legacy_received_count'
> {
  teams: LiveTeam[]
  recent_batches: LiveBatch[]
  links: LiveLink[]
  material_stock: ChartPoint[]
  material_types: ChartPoint[]
  internal_pending: Amount & { batches: number }
  today: { outgoing_quantity: number; received_batches: number }
}

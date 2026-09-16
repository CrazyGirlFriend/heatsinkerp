import type { FactoryOverview, FactoryRecentBatch, FactoryTeam } from './factoryOverview'

export interface LiveTeam extends FactoryTeam { incoming: number | null; outgoing: number | null }
export interface LiveBatch extends FactoryRecentBatch {
  source_id: number | null; target_id: number | null
  serial_count: number; material_count: number; material_name: string | null; waiting_since: string | null
}
export interface LiveLink { source_id: number; target_id: number; pending_batches: number; confirmed_batches: number }
export interface FactoryLive extends Pick<FactoryOverview, 'as_of' | 'totals' | 'pending' | 'legacy_received_count'> {
  teams: LiveTeam[]
  recent_batches: LiveBatch[]
  links: LiveLink[]
  today: { outgoing_quantity: number; received_batches: number }
}

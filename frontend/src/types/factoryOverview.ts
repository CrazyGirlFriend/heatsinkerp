import type { MaterialBalance } from './teamMaterials'
import type { Amount, ChartPoint } from './materialAnalytics'
import type { MaterialEntryKind } from './materialTransfer'

export type FactoryFlow = 'inbound' | 'outbound' | 'shipment' | 'internal' | 'loss'
export interface FactoryStockRow {
  team_id: number | null; team_code: string; team_name: string; active: boolean
  amounts: Record<string, Amount>; total: Amount | null
}
export interface FactoryStockMatrix {
  materials: (Amount & { name: string })[]; rows: FactoryStockRow[]; total: Amount
}
export interface FactoryTeam {
  id: number | null; code: string; name: string; active: boolean; balance: MaterialBalance | null
  serial_count?: number | null
  urgent_serial_count?: number | null
  pending_incoming?: (Amount & { batches: number }) | null
}
export interface FactoryOverview {
  as_of: string; days: 7 | 30; teams: FactoryTeam[]; totals: MaterialBalance
  pending: Amount & { batches: number }; period_totals: Record<FactoryFlow, Amount>
  trend: (Record<FactoryFlow, Amount> & { key: string })[]
  material_types: ChartPoint[]; stock_age: ChartPoint[]
  waiting_age: { key: string; label: string; internal: Amount; external: Amount }[]
  legacy_received_count: number
  material_ranking: Record<'quantity' | 'weight', ChartPoint[]>
  serial_ranking: Record<'quantity' | 'weight', ChartPoint[]>
  recent_batches: FactoryRecentBatch[]
  stock_matrix: FactoryStockMatrix
}

export interface FactoryRecentBatch extends Amount {
  urgent_serial_count?: number
  batch_no: string; entry_kind: MaterialEntryKind
  source_name: string | null; target_name: string | null; external_destination: string | null
  status: 'pending' | 'received' | 'dispatched' | 'partial' | 'voided'
  line_count: number; updated_at: string
}
export type FactoryScene = 'overview' | 'stock' | 'handoff'

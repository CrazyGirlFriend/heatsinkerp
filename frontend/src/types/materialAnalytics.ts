import type { MaterialBalance, MaterialPageParams } from './teamMaterials'

export type Metric = 'quantity' | 'weight'
export type AgeBand = 'lt1' | '1_3' | '3_7' | 'ge7'
export interface Amount {
  quantity: number
  weight: number
}
export interface ChartPoint extends Amount {
  key: string
  label?: string
}
export const serialMetaFields = [
  'material_name',
  'material_type',
  'transfer_specification',
  'finished_specification',
  'source_batch_no',
  'customer_code',
  'product_code',
  'finished_quantity',
] as const
export type SerialMetaField = (typeof serialMetaFields)[number]
export type SerialSummary = MaterialBalance &
  Record<Exclude<SerialMetaField, 'finished_quantity'>, string | null> &
  Record<`${SerialMetaField}_count`, number> & {
    serial_no: string
    finished_quantity: number | null
    last_activity_at: string | null
    urgency?: import('./recordFilters').SerialUrgency
    pending_incoming_quantity: number
    pending_incoming_weight: number
    pending_outgoing_quantity: number
    pending_outgoing_weight: number
  }
export interface SerialParams extends MaterialPageParams {
  search_field?: 'all' | 'serial_no' | import('./inventoryColumns').InventoryColumnKey
  search_operator?: 'eq' | 'gte' | 'lte'
  serial_no?: string
  material_name?: string
  material_type?: string
  availability?: 'all' | 'available' | 'scrap'
  stock_age?: AgeBand
  waiting_age?: AgeBand
  waiting_direction?: 'incoming' | 'outgoing'
  activity_day?: string
  activity_kind?: 'incoming' | 'outgoing' | 'loss'
  has_loss?: boolean
  flow_direction?: 'incoming' | 'outgoing'
  peer?: string
  days?: 7 | 30
}

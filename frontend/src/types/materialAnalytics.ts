import type { components } from './generated/api'
import type { MaterialPageParams } from './teamMaterials'

export type Metric = 'quantity' | 'weight'
export type AgeBand = 'lt1' | '1_3' | '3_7' | 'ge7'
export type Amount = components['schemas']['AmountResponse']
export type ChartPoint = Omit<components['schemas']['ChartPointResponse'], 'label'> & {
  label?: string
}
export { serialMetaFields } from './inventorySummary'
export type { SerialMetaField, SerialSummary } from './inventorySummary'
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

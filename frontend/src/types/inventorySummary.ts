import type { MaterialBalance } from './teamMaterials'

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

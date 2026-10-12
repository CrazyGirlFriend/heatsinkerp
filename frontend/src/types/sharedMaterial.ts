export interface SharedMaterialSerial {
  serial_no: string
  customer_code?: string | null
  finished_specification?: string | null
  delivery_date?: string | null
  delivery_quantity?: number | null
  planned_weight?: number | null
  planned_quantity?: number | null
  planned_specification?: string | null
}
export interface SharedMaterialFields {
  shared_group_id?: number | null
  shared_unallocated?: boolean
  shared_origin_batch_no?: string | null
  shared_serials?: SharedMaterialSerial[]
}
export function sharedSerialLabel(item: SharedMaterialFields & { serial_no?: string }) {
  return item.shared_unallocated
    ? `共投 · ${(item.shared_serials || []).map((member) => member.serial_no).join(' / ')}`
    : item.serial_no || '—'
}

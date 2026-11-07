import type { components } from './generated/api'
export type SharedMaterialSerial = components['schemas']['SharedSerialResponse']
export interface SharedMaterialFields {
  shared_group_id?: number | null
  shared_unallocated?: boolean
  shared_origin_batch_no?: string | null
  shared_serials?: SharedMaterialSerial[] | null
}
export function sharedSerialLabel(item: SharedMaterialFields & { serial_no?: string }) {
  return item.shared_unallocated
    ? `共投 · ${(item.shared_serials || []).map((member) => member.serial_no).join(' / ')}`
    : item.serial_no || '—'
}

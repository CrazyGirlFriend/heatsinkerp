import { httpRequest } from './httpClient'
import type { MaterialType } from '@/types/materialTransfer'

export interface SerialInventoryRow {
  team_id: number
  team_name: string
  material_name: string
  material_type: MaterialType | ''
  shared_unallocated: boolean
  stock_quantity: number
  stock_weight: number
  incoming_quantity: number
  incoming_weight: number
}
export interface SerialInventory {
  serial_no: string
  items: SerialInventoryRow[]
  untracked_count: number
  as_of: string
}
export interface SerialInventoryBatch {
  id: number
  batch_no: string
  transfer_specification: string | null
  quantity: number
  weight: number
  rework_pending: boolean
  rework_count: number
  inspection_hold_id: number | null
}
export interface SerialInventoryBatches {
  items: SerialInventoryBatch[]
  total: number
  page: number
  page_size: number
}
export type InventoryLocation = 'stock' | 'incoming'
export const serialInventoryApi = {
  get: (serialNo: string) =>
    httpRequest<SerialInventory>(
      `/serial-inventory?${new URLSearchParams({ serial_no: serialNo })}`,
      { noCache: true },
    ),
  batches: (
    serialNo: string,
    row: SerialInventoryRow,
    location: InventoryLocation,
    page: number,
    pageSize: number,
  ) =>
    httpRequest<SerialInventoryBatches>(
      `/serial-inventory/batches?${new URLSearchParams({
        serial_no: serialNo,
        team_id: String(row.team_id),
        material_name: row.material_name,
        material_type: row.material_type,
        shared: String(row.shared_unallocated),
        location,
        page: String(page),
        page_size: String(pageSize),
      })}`,
      { noCache: true },
    ),
}

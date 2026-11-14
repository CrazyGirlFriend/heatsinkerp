import { httpRequest } from './httpClient'
import { type WarehouseLocation, type WarehouseLocationFilter } from './warehouseLocationApi'
import type { StockBatch } from '@/types/teamMaterials'
import { sharedSerialLabel } from '@/types/sharedMaterial'

export type WarehouseCatalogFilter = WarehouseLocationFilter | 'unassigned'
export type WarehouseCatalogRow = {
  key: string
  location: WarehouseLocation | null
  stock: StockBatch | null
}
export const catalogSerial = (row: WarehouseCatalogRow) =>
  row.stock
    ? sharedSerialLabel(row.stock.transfer)
    : [...new Set(row.location!.batches.map(sharedSerialLabel).filter(Boolean))].join('、') || '—'
export const catalogAmount = (row: WarehouseCatalogRow, key: 'quantity' | 'weight') =>
  row.stock
    ? (row.stock[`unassigned_${key}`] ?? 0)
    : row
        .location!.batches.filter((batch) => batch.status === 'received')
        .reduce((sum, batch) => sum + batch[key], 0)

// The server filters and sorts slots and unassigned stock together before pagination.
export async function loadWarehouseCatalog(
  query: string,
  page: number,
  pageSize: number,
  state?: WarehouseCatalogFilter,
  teamId?: number,
  tableQuery?: string,
) {
  return httpRequest<{ items: WarehouseCatalogRow[]; total: number }>(
    `/warehouse-locations/inventory?${new URLSearchParams({
      query,
      page: String(page),
      page_size: String(pageSize),
      ...(state ? { state } : {}),
      ...(teamId ? { team_id: String(teamId) } : {}),
      ...(tableQuery ? { table_query: tableQuery } : {}),
    })}`,
  )
}

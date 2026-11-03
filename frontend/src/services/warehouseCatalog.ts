import { teamMaterialApi } from './teamMaterialApi'
import {
  warehouseLocationApi,
  type WarehouseLocation,
  type WarehouseLocationFilter,
} from './warehouseLocationApi'
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

// Unassigned portions come first. Read only the pages needed for this combined window.
export async function loadWarehouseCatalog(
  query: string,
  page: number,
  pageSize: number,
  state?: WarehouseCatalogFilter,
  teamId?: number,
) {
  const unassigned =
    teamId && (!state || state === 'unassigned')
      ? await teamMaterialApi.stock(teamId, {
          availability: 'all',
          location_status: 'unassigned',
          query,
          page,
          page_size: pageSize,
        })
      : { items: [], total: 0 }
  const items: WarehouseCatalogRow[] = unassigned.items.map((stock) => ({
    key: `stock-${stock.transfer.id}`,
    stock,
    location: null,
  }))
  if (state === 'unassigned') return { items, total: unassigned.total }

  const offset = Math.max(0, (page - 1) * pageSize - unassigned.total)
  const locationPage = Math.floor(offset / pageSize) + 1
  const locations = await warehouseLocationApi.list(query, locationPage, pageSize, state)
  const count = pageSize - items.length
  const withinPage = offset % pageSize
  const slice = locations.items.slice(withinPage, withinPage + count)
  if (slice.length < count && locationPage * pageSize < locations.total) {
    const next = await warehouseLocationApi.list(query, locationPage + 1, pageSize, state)
    slice.push(...next.items.slice(0, count - slice.length))
  }
  items.push(
    ...slice.map((location) => ({ key: `location-${location.id}`, location, stock: null })),
  )
  return { items, total: unassigned.total + locations.total }
}

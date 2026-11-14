import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadWarehouseCatalog, catalogAmount, catalogSerial } from './warehouseCatalog'
import * as http from './httpClient'
import { normalizeMaterialTransfer } from './materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'

afterEach(() => vi.restoreAllMocks())
const stock = (id: number) =>
  ({
    transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: 'S8' }),
    unassigned_quantity: 10,
    unassigned_weight: 1,
    available_quantity: 80,
    available_weight: 8,
  }) as StockBatch

describe('combined warehouse catalog', () => {
  it('passes search, filters, ordering and paging to one combined server index', async () => {
    const response = { items: [{ key: 'stock-8', stock: stock(8), location: null }], total: 81 }
    const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(response)
    const columnQuery = JSON.stringify({ sort: { field: 'quantity', direction: 'desc' } })
    expect(await loadWarehouseCatalog('S8', 3, 20, 'unassigned', 1, columnQuery)).toBe(response)
    const url = new URL(request.mock.calls[0]![0], 'http://local')
    expect(url.pathname).toBe('/warehouse-locations/inventory')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'S8',
      page: '3',
      page_size: '20',
      state: 'unassigned',
      team_id: '1',
      table_query: columnQuery,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('uses only unassigned quantities, including stock tracked by weight alone', () => {
    const row = { key: 'stock-8', stock: stock(8), location: null }
    expect(catalogSerial(row)).toBe('S8')
    expect(catalogAmount(row, 'quantity')).toBe(10)
    expect(catalogAmount(row, 'weight')).toBe(1)
    row.stock.unassigned_quantity = 0
    expect(catalogAmount(row, 'quantity')).toBe(0)
    expect(catalogAmount(row, 'weight')).toBe(1)
  })
})

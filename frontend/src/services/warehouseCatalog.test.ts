import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadWarehouseCatalog, catalogAmount, catalogSerial } from './warehouseCatalog'
import { warehouseLocationApi, type WarehouseLocation } from './warehouseLocationApi'
import { teamMaterialApi } from './teamMaterialApi'
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
function fixture(unassignedCount: number, locationCount: number) {
  const unassigned = Array.from({ length: unassignedCount }, (_, i) => stock(i + 1))
  const slots = Array.from(
    { length: locationCount },
    (_, i) => ({ id: i + 1, name: `A-${i + 1}`, batches: [] }) as unknown as WarehouseLocation,
  )
  vi.spyOn(teamMaterialApi, 'stock').mockImplementation(async (_team, params) => ({
    items: unassigned.slice(
      (params!.page! - 1) * params!.page_size!,
      params!.page! * params!.page_size!,
    ),
    total: unassigned.length,
    page: params!.page!,
    page_size: params!.page_size!,
  }))
  vi.spyOn(warehouseLocationApi, 'list').mockImplementation(
    async (_query, page = 1, size = 50) => ({
      page: page ?? 1,
      page_size: size,
      items: slots.slice((page - 1) * size, page * size),
      total: slots.length,
      team_id: 1,
    }),
  )
}
describe('combined warehouse catalog', () => {
  it.each([0, 1, 49, 50, 51, 125])(
    'paginates %i unassigned portions and all slots without omissions or duplicates',
    async (count) => {
      fixture(count, 101)
      const keys: string[] = []
      for (let page = 1; page <= Math.ceil((count + 101) / 50); page++) {
        const result = await loadWarehouseCatalog('', page, 50, undefined, 1)
        expect(result.total).toBe(count + 101)
        expect(result.items.length).toBe(Math.min(50, count + 101 - (page - 1) * 50))
        keys.push(...result.items.map((row) => row.key))
      }
      expect(keys).toEqual([
        ...Array.from({ length: count }, (_, i) => `stock-${i + 1}`),
        ...Array.from({ length: 101 }, (_, i) => `location-${i + 1}`),
      ])
    },
  )
  it('filters unassigned stock and location states server-side before pagination', async () => {
    fixture(2, 10)
    const pending = await loadWarehouseCatalog('S8', 1, 50, 'pending', 1)
    expect(pending.total).toBe(10)
    expect(teamMaterialApi.stock).not.toHaveBeenCalled()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('S8', 1, 50, 'pending')
    vi.mocked(warehouseLocationApi.list).mockClear()
    const unassigned = await loadWarehouseCatalog('S8', 1, 50, 'unassigned', 1)
    expect(unassigned.total).toBe(2)
    expect(warehouseLocationApi.list).not.toHaveBeenCalled()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ query: 'S8', location_status: 'unassigned' }),
    )
  })
  it('uses only the unassigned portion, including stock tracked by weight alone', () => {
    const row = { key: 'stock-8', stock: stock(8), location: null }
    expect(catalogSerial(row)).toBe('S8')
    expect(catalogAmount(row, 'quantity')).toBe(10)
    expect(catalogAmount(row, 'weight')).toBe(1)
    row.stock.unassigned_quantity = 0
    expect(catalogAmount(row, 'quantity')).toBe(0)
    expect(catalogAmount(row, 'weight')).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { currentLocations } from './warehousePlacement'
import type { StockBatch } from '@/types/teamMaterials'

describe('current warehouse placement', () => {
  it('never presents the historical receipt location as current placement', () => {
    const row = { transfer: { warehouse_location: 'A-old' }, warehouse_positions: [], unassigned_quantity: 10, unassigned_weight: 1 } as unknown as StockBatch
    expect(currentLocations(row)).toBe('未分配仓位')
    expect(currentLocations({ ...row, unassigned_quantity: 0, unassigned_weight: 0 })).toBe('已转出，无占用仓位')
    expect(currentLocations({ ...row, warehouse_positions: [{ location_id: 2, name: 'B', quantity: 2, weight: 1 }] })).toBe('B、未分配仓位')
  })
})

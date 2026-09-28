import { describe, expect, it } from 'vitest'
import { warehouseColumns, warehouseSearchColumns, inventoryStockStatus } from './teamInventory'
import { warehouseFixture } from '@/testFixtures/teamInventory'

describe('classified stock presentation', () => {
  it('offers actual searchable fields, not composite display columns', () => {
    expect(warehouseSearchColumns.map(column => column.key)).toContain('purpose_name')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('oldest_received_at')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('stock_balance')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('movement')
    for (const key of ['owned_quantity', 'owned_weight']) expect(warehouseSearchColumns.map(column => column.key)).toContain(key)
    for (const key of ['stock_status', 'dispatchable_quantity', 'dispatchable_weight', 'in_transit_quantity', 'in_transit_weight']) expect(warehouseSearchColumns.map(column => column.key)).not.toContain(key)
  })
  it('distinguishes available, partial, all pending, external confirmation, weight-only and unknown stock', () => {
    const row = warehouseFixture({ available_quantity: 100, available_weight: 10, reserved_quantity: 0, reserved_weight: 0, in_transit_quantity: 0, in_transit_weight: 0 })
    expect(inventoryStockStatus(row)).toBe('可出库')
    const pending = { ...row, reserved_quantity: 100, reserved_weight: 10, in_transit_quantity: 100, in_transit_weight: 10 }
    expect(inventoryStockStatus(pending)).toBe('部分待签收')
    expect(inventoryStockStatus({ ...pending, available_quantity: 0, available_weight: 0 })).toBe('全部待签收')
    expect(inventoryStockStatus({ ...pending, external_pending_weight: 2 })).toBe('部分待确认')
    expect(inventoryStockStatus({ ...pending, available_quantity: 0, available_weight: 0, external_pending_weight: 10, in_transit_quantity: 0, in_transit_weight: 0 })).toBe('全部待确认')
    expect(inventoryStockStatus({ ...row, available_quantity: 0, available_weight: 0.001 })).toBe('可出库')
    expect(inventoryStockStatus({ ...row, material_type: 'sludge', scrap_available_quantity: 0, scrap_available_weight: 1 })).toBe('可处理')
    expect(inventoryStockStatus({ ...row, available_quantity: 0, available_weight: 0 })).toBe('暂无库存')
    expect(inventoryStockStatus({ ...row, available_quantity: null, available_weight: null })).toBe('库存待核对')
  })
  it('exposes independent columns without changing their balances or unknown values', () => {
    const row = warehouseFixture({ material_type: 'sludge', purpose_name: '废泥回库', available_quantity: 0, available_weight: 0, scrap_available_quantity: 0, scrap_available_weight: 3.456, owned_quantity: null, owned_weight: null })
    const display = (key: string) => warehouseColumns.find(column => column.key === key)!.format(row)
    expect(display('material_type')).toBe('废泥')
    expect(display('purpose_name')).toBe('废泥回库')
    expect(display('dispatchable_quantity')).toBe('0')
    expect(display('dispatchable_weight')).toBe('3.456')
    expect(display('owned_quantity')).toBe('—')
    expect(display('owned_weight')).toBe('—')
    expect(warehouseColumns.map(column => column.key)).not.toEqual(expect.arrayContaining(['stock_balance', 'owned_balance', 'dispatchable_balance', 'pending_transfer']))
  })
})

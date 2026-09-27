import { describe, expect, it } from 'vitest'
import { warehouseSearchColumns } from './teamInventory'

describe('classified stock presentation', () => {
  it('offers actual searchable fields, not composite display columns', () => {
    expect(warehouseSearchColumns.map(column => column.key)).toContain('purpose_name')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('oldest_received_at')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('stock_balance')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('movement')
  })
})

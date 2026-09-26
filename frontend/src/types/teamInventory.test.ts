import { describe, expect, it } from 'vitest'
import { inventoryAge, inventoryBalanceState, warehouseSearchColumns } from './teamInventory'
import { warehouseFixture } from '@/testFixtures/teamInventory'

describe('classified stock presentation', () => {
  it('uses receipt elapsed time, leaves unknown dates unknown, and never calls age overdue', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    expect(inventoryAge('2026-09-16T12:00:00Z', now)).toBe('已在库 10 天')
    expect(inventoryAge('2026-09-26T11:00:00Z', now)).toBe('不足 1 天')
    expect(inventoryAge(null, now)).toBe('—')
    expect(inventoryAge('invalid', now)).toBe('—')
    expect(inventoryAge('2026-09-27T12:00:00Z', now)).toBe('—')
  })
  it('does not equate zero balance with production completion or full transfer', () => {
    expect(inventoryBalanceState(warehouseFixture({ on_hand_quantity: 0, on_hand_weight: 0, lost_quantity: 100 }))).toBe('无结存')
    expect(inventoryBalanceState(warehouseFixture({ on_hand_quantity: 0, on_hand_weight: .5, dispatched_quantity: 0, dispatched_weight: 0, reserved_quantity: 0, reserved_weight: 0 }))).toBe('尚未转出')
    expect(inventoryBalanceState(warehouseFixture({ reserved_weight: .1 }))).toBe('部分转出')
  })
  it('offers actual searchable fields, not composite display columns', () => {
    expect(warehouseSearchColumns.map(column => column.key)).toContain('purpose_name')
    expect(warehouseSearchColumns.map(column => column.key)).toContain('oldest_received_at')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('stock_balance')
    expect(warehouseSearchColumns.map(column => column.key)).not.toContain('movement')
  })
})

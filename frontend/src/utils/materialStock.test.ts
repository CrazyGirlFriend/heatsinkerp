import { describe, expect, it } from 'vitest'
import { amountError, stockAvailable } from './materialStock'
import type { StockBatch } from '@/types/teamMaterials'

const stock = { available_quantity: 10, available_weight: 1.005 } as StockBatch
describe('independent stock quantity and weight limits', () => {
  it('allows weight-only and quantity-only usage and exact decimal balances', () => {
    expect(amountError(0, 1.005, stock)).toBe('')
    expect(amountError(10, 0, stock)).toBe('')
    expect(stockAvailable({ ...stock, available_quantity: 0 })).toBe(true)
    expect(amountError(0, 0, stock)).toContain('至少一项')
  })
  it('rejects each exceeded dimension, missing balances and invalid precision', () => {
    expect(amountError(11, 0, stock)).toContain('超过')
    expect(amountError(0, 1.006, stock)).toContain('超过')
    expect(amountError(0.1, 0, stock)).toContain('整数')
    expect(amountError(0, 0.0001, stock)).toContain('3 位')
    expect(amountError(0, 1, { ...stock, available_weight: null })).toContain('刷新')
    expect(stockAvailable({ ...stock, available_quantity: null })).toBe(false)
    expect(amountError(undefined, 1, stock)).toContain('整数')
  })
})

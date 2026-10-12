import { describe, expect, it } from 'vitest'
import { formatAmount } from './format'
describe('material amount display', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])('shows an empty marker for %s', (value) => {
    expect(formatAmount(value)).toBe('—')
  })
  it.each([
    [0, '0'],
    [1000, '1,000'],
    [0.000001, '0.000001'],
    [12.3456784, '12.345678'],
    [-10.05, '-10.05'],
  ])('formats %s without padding decimals', (value, expected) => {
    expect(formatAmount(value as number)).toBe(expected)
  })
})

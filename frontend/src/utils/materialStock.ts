import type { StockBatch } from '@/types/teamMaterials'

export function stockAvailable(stock: StockBatch): boolean {
  return stock.available_quantity !== null && stock.available_weight !== null && (stock.available_quantity > 0 || stock.available_weight > 0)
}
export function amountError(quantity: number | undefined, weight: number | undefined, stock: StockBatch | null): string {
  if (!stock || stock.available_quantity === null || stock.available_weight === null) return '请先刷新来源批次余量'
  if (quantity == null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) return '件数须为有效非负整数'
  if (weight == null || !Number.isFinite(weight) || weight < 0 || weight > 99999999999.999 || Math.abs(weight * 1000 - Math.round(weight * 1000)) > 0.00001) return '重量须为非负数，最多 3 位小数'
  if (quantity === 0 && weight === 0) return '件数和重量至少一项大于 0'
  if (quantity > stock.available_quantity || Math.round(weight * 1000) > Math.round(stock.available_weight * 1000)) return '数量或重量超过当前可用余量'
  return ''
}
export function materialRequestKey(): string { return globalThis.crypto?.randomUUID?.() || `stock-${Date.now()}-${Math.random().toString(16).slice(2)}` }

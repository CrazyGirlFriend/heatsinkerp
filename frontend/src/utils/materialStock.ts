import type { StockBatch } from '@/types/teamMaterials'
import { isScrapType } from '@/types/materialTransfer'

export function dispatchableAmounts(stock?: StockBatch | null) {
  const scrap = isScrapType(stock?.transfer.material_type)
  return { quantity: (scrap ? stock?.scrap_available_quantity : stock?.available_quantity) ?? null,
    weight: (scrap ? stock?.scrap_available_weight : stock?.available_weight) ?? null }
}

export function stockAvailable(stock: StockBatch): boolean {
  const { quantity, weight } = dispatchableAmounts(stock)
  return quantity !== null && weight !== null && (quantity > 0 || weight > 0)
}
export function amountError(quantity: number | undefined, weight: number | undefined, stock: StockBatch | null): string {
  const free = dispatchableAmounts(stock)
  if (free.quantity === null || free.weight === null) return '请先刷新来源批次余量'
  if (quantity == null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) return '件数须为有效非负整数'
  if (weight == null || !Number.isFinite(weight) || weight < 0 || weight > 99999999999.999 || Math.abs(weight * 1000 - Math.round(weight * 1000)) > 0.00001) return '重量须为非负数，最多 3 位小数'
  if (quantity === 0 && weight === 0) return '件数和重量至少一项大于 0'
  if (quantity > free.quantity || Math.round(weight * 1000) > Math.round(free.weight * 1000)) return '数量或重量超过当前可用余量'
  return ''
}
export function materialRequestKey(): string { return globalThis.crypto?.randomUUID?.() || `stock-${Date.now()}-${Math.random().toString(16).slice(2)}` }

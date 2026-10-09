import type { StockBatch } from '@/types/teamMaterials'
import { isScrapType } from '@/types/materialTransfer'

export function dispatchableAmounts(stock?: StockBatch | null) {
  const scrap = isScrapType(stock?.transfer.material_type)
  return { quantity: (scrap ? stock?.scrap_available_quantity : stock?.available_quantity) ?? null,
    weight: (scrap ? stock?.scrap_available_weight : stock?.available_weight) ?? null }
}

export function stockSelectable(stock: StockBatch): boolean {
  const { quantity, weight } = dispatchableAmounts(stock)
  return quantity !== null && weight !== null
}
export function stockAvailable(stock: StockBatch): boolean {
  const { quantity, weight } = dispatchableAmounts(stock)
  return quantity !== null && weight !== null && (quantity > 0 || weight > 0)
}
export function outboundRemainder(quantity: number | undefined, weight: number | undefined, availableQuantity: number | null, availableWeight: number | null): number {
  if (quantity == null || weight == null || availableQuantity == null || availableWeight == null || !Number.isInteger(quantity) || quantity < 0 || weight <= 0) return 0
  return availableWeight > 0 && Math.round(weight * 1000000) === Math.round(availableWeight * 1000000) ? Math.max(0, availableQuantity - quantity) : 0
}
export function amountError(quantity: number | undefined, weight: number | undefined, stock: StockBatch | null, enforceStock = false): string {
  const free = dispatchableAmounts(stock)
  if (free.quantity === null || free.weight === null) return '请先刷新该批次的可转出库存'
  if (quantity == null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) return '件数须为有效非负整数'
  if (weight == null || !Number.isFinite(weight) || weight < 0 || weight > 99999999999.999 || Math.abs(weight * 1000000 - Math.round(weight * 1000000)) > 0.00001) return '重量须为非负数，最多 6 位小数'
  if (quantity === 0 && weight === 0) return '件数和重量至少一项大于 0'
  if (enforceStock && Math.round(weight * 1000000) > Math.round(free.weight * 1000000)) return '本次提交超过上一批次的剩余可转重量，请调整重量或重新选择批次。'
  if (enforceStock && quantity > free.quantity) return '件数超过当前可转出库存'
  return ''
}
export function materialRequestKey(): string { return globalThis.crypto?.randomUUID?.() || `stock-${Date.now()}-${Math.random().toString(16).slice(2)}` }

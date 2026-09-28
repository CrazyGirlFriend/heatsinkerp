import type { StockBatch } from '@/types/teamMaterials'

export function currentLocations(source: StockBatch): string {
  if (!source.warehouse_positions) return '仓位信息待刷新'
  const names = source.warehouse_positions.map(row => row.name)
  if (Number(source.unassigned_quantity) > 0 || Number(source.unassigned_weight) > 0) names.push('未分配仓位')
  return names.join('、') || '已转出，无占用仓位'
}

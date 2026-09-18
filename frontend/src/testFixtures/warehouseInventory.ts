import { serialFixture } from './materialAnalytics'
import type { WarehouseInventoryRow } from '@/types/warehouseInventory'

export function warehouseFixture(overrides: Partial<WarehouseInventoryRow> = {}): WarehouseInventoryRow {
  return { ...serialFixture('000128'), group_id: 11, batch_count: 2,
    material_name: '铜钼 CuMo70', transfer_specification: '100 × 80 × 5', material_type: 'raw_material',
    receipt_source: 'external', source_team_id: null, external_source: '供应商 A', source_name: '供应商 A',
    on_hand_quantity: 100, on_hand_weight: 50, ...overrides }
}

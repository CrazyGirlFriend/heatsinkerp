import { serialFixture } from './materialAnalytics'
import type { TeamInventoryRow } from '@/types/teamInventory'

export function warehouseFixture(overrides: Partial<TeamInventoryRow> = {}): TeamInventoryRow {
  return {
    ...serialFixture('000128'),
    group_id: 11,
    batch_count: 2,
    current_batch_count: 2,
    purpose_id: null,
    purpose_name: '',
    oldest_received_at: '2026-09-01T03:00:00Z',
    material_name: '铜钼 CuMo70',
    transfer_specification: '100 × 80 × 5',
    material_type: 'raw_material',
    receipt_source: 'external',
    source_team_id: null,
    external_source: '供应商 A',
    source_name: '供应商 A',
    on_hand_quantity: 100,
    on_hand_weight: 50,
    owned_quantity: 110,
    owned_weight: 51,
    external_pending_quantity: 0,
    external_pending_weight: 0,
    ...overrides,
  }
}

export function serialInventoryFixture(
  overrides: Partial<import('@/utils/inventorySerialSummary').InventorySerial> = {},
) {
  return {
    serial_no: '000128',
    shared_group_id: null,
    shared_unallocated: false,
    unnumbered_batch_no: null,
    material_name: '铜钼',
    on_hand_quantity: 10,
    on_hand_weight: 2,
    in_transit_quantity: 5,
    in_transit_weight: 1,
    stock_total_quantity: 15,
    stock_total_weight: 3,
    stock_status: '部分在途',
    processing_state: 'mixed',
    last_activity_at: '2026-11-21T08:00:00Z',
    ...overrides,
  }
}

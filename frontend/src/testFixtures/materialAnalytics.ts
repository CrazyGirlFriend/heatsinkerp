import type { MaterialAnalytics, SerialSummary } from '@/types/materialAnalytics'
export function analyticsFixture(teamId = 914): MaterialAnalytics {
  const amount = { quantity: 10, weight: 1 }
  return { team_id: teamId, days: 30, metric: 'weight', as_of: '2026-09-12T00:00:00Z',
    trend: [{ key: '2026-09-12', incoming: amount, outgoing: amount, loss: amount }],
    stock_ranking: [{ key: 'SERIAL-1', ...amount }], material_types: [{ key: 'semi_finished', ...amount }],
    materials: [{ key: '铜钼', ...amount }], loss_ranking: [{ key: 'SERIAL-1', ...amount }],
    stock_age: [{ key: 'ge7', label: '7天及以上', ...amount }], waiting_age: [{ key: 'ge7', label: '7天及以上', incoming: amount, outgoing: amount }],
    peers: { incoming: [{ key: '1', label: '库房', ...amount }], outgoing: [{ key: 'warehouse_outbound', label: '对外出库', ...amount }] } }
}
export function serialFixture(serial = 'SERIAL-1'): SerialSummary {
  return { serial_no: serial, material_name: '铜钼', material_name_count: 1, material_type: 'semi_finished', material_type_count: 1,
    transfer_specification: null, transfer_specification_count: 2, finished_specification: '10×20', finished_specification_count: 1,
    source_batch_no: 'ORIGINAL', source_batch_no_count: 1, customer_code: null, customer_code_count: 0, product_code: null, product_code_count: 0,
    finished_quantity: 100, finished_quantity_count: 1, last_activity_at: '2026-09-12T00:00:00Z',
    received_quantity: 100, received_weight: 10, dispatched_quantity: 60, dispatched_weight: 6, reserved_quantity: 10, reserved_weight: 1,
    in_transit_quantity: 10, in_transit_weight: 1,
    lost_quantity: 2, lost_weight: .2, on_hand_quantity: 28, on_hand_weight: 2.8, available_quantity: 28, available_weight: 2.8,
    pending_incoming_quantity: 15, pending_incoming_weight: 1.5, pending_outgoing_quantity: 10, pending_outgoing_weight: 1 }
}

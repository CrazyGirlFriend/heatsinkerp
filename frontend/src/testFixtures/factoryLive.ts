import type { FactoryLive } from '@/types/factoryLive'
import { factoryFixture } from './factoryOverview'

export function liveFixture(): FactoryLive {
  const base = factoryFixture()
  return { ...base,
    totals: { ...base.totals, on_hand_quantity: 800, on_hand_weight: 80, in_transit_quantity: 45, in_transit_weight: 4.5 },
    today: { outgoing_quantity: 45, received_batches: 0 },
    teams: base.teams.map((team, i) => ({ ...team, incoming: 0, outgoing: 0, pending_transfers: [],
      balance: { ...base.totals, on_hand_quantity: 100, on_hand_weight: 10 },
      material_types: i === 0 ? [{ key: 'raw_material', quantity: 50, weight: 5 }, { key: 'semi_finished', quantity: 50, weight: 5 }]
        : i === 4 ? [{ key: 'semi_finished', quantity: 100, weight: 9.875 }, { key: 'sludge', quantity: 0, weight: .125 }]
          : [{ key: 'semi_finished', quantity: 100, weight: 10 }],
    })),
    material_types: [{ key: 'raw_material', quantity: 50, weight: 5 }, { key: 'semi_finished', quantity: 750, weight: 74.875 }, { key: 'sludge', quantity: 0, weight: .125 }],
    material_stock: [{ key: '铜钼', quantity: 800, weight: 80 }],
    internal_pending: { batches: 5, quantity: 45, weight: 4.5 },
    links: [
      { source_id: 1, target_id: 2, pending_batches: 2, confirmed_batches: 0, pending_quantity: 20, pending_weight: 2 },
      { source_id: 1, target_id: 3, pending_batches: 1, confirmed_batches: 0, pending_quantity: 10, pending_weight: 1 },
      { source_id: 2, target_id: 1, pending_batches: 1, confirmed_batches: 0, pending_quantity: 5, pending_weight: .5 },
      { source_id: 8, target_id: 3, pending_batches: 1, confirmed_batches: 0, pending_quantity: 10, pending_weight: 1 },
    ],
    recent_batches: [{ batch_no: 'TL-REAL-BATCH', source_id: 1, target_id: 2, source_name: '库房', target_name: '轧制',
      entry_kind: 'transfer', external_destination: null, status: 'pending', line_count: 1, quantity: 10, weight: 1,
      serial_count: 1, material_count: 1, material_name: '铜钼', waiting_since: '2026-09-12T01:00:00Z', updated_at: '2026-09-12T01:01:00Z' }],
  }
}

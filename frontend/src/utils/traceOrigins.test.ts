import { describe, expect, it } from 'vitest'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { MaterialTrace, TraceBatch } from '@/types/materialTrace'
import { traceOrigins, traceOriginScope } from './traceOrigins'

const lot = (id: number, parent: number | null, overrides: Partial<TraceBatch> = {}): TraceBatch => ({
  ...normalizeMaterialTransfer({ id, batch_no: `B${id}`, source_transfer_id: parent, status: 'received', stock_tracked: true, entry_kind: parent ? 'transfer' : 'warehouse_receipt', transferred_at: `2026-09-${String(id).padStart(2, '0')}T00:00:00Z`, next_team: { id: 1, code: 'FACTORY-WAREHOUSE', name: '库房' }, material_type: 'semi_finished', quantity: 100, weight: 100 }),
  on_hand_quantity: 0, on_hand_weight: 0, ...overrides,
})
const trace = (items: TraceBatch[]): MaterialTrace => ({ serial_no: 'YS', items, positions: [], untracked_count: 0, totals: { on_hand: { quantity: 0, weight: 0 }, in_transit: { quantity: 0, weight: 0 }, external_pending: { quantity: 0, weight: 0 }, dispatched: { quantity: 0, weight: 0 }, lost: { quantity: 0, weight: 0 } } })

describe('warehouse origin scope', () => {
  it('recomputes signed measured differences for the selected family and counts each processing root only once', () => {
    const rows = [lot(1, null, { processing_delta_weight: -.500001, weight_difference: -.500001, weight_root_transfer_id: 1 }), lot(2, 1, { entry_kind: 'processing_output', processing_delta_weight: 0, weight_difference: -.500001, weight_root_transfer_id: 1, on_hand_weight: 99.499999 }), lot(3, null, { processing_delta_weight: 3, weight_difference: 3, weight_root_transfer_id: 3, on_hand_weight: -3 })]
    const scoped = traceOriginScope({ ...trace(rows), processing_delta_weight: 2.499999, weight_difference: 2.499999, max_weight_difference: 3, shortage: { quantity: 0, weight: 3 } }, [rows[0]!, rows[1]!])
    expect(scoped.processing_delta_weight).toBe(-.500001)
    expect(scoped.weight_difference).toBe(-.500001)
    expect(scoped.max_weight_difference).toBe(.500001)
    expect(scoped.shortage?.weight).toBe(0)
    expect(scoped.totals.on_hand.weight).toBe(99.499999)
    expect(scoped.totals.lost.weight).toBe(0)
  })
  it('keeps all splits and returns in their own intake family, with stable colors', () => {
    const rows = [lot(5, 3), lot(2, null), lot(4, 1), lot(3, 1), lot(1, null)]
    const result = traceOrigins(rows)
    expect(result.groups.map(group => group.items.map(item => item.id).sort())).toEqual([[1, 3, 4, 5], [2]])
    expect(result.originById.get('5')?.batch_no).toBe('B1')
    expect(result.colors.get('5')).toBe(result.colors.get('4'))
    expect(result.colors.get('2')).not.toBe(result.colors.get('1'))
  })
  it('does not call an unlinked legacy handoff a warehouse intake', () => {
    const result = traceOrigins([lot(3, 999)])
    expect(result.groups[0]?.name).toBe('历史起点')
    expect(result.originById.get('3')?.id).toBe(3)
  })
  it('preserves pending ownership and separates waste without double-counting transferred stock', () => {
    const rows = [lot(1, null, { on_hand_quantity: 40, on_hand_weight: 40, owned_quantity: 40, owned_weight: 40 }),
      lot(2, 1, { quantity: 60, weight: 60, on_hand_quantity: 20, on_hand_weight: 20, owned_quantity: 60, owned_weight: 60, next_team: { id: 2, code: 'ROLL', name: '轧制' } }),
      lot(3, 2, { quantity: 40, weight: 40, status: 'pending', material_type: 'waste', on_hand_quantity: null, on_hand_weight: null }),
      lot(4, null, { quantity: 999, weight: 999, on_hand_quantity: 999, on_hand_weight: 999 })]
    const scoped = traceOriginScope(trace(rows), traceOrigins(rows).groups[0]!.items)
    expect(scoped.items).toHaveLength(3)
    expect(scoped.holdings?.map(team => team.material_types)).toEqual([
      [{ material_type: 'semi_finished', quantity: 40, weight: 40 }],
      [{ material_type: 'semi_finished', quantity: 60, weight: 60 }],
    ])
    expect(scoped.totals.in_transit.weight).toBe(40)
    expect(scoped.positions.map(position => [position.team_id, position.weight])).toEqual([[1, 40], [2, 20]])
    const received = { ...rows[2]!, status: 'received' as const, on_hand_quantity: 40, on_hand_weight: 40, owned_quantity: 40, owned_weight: 40 }
    const after = traceOriginScope(trace(rows), [rows[0]!, { ...rows[1]!, owned_quantity: 20, owned_weight: 20 }, received])
    expect(after.holdings?.[0]?.material_types).toContainEqual({ material_type: 'waste', quantity: 40, weight: 40 })
    expect(after.holdings?.flatMap(team => team.material_types).reduce((sum, nature) => sum + nature.weight, 0)).toBe(100)
  })
})

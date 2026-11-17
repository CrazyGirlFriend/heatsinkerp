import { describe, expect, it } from 'vitest'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { BOARD_DAY, boardDate, boardQuantity, boardDeliveryState } from './scheduleBoard'
const node = (id: number, overrides: Partial<ProductionSchedule> = {}) =>
  ({
    id,
    sequence_no: id,
    team_id: id,
    team_name: '研磨',
    status: 'pending',
    planning_state: 'confirmed',
    target_quantity: 100,
    due_at: '2026-11-04T16:00:00+08:00',
    dispatched_quantity: 0,
    dispatched_weight: 0,
    ...overrides,
  }) as ProductionSchedule

describe('production timeline data', () => {
  it('uses factory dates at UTC boundaries', () => {
    expect(boardDate(Date.parse('2026-11-02T18:00:00Z'))).toBe('2026-11-03')
  })
  it('does not multiply the same material quantity by the number of teams', () => {
    const task = { nodes: [node(3), node(1), node(2)] } as ScheduleTask
    expect(boardQuantity(task)).toBe(100)
    expect(
      boardQuantity({
        ...task,
        delivery_batches: [
          { batch_number: 1, due_at: '', target_quantity: 60 },
          { batch_number: 2, due_at: '', target_quantity: 40 },
        ],
      }),
    ).toBe(100)
  })
})

// Receipt and partial dispatch must not be mistaken for completion of a delivery promise.
describe('delivery marks', () => {
  const now = Date.parse('2026-11-04T17:00:00+08:00')
  it('preserves late completion and trusts dispatched completion rather than receipt counts', () => {
    expect(boardDeliveryState(node(1, { status: 'completed' }), now)).toBe('completed')
    expect(boardDeliveryState(node(1, { status: 'completed_late' }), now)).toBe('completed_late')
    expect(
      boardDeliveryState(node(1, { dispatched_quantity: 40, received_quantity: 100 }), now),
    ).toBe('overdue')
    expect(boardDeliveryState(node(1, { dispatched_quantity: 40 }), now - BOARD_DAY)).toBe(
      'pending',
    )
  })
  it('does not mark non-assessed warehouse preparation as overdue', () => {
    expect(boardDeliveryState(node(1, { assessment_enabled: false }), now)).toBe('unassessed')
    expect(boardDeliveryState(node(1, { status: 'not_assessed' }), now)).toBe('unassessed')
  })
})

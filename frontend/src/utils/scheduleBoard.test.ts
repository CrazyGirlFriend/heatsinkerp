import { describe, expect, it } from 'vitest'
import type { ProductionSchedule, ScheduleBatch, ScheduleTask } from '@/types/productionSchedule'
import {
  BOARD_DAY,
  boardDay,
  boardDate,
  boardQuantity,
  boardSummaryNodes,
  layoutBoardBars,
  boardBatchFlow,
  boardBarState,
} from './scheduleBoard'
const start = Date.parse('2026-11-01T00:00:00+08:00')
const batch = (id: number, overrides: Partial<ScheduleBatch> = {}): ScheduleBatch => ({
  id,
  batch_number: id,
  planned_start_at: '2026-11-02T08:00:00+08:00',
  due_at: '2026-11-04T16:00:00+08:00',
  target_quantity: 40,
  target_weight: null,
  upstream_batch_ids: [],
  status: 'pending',
  warnings: [],
  dispatched_quantity: 0,
  dispatched_weight: 0,
  received_quantity: 0,
  received_weight: 0,
  completed_at: null,
  ...overrides,
})
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
    expect(new Date(boardDay(Date.parse('2026-11-02T18:00:00Z'))).toISOString()).toBe(
      '2026-11-02T16:00:00.000Z',
    )
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
  it('keeps overlapping batches on separate lanes without stretching their intervals', () => {
    const result = layoutBoardBars(
      [node(1, { batches: [batch(11), batch(12)] })],
      start,
      start + 7 * BOARD_DAY,
      700,
    )
    expect(result.height).toBe(88)
    expect(result.bars.map((bar) => bar.lane)).toEqual([0, 1])
    expect(result.bars[0]!.width).toBeCloseTo(233.333, 2)
    expect(result.bars[0]!.node.parent_schedule_id).toBe(1)
  })
  it('shows no invented interval for missing plans or missing start dates', () => {
    expect(
      layoutBoardBars(
        [node(1, { planning_state: 'pending' }), node(2, { planning_state: 'submitted' })],
        start,
        start + 7 * BOARD_DAY,
        700,
      ).bars,
    ).toEqual([])
    const result = layoutBoardBars([node(3)], start, start + 7 * BOARD_DAY, 700)
    expect(result.bars[0]!.interval).toBe(false)
    expect(result.bars[0]!.start).toBe(result.bars[0]!.end)
  })
  it('clips dates at the viewport and keeps offscreen plans available for locating', () => {
    const result = layoutBoardBars(
      [
        node(1, {
          batches: [
            batch(1, { planned_start_at: '2026-10-30T00:00:00+08:00' }),
            batch(2, {
              planned_start_at: '2026-12-01T00:00:00+08:00',
              due_at: '2026-12-05T00:00:00+08:00',
            }),
          ],
        }),
      ],
      start,
      start + 7 * BOARD_DAY,
      700,
    )
    expect(result.bars).toHaveLength(1)
    expect(result.bars[0]).toMatchObject({ left: 0, clippedStart: true })
    expect(result.outside).toBe(1)
  })
  it('follows explicit split/merge links without pulling in a sibling branch', () => {
    const nodes = [
      node(1, { batches: [batch(11)] }),
      node(2, {
        batches: [batch(21, { upstream_batch_ids: [11] }), batch(22, { upstream_batch_ids: [11] })],
      }),
      node(3, { batches: [batch(31, { upstream_batch_ids: [21] }), batch(32)] }),
    ]
    expect([...boardBatchFlow(nodes, -21).ids].sort()).toEqual([-11, -21, -31].sort())
    expect(boardBatchFlow(nodes, -32).links).toEqual([])
    expect(boardBatchFlow(nodes, -11).ids.has(-22)).toBe(true)
  })
  it('keeps actual team stock in the summary without allocating it to planned batches', () => {
    const parent = node(1, {
      batches: [batch(11), batch(12)],
      received_quantity: 40,
      stock: {
        on_hand_quantity: 40,
        on_hand_weight: 0,
        pending_quantity: 0,
        pending_weight: 0,
        batch_count: 1,
        rework_quantity: 0,
      },
    })
    const summary = boardSummaryNodes([parent])
    expect(summary[0]!.batches).toBeUndefined()
    expect(summary[0]!.target_quantity).toBe(100)
    expect(boardBarState(summary[0]!)).toBe('stock')
    const expanded = layoutBoardBars([parent], start, start + 7 * BOARD_DAY, 700)
    expect(expanded.bars.map((bar) => boardBarState(bar.node))).toEqual(['planned', 'planned'])
    expect(boardBarState(node(1, { received_quantity: 40 }))).toBe('planned')
    expect(boardBarState(node(1, { dispatched_quantity: 20 }))).toBe('partial')
    expect(boardBarState(node(1, { status: 'completed_late' }))).toBe('done')
  })
})

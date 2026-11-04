import { describe, expect, it } from 'vitest'
import type { ProductionSchedule, ScheduleBatch, ScheduleTask } from '@/types/productionSchedule'
import { ganttDate, ganttRange, ganttRowHeight, scheduleGanttRecords } from './scheduleGantt'

const batch = (id: number, overrides: Partial<ScheduleBatch> = {}): ScheduleBatch => ({
  id,
  batch_number: id,
  planned_start_at: '2026-11-02T00:00:00Z',
  due_at: '2026-11-02T08:00:00Z',
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
    team_id: 2,
    sequence_no: id,
    team_name: '退火',
    status: 'pending',
    planning_state: 'confirmed',
    target_quantity: 80,
    completion_basis: 'quantity',
    due_at: '2026-11-02T08:00:00Z',
    batches: [batch(id)],
    ...overrides,
  }) as ProductionSchedule
const task = (nodes: ProductionSchedule[]) =>
  ({
    id: 1,
    serial_no: '691236-51',
    final_due_at: '2026-11-04T09:00:00Z',
    delivery_batches: [{ batch_number: 1, target_quantity: 80, due_at: '2026-11-04T09:00:00Z' }],
    nodes,
  }) as ScheduleTask

describe('VTable schedule adapter', () => {
  it('expands only the first serial so other materials remain visible in the overview', () => {
    const records = scheduleGanttRecords([task([node(1)]), { ...task([node(2)]), id: 2 }])
    expect(records.map((record) => record.hierarchyState)).toEqual(['expand', 'collapse'])
  })
  it('preserves repeated visits, separate quantities, and immutable source records', () => {
    const source = task([node(3), node(1, { team_name: '库房', target_quantity: 10 }), node(2)])
    const before = JSON.stringify(source)
    const [record] = scheduleGanttRecords([source])
    expect(record?.quantity).toBe('80')
    expect(record?.children?.map((child) => [child.name, child.quantity])).toEqual([
      ['01  库房', '10'],
      ['02  退火', '80'],
      ['03  退火', '80'],
      ['最终交期', ''],
    ])
    expect(record?.children?.[1]?.children?.[0]?.node?.parent_schedule_id).toBe(2)
    expect(JSON.stringify(source)).toBe(before)
  })
  it('keeps exact factory hours and uses exclusive handover end time', () => {
    const [record] = scheduleGanttRecords([task([node(1)])])
    const leaf = record!.children![0]!.children![0]!
    expect(leaf.start).toBe('2026-11-02T08:00:00.000')
    expect(leaf.end).toBe('2026-11-02T15:59:59.999')
    expect(leaf.endTime! - leaf.startTime!).toBe(8 * 3_600_000)
    expect(ganttDate(Date.parse('2026-11-02T18:00:00Z'))).toBe('2026-11-03T02:00:00.000')
  })
  it('keeps overlapping team windows on separate lanes, with batches available in child rows', () => {
    const [record] = scheduleGanttRecords([
      task([node(1, { batches: [batch(1), batch(2)] }), node(2)]),
    ])
    const team = record!.children![0]!
    expect(team.children!.map((child) => child.lanes[team.id])).toEqual([0, 1])
    expect(record!.laneCount).toBe(2)
    expect(ganttRowHeight(team)).toBe(60)
    team.hierarchyState = 'expand'
    expect(ganttRowHeight(team)).toBe(60)
  })
  it('summarizes the real team window and total dispatch without averaging batch percentages', () => {
    const [record] = scheduleGanttRecords([
      task([
        node(1, {
          target_quantity: 100,
          dispatched_quantity: 60,
          batches: [
            batch(1, { target_quantity: 60, dispatched_quantity: 60 }),
            batch(2, {
              target_quantity: 40,
              dispatched_quantity: 0,
              planned_start_at: '2026-11-03T00:00:00Z',
              due_at: '2026-11-03T08:00:00Z',
            }),
          ],
        }),
      ]),
    ])
    const team = record!.children![0]!
    expect(team.type).toBe('task')
    expect(team.progress).toBe(60)
    expect(team.startTime).toBe(Date.parse('2026-11-02T00:00:00Z'))
    expect(team.endTime).toBe(Date.parse('2026-11-03T08:00:00Z'))
    expect(team.children!.map((batch) => batch.progress)).toEqual([100, 0])
    expect(team.node?.planned_start_at).toBe('2026-11-02T00:00:00.000Z')
  })
  it('does not invent a start time or fabricate unconfirmed plans', () => {
    const [record] = scheduleGanttRecords([
      task([
        node(1, { batches: [batch(1, { planned_start_at: undefined })] }),
        node(2, { planning_state: 'pending', batches: [] }),
      ]),
    ])
    expect(record!.children![0]!.children![0]!.type).toBe('milestone')
    expect(record!.children![1]!.name).toContain('待填写')
    expect(record!.children![1]!.start).toBeUndefined()
    expect(record!.children![1]!.children).toBeUndefined()
  })
  it('fits all saved batches and the final deadline, independent of today', () => {
    const records = scheduleGanttRecords([task([node(1)])])
    expect(ganttRange(records, Date.parse('2027-01-01'))).toEqual(['2026-11-02', '2026-11-05'])
  })
  it('keeps delivery and receipt totals separate and excludes cancelled batches', () => {
    const [record] = scheduleGanttRecords([
      task([
        node(1, {
          batches: [
            batch(1, { status: 'completed_late', dispatched_quantity: 40, received_quantity: 12 }),
            batch(2, { status: 'cancelled' }),
          ],
        }),
      ]),
    ])
    const children = record!.children![0]!.children!
    expect(children).toHaveLength(1)
    expect(children[0]!.node).toMatchObject({
      status: 'completed_late',
      dispatched_quantity: 40,
      received_quantity: 12,
    })
  })
  it('uses batch dispatch progress, not receipts, elapsed time or another operation total', () => {
    const [record] = scheduleGanttRecords([
      task([
        node(1, {
          dispatched_quantity: 80,
          batches: [
            batch(1, { dispatched_quantity: 24, received_quantity: 12, status: 'overdue' }),
            batch(2, { dispatched_quantity: 40, received_quantity: 0, status: 'completed_late' }),
          ],
        }),
        node(2, { batches: [batch(3)] }),
      ]),
    ])
    expect(record!.children![0]!.children!.map((child) => child.progress)).toEqual([60, 100])
    expect(record!.children![1]!.children![0]!.progress).toBe(0)
    expect(record!.progress).toBeUndefined()
  })
  it('honors weight and dual targets and leaves unassessed or missing targets unknown', () => {
    const [record] = scheduleGanttRecords([
      task([
        node(1, {
          completion_basis: 'weight',
          batches: [batch(1, { target_weight: 10, dispatched_weight: 3.5 })],
        }),
        node(2, {
          completion_basis: 'both',
          batches: [batch(2, { dispatched_quantity: 40, target_weight: 10, dispatched_weight: 6 })],
        }),
        node(3, { batches: [batch(3, { target_quantity: null })] }),
        node(4, { assessment_enabled: false }),
      ]),
    ])
    expect(record!.children!.slice(0, 4).map((team) => team.children![0]!.progress)).toEqual([
      35,
      60,
      null,
      null,
    ])
  })
})

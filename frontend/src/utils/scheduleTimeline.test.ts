import { describe, expect, it } from 'vitest'
import type { ProductionSchedule } from '@/types/productionSchedule'
import {
  scheduleAxis,
  scheduleLanes,
  scheduleTimestamp,
  SCHEDULE_ROW_HEIGHT,
  SCHEDULE_PLAN_Y,
} from './scheduleTimeline'

const now = Date.parse('2026-10-22T08:00:00Z')
const node = (id: number, overrides: Partial<ProductionSchedule> = {}) =>
  ({
    id,
    due_at: '2026-10-22T08:00:00Z',
    completed_at: null,
    sequence_no: id,
    predecessor_id: null,
    team_name: '轧制',
    status: 'pending',
    ...overrides,
  }) as ProductionSchedule

describe('delivery milestone time axis', () => {
  it('uses Beijing calendar days and preserves hour positions independent of local timezone', () => {
    const axis = scheduleAxis(now, 'day')
    expect(new Date(axis.start).toISOString()).toBe('2026-10-20T16:00:00.000Z')
    expect(axis.days).toHaveLength(3)
    expect(axis.days.find((day) => day.today)?.label).toBe('10-22')
    expect(axis.position(now + 3_600_000) - axis.position(now)).toBe(24)
    expect(scheduleTimestamp('2026-10-22T08:00:00')).toBe(now)
    expect(scheduleTimestamp('2026-10-22T16:00:00+08:00')).toBe(now)
    expect(scheduleTimestamp('not a date')).toBeNull()
  })

  it('bounds both scales even when navigating decades into the future', () => {
    const future = Date.parse('2099-01-01T00:00:00Z')
    const axis = scheduleAxis(now, 'week', future)
    expect(axis.days).toHaveLength(14)
    expect(axis.width).toBe(1344)
    expect(axis.days.some((day) => day.today)).toBe(false)
    expect(scheduleAxis(now, 'day', future).width).toBe(1728)
  })

  it('keeps same-hour repeated-team nodes on separate rows and only connects explicit predecessors', () => {
    const axis = scheduleAxis(now, 'day')
    const model = scheduleLanes(
      [
        node(3, { predecessor_id: 1, sequence_no: 3 }),
        node(2, { predecessor_id: 999, sequence_no: 2 }),
        node(1, { sequence_no: 1 }),
      ],
      axis,
    )
    expect(model.rows.map((row) => row.node.id)).toEqual([1, 2, 3])
    expect(model.rows.map((row) => row.dueX)).toEqual([960, 960, 960])
    expect(model.links).toHaveLength(1)
    expect(model.links[0]?.id).toBe('1-3')
    expect(model.links[0]?.path).toContain(`${SCHEDULE_ROW_HEIGHT * 2 + SCHEDULE_PLAN_Y - 14}`)
    expect(model.links[0]).toMatchObject({ sourceId: 1, targetId: 3, status: 'pending' })
    expect(model.links[0]?.path).toContain('C 932')
    // Another task with the same team cannot acquire a synthetic predecessor.
    expect(scheduleLanes([node(4, { predecessor_id: 1 })], axis).links).toHaveLength(0)
  })

  it('plots only real completion dates and preserves early, late, cancelled and out-of-window milestones', () => {
    const axis = scheduleAxis(now, 'day')
    const model = scheduleLanes(
      [
        node(1, { completed_at: '2026-10-22T07:00:00Z', status: 'completed' }),
        node(2, {
          completed_at: '2026-10-22T09:00:00Z',
          status: 'completed_late',
          predecessor_id: 1,
        }),
        node(3, { status: 'cancelled', predecessor_id: 2 }),
        node(4, { due_at: '2099-01-01T00:00:00Z', predecessor_id: 3 }),
      ],
      axis,
    )
    expect(model.rows[0]!.completedX! - model.rows[0]!.dueX!).toBe(-24)
    expect(model.rows[1]!.completedX! - model.rows[1]!.dueX!).toBe(24)
    expect(model.rows[2]?.completedX).toBeNull()
    expect(model.links.find((link) => link.id === '2-3')?.cancelled).toBe(true)
    expect(model.links.some((link) => link.id === '3-4')).toBe(false)
    expect(model.rows[3]!.dueX!).toBeGreaterThan(axis.width)
  })
})

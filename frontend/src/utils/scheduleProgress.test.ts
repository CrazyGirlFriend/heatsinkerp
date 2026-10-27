import { describe, expect, it } from 'vitest'
import {
  nodeCompletion,
  PROGRESS_CARD_WIDTH,
  PROGRESS_LANE_HEIGHT,
  progressMarkers,
  progressRange,
  progressWeek,
  taskRisk,
} from './scheduleProgress'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
const now = Date.parse('2026-10-23T10:00:00+08:00')
const node = (id: number, due_at: string) =>
  ({
    ...scheduleSummaryFixture(),
    id,
    due_at,
    sequence_no: id,
    predecessor_id: id > 1 ? id - 1 : null,
  }) as ProductionSchedule

describe('progress calendar and reminders', () => {
  it('uses Monday and factory timezone independently of browser timezone', () => {
    const week = progressWeek(now, now)
    expect(new Date(week.start).toISOString()).toBe('2026-10-18T16:00:00.000Z')
    expect(week.days.filter((day) => day.today).map((day) => day.label)).toEqual(['10/23'])
    expect(progressWeek(now, now, 84).days).toHaveLength(84)
    expect(progressWeek(now, now, 84).days[7]!.weekday).toBe('周一')
    expect(progressWeek(now, now, 84).days[83]!.weekday).toBe('周日')
  })
  it('preserves a custom Tuesday start across a year boundary in factory time', () => {
    const range = progressRange(
      Date.parse('2026-12-29T00:00:00+08:00'),
      Date.parse('2027-01-06T00:00:00+08:00'),
      Date.parse('2027-01-01T00:30:00+08:00'),
    )
    expect(range.days).toHaveLength(8)
    expect(range.days[0]).toMatchObject({ label: '12/29', weekday: '周二' })
    expect(range.days[7]).toMatchObject({ label: '01/05', weekday: '周二' })
    expect(range.days.filter((day) => day.today).map((day) => day.label)).toEqual(['01/01'])
  })
  it('keeps simultaneous and repeated visits visible on separate lanes at their actual deadlines', () => {
    const week = progressWeek(now, now)
    const result = progressMarkers(
      [
        node(1, '2026-10-23T10:00:00+08:00'),
        node(2, '2026-10-23T10:00:00+08:00'),
        node(3, '2027-01-01T12:00:00+08:00'),
      ],
      week,
      500,
    )
    expect(result.markers.map((item) => item.node.id)).toEqual([1, 2])
    expect(result.markers[0]!.x).toBe(result.markers[1]!.x)
    expect(result.markers[0]!.top).not.toBe(result.markers[1]!.top)
    expect(result.outside.map((item) => item.id)).toEqual([3])
    expect(result.height).toBe(PROGRESS_LANE_HEIGHT * 2 + 8)
    expect(result.links).toHaveLength(1)
    const separate = progressMarkers(
      [node(1, '2026-10-23T10:00:00+08:00'), node(2, '2026-10-23T13:00:00+08:00')],
      week,
      500,
    )
    expect(separate.markers).toHaveLength(2)
    expect(separate.height).toBe(PROGRESS_LANE_HEIGHT * 2 + 8)
    const enlarged = progressMarkers(
      separate.visible.map((item) => item.node),
      week,
      8000,
    )
    expect(enlarged.markers).toHaveLength(2)
    expect(enlarged.links).toHaveLength(1)
    expect(enlarged.height).toBe(56)
  })
  it('fits two same-day operations in a compact row while retaining morning and afternoon deadlines', () => {
    const range = progressWeek(now, now)
    const result = progressMarkers(
      [node(1, '2026-10-23T10:00:00+08:00'), node(2, '2026-10-23T17:00:00+08:00')],
      range,
      7 * (PROGRESS_CARD_WIDTH + 24),
    )
    expect(result.height).toBeLessThanOrEqual(88)
    const [morning, afternoon] = result.markers
    expect(afternoon!.x).toBeGreaterThan(morning!.x)
    expect(afternoon!.top - morning!.top).toBeGreaterThanOrEqual(40)
    expect(afternoon!.x + afternoon!.labelOffset).toBeGreaterThan(morning!.x + morning!.labelOffset)
    expect(result.links[0]).toMatchObject({ fromId: 1, id: 2 })
  })
  it('does not predict punctual delivery from the absence of a late node', () => {
    const task = { status: 'pending', nodes: [] } as unknown as ScheduleTask
    expect(taskRisk(task).label).toBe('无逾期')
    expect(taskRisk({ ...task, status: 'not_assessed' }).label).toBe('库房备料')
    expect(taskRisk({ ...task, nodes: [{ ...node(1, ''), quality_held: true }] }).label).toBe(
      '质量暂扣',
    )
  })
  it('keeps midnight and end-of-range deadlines at their exact positions with labels inside the table', () => {
    const midnight = Date.parse('2026-10-23T00:00:00+08:00')
    const range = progressRange(midnight, midnight + 86_400_000, now)
    const result = progressMarkers(
      [
        node(1, new Date(midnight).toISOString()),
        node(2, new Date(midnight + 86_400_000 - 60_000).toISOString()),
      ],
      range,
      500,
    )
    expect(result.visible[0]!.x).toBe(0)
    expect(result.visible[1]!.x).toBeCloseTo((500 * 1439) / 1440)
    for (const marker of result.visible) {
      expect(marker.x + marker.labelOffset).toBeGreaterThanOrEqual(0)
      expect(marker.x + marker.labelOffset + PROGRESS_CARD_WIDTH).toBeLessThanOrEqual(500)
    }
  })
  it('keeps adjacent-day cards in one row without moving their deadline anchors', () => {
    const week = progressWeek(now, now)
    const result = progressMarkers(
      [node(1, '2026-10-20T16:00:00+08:00'), node(2, '2026-10-21T10:00:00+08:00')],
      week,
      7 * (PROGRESS_CARD_WIDTH + 8),
    )
    expect(result.height).toBe(56)
    const [first, second] = result.markers
    expect(first!.x).toBeCloseTo((PROGRESS_CARD_WIDTH + 8) * (1 + 16 / 24))
    expect(second!.x).toBeCloseTo((PROGRESS_CARD_WIDTH + 8) * (2 + 10 / 24))
    expect(first!.x + first!.labelOffset + PROGRESS_CARD_WIDTH).toBeLessThan(
      second!.x + second!.labelOffset,
    )
  })
  it('distinguishes overdue delivery from an upcoming deadline', () => {
    const task = { status: 'pending', nodes: [] } as unknown as ScheduleTask
    expect(taskRisk({ ...task, nodes: [{ ...node(1, ''), status: 'today' }] })).toEqual({
      tone: 'watch',
      label: '今日交货',
    })
    expect(taskRisk({ ...task, nodes: [{ ...node(1, ''), status: 'overdue' }] })).toEqual({
      tone: 'late',
      label: '1 项逾期',
    })
    expect(taskRisk({ ...task, status: 'completed_late' })).toEqual({
      tone: 'late',
      label: '逾期交完',
    })
  })
})

describe('individual operation progress', () => {
  it('uses each operation target, without treating processing as dispatch or summing stages', () => {
    const input = {
      ...node(1, ''),
      target_quantity: 1,
      processed_quantity: 1,
      dispatched_quantity: 1,
    }
    const cut = {
      ...node(2, ''),
      target_quantity: 100,
      processed_quantity: 60,
      dispatched_quantity: 40,
    }
    expect(nodeCompletion(input)).toEqual({ processed: 100, dispatched: 100 })
    expect(nodeCompletion(cut)).toEqual({ processed: 60, dispatched: 40 })
    expect(nodeCompletion({ ...cut, processed_quantity: 120 })).toEqual({
      processed: 100,
      dispatched: 40,
    })
  })
  it('does not invent processing for weight-only targets or warehouse completion', () => {
    const weight = {
      ...node(1, ''),
      completion_basis: 'weight' as const,
      target_weight: 10,
      dispatched_weight: 4,
    }
    expect(nodeCompletion(weight)).toEqual({ processed: null, dispatched: 40 })
    expect(nodeCompletion({ ...weight, assessment_enabled: false })).toEqual({
      processed: null,
      dispatched: null,
    })
    expect(nodeCompletion({ ...weight, status: 'cancelled' })).toEqual({
      processed: null,
      dispatched: null,
    })
    expect(nodeCompletion({ ...weight, target_weight: 0 })).toEqual({
      processed: null,
      dispatched: null,
    })
    expect(
      nodeCompletion({
        ...weight,
        completion_basis: 'both',
        target_quantity: 100,
        dispatched_quantity: 80,
        processed_quantity: 90,
      }),
    ).toEqual({ processed: 90, dispatched: 40 })
  })
})

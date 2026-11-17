import { describe, expect, it } from 'vitest'
import {
  nodeCompletion,
  nodeWorkProgress,
  timelineNodes,
  progressRange,
  progressWeek,
} from './scheduleProgress'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule } from '@/types/productionSchedule'
const now = Date.parse('2026-10-23T10:00:00+08:00')
const node = (id: number, due_at: string) =>
  ({
    ...scheduleSummaryFixture(),
    id,
    due_at,
    sequence_no: id,
    predecessor_id: id > 1 ? id - 1 : null,
  }) as ProductionSchedule

describe('progress calendar', () => {
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
  it.each([
    { next_team_id: null, external_destination: '对外转料', label: '有效发货' },
    { next_team_id: 3, external_destination: null, label: '有效转出' },
    { next_team_id: null, external_destination: '库房成品', label: '有效转出' },
    { next_team_id: null, external_destination: '外委库', label: '有效转出' },
    { next_team_id: null, external_destination: null, label: '有效转出' },
  ])('labels actual outbound progress by its destination: %j', ({ label, ...destination }) => {
    expect(
      nodeWorkProgress({
        ...node(1, ''),
        ...destination,
        completion_basis: 'quantity',
        target_quantity: 100,
        processed_quantity: 100,
        dispatched_quantity: 60,
        received_quantity: 0,
      }),
    ).toEqual({ label, percent: 60 })
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
      dispatched: 40,
    })
    expect(nodeWorkProgress({ ...weight, assessment_enabled: false })).toEqual({
      label: '有效转出',
      percent: 40,
    })
    expect(
      nodeWorkProgress({
        ...node(1, ''),
        target_quantity: 100,
        processed_quantity: 60,
        dispatched_quantity: 40,
      }),
    ).toEqual({
      label: '有效转出',
      percent: 40,
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

describe('team batch progress', () => {
  it('preserves each batch target without assigning shared team stock or processing totals', () => {
    const schedule = {
      ...node(1, '2026-10-24T12:00:00+08:00'),
      batches: [
        {
          id: 31,
          batch_number: 1,
          planned_start_at: '2026-10-22T12:00:00+08:00',
          due_at: '2026-10-23T12:00:00+08:00',
          target_quantity: 40,
          target_weight: null,
          upstream_batch_ids: [],
          warnings: [],
          status: 'pending' as const,
          dispatched_quantity: 10,
          actual_dispatched_quantity: 10,
          quality_pending_quantity: 0,
          dispatched_weight: 1,
          received_quantity: 0,
          received_weight: 0,
          completed_at: null,
        },
        {
          id: 32,
          batch_number: 2,
          planned_start_at: '2026-10-23T08:00:00+08:00',
          due_at: '2026-10-24T12:00:00+08:00',
          target_quantity: 60,
          target_weight: null,
          upstream_batch_ids: [],
          warnings: [],
          status: 'pending' as const,
          dispatched_quantity: 0,
          actual_dispatched_quantity: 0,
          quality_pending_quantity: 0,
          dispatched_weight: 0,
          received_quantity: 0,
          received_weight: 0,
          completed_at: null,
        },
      ],
    }
    const result = timelineNodes([schedule])
    expect(result).toHaveLength(2)
    expect(result.map((batch) => batch.target_quantity)).toEqual([40, 60])
    expect(result[0]).toMatchObject({
      parent_schedule_id: 1,
      target_quantity: 40,
      dispatched_quantity: 10,
    })
    expect(result[0]!.processed_quantity).toBeUndefined()
    expect(result[0]!.stock).toBeUndefined()
  })
})

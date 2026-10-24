import { describe, expect, it } from 'vitest'
import { progressMarkers, progressWeek, taskRisk } from './scheduleProgress'
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
  })
  it('separates same-hour milestones and never clamps outside deadlines into the week', () => {
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
    expect(result.visible.map((item) => item.lane)).toEqual([0, 1])
    expect(result.outside.map((item) => item.id)).toEqual([3])
    expect(result.height).toBeGreaterThan(112)
    expect(result.links).toHaveLength(1)
  })
  it('does not predict punctual delivery from the absence of a late node', () => {
    const task = { status: 'pending', nodes: [] } as unknown as ScheduleTask
    expect(taskRisk(task).label).toBe('暂无逾期节点')
    expect(taskRisk({ ...task, status: 'not_assessed' }).label).toBe('仅展示备料与转出')
    expect(taskRisk({ ...task, nodes: [{ ...node(1, ''), quality_held: true }] }).label).toBe(
      '质量暂扣',
    )
  })
})

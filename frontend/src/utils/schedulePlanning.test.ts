import { expect, it } from 'vitest'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import { hasConfirmedPlan, plannedDueLabel, planLabel } from './schedulePlanning'
import { scheduleAxis, scheduleLanes } from './scheduleTimeline'
import { timelineNodes } from './scheduleProgress'

it('preserves legacy drafts without publishing them or asking for approval', () => {
  const node: ProductionSchedule = {
    ...scheduleSummaryFixture(),
    planning_state: 'submitted',
    batches: [],
    version: 1,
    sequence_no: 1,
    notes: null,
    cancelled_at: null,
    completed_at: null,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
  }
  const axis = scheduleAxis(Date.parse(node.due_at), 'week')
  expect(hasConfirmedPlan(node)).toBe(false)
  expect(plannedDueLabel(node)).toBe('待填写')
  expect(timelineNodes([node])).toEqual([])
  expect(scheduleLanes([node], axis).rows[0]?.dueX).toBeNull()
  const revision = { ...node, planning_state: 'revision_pending' as const }
  expect(hasConfirmedPlan(revision)).toBe(true)
  expect(planLabel(revision)).toBe('已填写')
  expect(timelineNodes([revision])).toHaveLength(1)
  expect(scheduleLanes([revision], axis).rows[0]?.dueX).not.toBeNull()
})

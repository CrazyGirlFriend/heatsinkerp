import { expect, it } from 'vitest'
import { scheduleTimestamp } from './scheduleTimeline'

it('reads UTC and explicit-offset timestamps independently of local timezone', () => {
  const now = Date.parse('2026-10-22T08:00:00Z')
  expect(scheduleTimestamp('2026-10-22T08:00:00')).toBe(now)
  expect(scheduleTimestamp('2026-10-22T16:00:00+08:00')).toBe(now)
  expect(scheduleTimestamp('not a date')).toBeNull()
  expect(scheduleTimestamp(null)).toBeNull()
  expect(scheduleTimestamp()).toBeNull()
})

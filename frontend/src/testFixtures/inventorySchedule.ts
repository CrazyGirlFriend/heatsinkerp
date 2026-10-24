import type { InventoryScheduleSummary, ScheduleSummary } from '@/types/productionSchedule'

export const inventoryScheduleFixture = (
  overrides: Partial<InventoryScheduleSummary> = {},
): InventoryScheduleSummary => ({
  applicable: true,
  count: 0,
  due_at: null,
  status: 'unplanned',
  overdue_count: 0,
  items: [],
  ...overrides,
})

export const scheduleSummaryFixture = (
  overrides: Partial<ScheduleSummary> = {},
): ScheduleSummary => ({
  id: 81,
  serial_no: '000128',
  team_id: 901,
  team_name: '库房',
  next_team_id: 3,
  next_team_name: '轧制',
  external_destination: null,
  due_at: '2026-10-23T08:00:00Z',
  target_quantity: 100,
  target_weight: 10,
  dispatched_quantity: 40,
  dispatched_weight: 4,
  remaining_quantity: 60,
  remaining_weight: 6,
  received_quantity: 20,
  received_weight: 2,
  status: 'pending',
  predecessor_id: null,
  sources: [{ source_transfer_id: 11, batch_no: 'TL11', quantity: 100, weight: 10 }],
  ...overrides,
})

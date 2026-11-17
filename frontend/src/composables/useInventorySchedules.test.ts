import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { inventoryScheduleFixture } from '@/testFixtures/inventorySchedule'
import type { InventorySchedules, InventoryScheduleSummary } from '@/types/productionSchedule'
import { useInventorySchedules } from './useInventorySchedules'

let scope: ReturnType<typeof effectScope>
function setup() {
  const rows = ref<{ id: number; delivery_schedule?: InventoryScheduleSummary }[]>([{ id: 11 }])
  const teamId = ref(901)
  scope = effectScope()
  const schedules = scope.run(() =>
    useInventorySchedules(
      rows,
      () => teamId.value,
      'groups',
      (row) => row,
    ),
  )!
  return { rows, teamId, ...schedules }
}
function response(id: number, count = 0): InventorySchedules {
  return { groups: [{ group_id: id, ...inventoryScheduleFixture({ count }) }], sources: [] }
}
function deferred() {
  let resolve!: (value: InventorySchedules) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<InventorySchedules>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
afterEach(() => {
  scope?.stop()
  vi.restoreAllMocks()
})

it('keeps the newest refresh when older replies arrive last', async () => {
  const old = deferred()
  vi.spyOn(productionScheduleApi, 'inventory')
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response(11, 2))
  const schedules = setup()
  const pending = schedules.load()
  await schedules.load()
  old.resolve(response(11, 1))
  await pending
  expect(schedules.rows.value[0]?.delivery_schedule?.count).toBe(2)
  expect(schedules.loading.value).toBe(false)
})

it('does not let a previous team request change the new rows or loading state', async () => {
  const old = deferred(),
    current = deferred()
  const api = vi.spyOn(productionScheduleApi, 'inventory')
  api.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  const schedules = setup()
  const first = schedules.load()
  schedules.reset()
  schedules.teamId.value = 902
  schedules.rows.value = [{ id: 22 }]
  const second = schedules.load()
  old.reject(new Error('old team failed'))
  await first
  expect(schedules.loading.value).toBe(true)
  expect(schedules.error.value).toBe('')
  expect(schedules.rows.value).toEqual([{ id: 22 }])
  current.resolve(response(22))
  await second
  expect(api).toHaveBeenLastCalledWith({ team_id: 902, group_ids: [22] })
  expect(schedules.rows.value[0]?.delivery_schedule?.status).toBe('unplanned')
})

it('preserves stock on errors and supports retry without inventing an empty schedule', async () => {
  vi.spyOn(productionScheduleApi, 'inventory')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response(11))
  const schedules = setup()
  await schedules.load()
  expect(schedules.rows.value).toEqual([{ id: 11 }])
  expect(schedules.error.value).toContain('交货排期加载失败')
  await schedules.load()
  expect(schedules.error.value).toBe('')
  expect(schedules.rows.value[0]?.delivery_schedule?.status).toBe('unplanned')
})

it('discards pending responses after the inventory view is disposed', async () => {
  const pending = deferred()
  vi.spyOn(productionScheduleApi, 'inventory').mockReturnValue(pending.promise)
  const schedules = setup()
  const request = schedules.load()
  scope.stop()
  pending.resolve(response(11))
  await request
  expect(schedules.rows.value).toEqual([{ id: 11 }])
  expect(schedules.loading.value).toBe(false)
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ReworkRoundsTable from './ReworkRoundsTable.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'
import type { ReworkRound } from '@/types/processRoute'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
const row = (id: number): ReworkRound => ({
  route_id: id,
  state: 'published',
  engineering_employee_name: '张工',
  request: {
    ...reworkRouteFixture.rework_request!,
    round: id,
    batch_no: `TL${id}`,
    reason: id === 1 ? '厚度偏差' : '表面划伤',
  },
  steps: [
    {
      ...reworkRouteFixture.steps[0]!,
      sequence_no: 1,
      team_name: '研磨',
      instructions: '精磨至规定尺寸',
    },
  ],
  progress: {
    quantity: 4,
    completed_quantity: 4,
    passed_quantity: 0,
    state: 'awaiting_inspection',
    inspections: [],
  },
})
it('keeps each round distinct and shows real reinspection counts without equating authoring with completion', async () => {
  const first = row(1)
  first.progress.state = 'failed'
  first.progress.inspections = [
    {
      id: 7,
      batch_no: 'TL3',
      scope: 'sample',
      sample_quantity: 2,
      failed_quantity: 1,
      inspector_name: '李工',
      checked_at: '2026-11-07T02:00:00Z',
    },
  ]
  const second = row(2)
  second.state = 'draft'
  second.steps = []
  second.progress.state = 'awaiting_route'
  second.progress.completed_quantity = 0
  vi.spyOn(processRouteApi, 'reworkRounds').mockResolvedValue([first, second])
  wrapper = mount(ReworkRoundsTable, { props: { routeId: 2, version: 1 } })
  await flushPromises()
  expect(wrapper.text()).toContain('第 1 轮')
  expect(wrapper.text()).toContain('第 2 轮')
  expect(wrapper.text()).toContain('复检不合格')
  expect(wrapper.text()).toContain('待制定')
  expect(wrapper.text()).toContain('0 / 4')
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '明细')!
    .trigger('click')
  expect(wrapper.get('[aria-label="本轮工艺要求"]').text()).toContain('精磨至规定尺寸')
  expect(wrapper.get('[aria-label="本轮复检记录"]').text()).toContain('抽检')
  expect(wrapper.get('[aria-label="本轮复检记录"]').text()).toContain('李工')
})
it('drops the previous result when switching batches and ignores stale responses', async () => {
  let finish!: (value: ReworkRound[]) => void
  vi.spyOn(processRouteApi, 'reworkRounds')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue([row(2)])
  wrapper = mount(ReworkRoundsTable, { props: { routeId: 1, version: 1 } })
  await wrapper.setProps({ routeId: 2 })
  await flushPromises()
  finish([row(1)])
  await flushPromises()
  expect(wrapper.text()).toContain('TL2')
  expect(wrapper.text()).not.toContain('TL1')
})

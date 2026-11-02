// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElOption, ElSelect } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import ScheduleRouteLink from './ScheduleRouteLink.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

it('maps and offers only the engineering execution path while retaining original step indexes', async () => {
  const task: ScheduleTask = {
    id: 31,
    task_no: 'PQ31',
    title: '交货',
    serial_no: 'ORDER-001',
    notes: null,
    version: 4,
    created_at: '',
    updated_at: '',
    final_due_at: '2026-11-12T00:00:00',
    status: 'pending',
    nodes: [
      {
        ...scheduleSummaryFixture(),
        team_id: 2,
        team_name: '研磨',
        next_team_id: 3,
        version: 2,
        cancelled_at: null,
      } as ProductionSchedule,
    ],
  }
  const step = routeFixture.steps[0]!
  vi.spyOn(productionScheduleApi, 'routeOptions').mockResolvedValue([
    {
      id: 8,
      title: '产品工艺',
      version: 1,
      published_at: '',
      execution_serial: 'PROCESS-001',
      serial_nos: ['PROCESS-001', 'PROCESS-OTHER'],
      steps: [
        { ...step, team_id: 1, name: '库房', serial_nos: ['PROCESS-001'] },
        { ...step, team_id: 2, name: '其他工艺分支', serial_nos: ['PROCESS-OTHER'] },
        { ...step, team_id: 2, name: '研磨', serial_nos: ['PROCESS-001'] },
        { ...step, team_id: 3, name: '检验', serial_nos: ['PROCESS-001'] },
      ],
    },
  ])
  const save = vi.spyOn(productionScheduleApi, 'linkRoute').mockResolvedValue(task)
  wrapper = mount(ScheduleRouteLink, {
    props: { task },
    global: {
      stubs: { AppDialog: { template: '<div><slot/><slot name="footer"/></div>' } },
    },
  })
  await flushPromises()
  const routePicker = wrapper
    .findAllComponents(ElSelect)
    .find((select) => select.props('ariaLabel') === '关联工艺')!
  expect(routePicker.findAllComponents(ElOption).map((option) => option.props('label'))).toEqual([
    'PROCESS-001 / PROCESS-OTHER',
  ])
  const stepPicker = wrapper
    .findAllComponents(ElSelect)
    .find((select) => select.props('ariaLabel') === '研磨对应工序')!
  expect(stepPicker.props('modelValue')).toBe(2)
  expect(stepPicker.findAllComponents(ElOption).map((option) => option.props('value'))).toEqual([
    0, 2, 3,
  ])
  expect(
    stepPicker
      .findAllComponents(ElOption)
      .some((option) => String(option.props('label') || '').includes('其他')),
  ).toBe(false)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '确认关联')!
    .trigger('click')
  await flushPromises()
  expect(save).toHaveBeenCalledWith(task.id, {
    expected_version: task.version,
    route_id: 8,
    route_version: 1,
    mappings: [{ schedule_id: task.nodes[0]!.id, expected_version: 2, step_index: 2 }],
  })
})

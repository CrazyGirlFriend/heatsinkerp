// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSelect } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScheduleRouteLink from './ScheduleRouteLink.vue'
import ScheduleReworkPanel from './ScheduleReworkPanel.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import { routeFixture } from '@/testFixtures/processRoute'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'

const node: ProductionSchedule = {
  ...scheduleSummaryFixture(),
  team_id: 2,
  team_name: '研磨',
  next_team_id: 1,
  sequence_no: 1,
  completion_basis: 'quantity',
  notes: null,
  version: 3,
  execution_state: 'waiting_material',
  quality_held: false,
  cancelled_at: null,
  created_at: '',
  updated_at: '',
  completed_at: null,
}
const task: ScheduleTask = {
  id: 9,
  task_no: 'PQ00000009',
  title: '首批',
  serial_no: node.serial_no,
  notes: null,
  version: 4,
  created_at: '',
  updated_at: '',
  final_due_at: node.due_at,
  status: 'overdue',
  nodes: [node],
  reworks: [
    {
      route_id: 51,
      route_version: 1,
      schedule_id: node.id,
      batch_no: 'TL4',
      problem: '厚度超差',
      quantity: 4,
      completed_quantity: 4,
      state: 'processed',
    },
  ],
}
let wrapper: VueWrapper
const global = {
  stubs: {
    AppDialog: {
      props: ['modelValue'],
      template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
    },
    ProcessRouteEditor: true,
  },
}
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function click(label: string) {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
  await flushPromises()
}
function select(label: string, value: number) {
  const item = wrapper.findAllComponents(ElSelect).find((s) => s.props('ariaLabel') === label)!
  item.vm.$emit('update:modelValue', value)
  item.vm.$emit('change', value)
}
async function routeEditor() {
  const step = routeFixture.steps[0]!
  vi.spyOn(productionScheduleApi, 'routeOptions').mockResolvedValue([
    {
      id: 33,
      title: '工艺',
      version: 2,
      published_at: '',
      steps: [
        { ...step, team_id: 2, name: '研磨', serial_nos: [] },
        { ...step, team_id: 3, name: '其他流水号工序', serial_nos: ['OTHER'] },
        { ...step, team_id: 1, name: '库房', serial_nos: [] },
      ],
    },
  ])
  wrapper = mount(ScheduleRouteLink, { props: { task }, global })
  await flushPromises()
}
describe('排期与工艺关联', () => {
  it('按本流水号工序映射，不改数量和交期', async () => {
    const save = vi.spyOn(productionScheduleApi, 'linkRoute').mockResolvedValue(task)
    await routeEditor()
    await click('确认关联')
    expect(save).toHaveBeenCalledWith(task.id, {
      expected_version: 4,
      route_id: 33,
      route_version: 2,
      mappings: [{ schedule_id: node.id, expected_version: 3, step_index: 0 }],
    })
    expect(wrapper.emitted('saved')?.[0]).toEqual([task])
  })
  it('关联冲突留在表单并显示原因', async () => {
    vi.spyOn(productionScheduleApi, 'linkRoute').mockRejectedValue(
      new Error('已有加工记录，须保留原工艺'),
    )
    await routeEditor()
    await click('确认关联')
    expect(wrapper.text()).toContain('已有加工记录，须保留原工艺')
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.findAll('button').some((b) => b.text() === '确认关联')).toBe(true)
  })
  it('返工完工单独显示，原排期仍可逾期', async () => {
    wrapper = mount(ScheduleReworkPanel, { props: { task, manage: false }, global })
    await flushPromises()
    expect(wrapper.text()).toContain('已完成返工')
    expect(wrapper.text()).not.toContain('已交完')
    expect(wrapper.text()).not.toContain('关联返工问题')
    expect(task.status).toBe('overdue')
  })
  it('管理员明确选择实际返工批次及原节点', async () => {
    vi.spyOn(productionScheduleApi, 'reworkOptions').mockResolvedValue([
      {
        route_id: 52,
        route_version: 2,
        batch_no: 'TL5',
        problem: '表面划伤',
        plans: [{ id: node.id, team_name: '研磨', due_at: node.due_at }],
      },
    ])
    const save = vi.spyOn(productionScheduleApi, 'linkRework').mockResolvedValue(task)
    wrapper = mount(ScheduleReworkPanel, { props: { task, manage: true }, global })
    await click('关联返工问题')
    select('返工批次', 52)
    await flushPromises()
    await click('确认关联')
    expect(save).toHaveBeenCalledWith(task.id, {
      expected_version: 4,
      route_id: 52,
      route_version: 2,
      schedule_id: node.id,
    })
    expect(wrapper.emitted('saved')?.[0]).toEqual([task])
    await click('关联返工问题')
    expect(wrapper.findAllComponents(ElSelect).map((s) => s.props('modelValue'))).toEqual([
      undefined,
      undefined,
    ])
  })
})

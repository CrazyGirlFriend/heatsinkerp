// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElDatePicker, ElInputNumber } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import AppDialog from './AppDialog.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ScheduleTask, ScheduleRouteOption } from '@/types/productionSchedule'
import { routeFixture } from '@/testFixtures/processRoute'
const role = vi.hoisted(() => ({ isDispatch: true }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => role }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => ({ items: [] }) }))
vi.mock('@/services/materialInputApi', () => ({ materialSuggestions: async () => [] }))
let wrapper: VueWrapper
const task = {
  id: 7,
  serial_no: 'S-001',
  title: 'S-001',
  version: 3,
  nodes: [],
  final_due_at: '2026-12-30T08:00:00Z',
  business_people: [
    { id: 1, name: '张工' },
    { id: 2, name: '李工' },
  ],
  delivery_batches: [{ batch_number: 1, target_quantity: 100, due_at: '2026-12-30T08:00:00Z' }],
} as unknown as ScheduleTask
beforeEach(() => {
  role.isDispatch = true
  const route = structuredClone(routeFixture)
  route.steps.forEach((s) => {
    s.serial_nos = ['S-001']
    s.planned_quantity = '100'
  })
  vi.spyOn(productionScheduleApi, 'taskRouteOptions').mockResolvedValue([
    route as unknown as ScheduleRouteOption,
  ])
  vi.spyOn(productionScheduleApi, 'createTask').mockResolvedValue(task)
  vi.spyOn(productionScheduleApi, 'updateTask').mockResolvedValue(task)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(existing?: ScheduleTask) {
  wrapper = mount(ScheduleTaskEditor, {
    props: { task: existing, routeSerial: 'S-001' },
    global: {
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        ScheduleSelectionDialog: true,
      },
      directives: { loading: () => {} },
    },
  })
  await flushPromises()
}
async function button(label: string) {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
  await flushPromises()
}
function date(value: string) {
  wrapper.findAllComponents(ElDatePicker)[0]!.vm.$emit('update:modelValue', value)
}
it('loads the serial process but requires dispatch to set the customer deadline', async () => {
  await render()
  expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('S-001')
  expect(wrapper.text()).toContain('执行工艺')
  await button('创建排期')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  date('2026-12-30T16:00:00')
  await flushPromises()
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [
    { value: 1, label: '张工' },
    { value: 2, label: '李工' },
  ])
  await flushPromises()
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledWith(
    expect.objectContaining({
      serial_no: 'S-001',
      route_id: routeFixture.id,
      route_version: routeFixture.version,
      business_person_ids: [1, 2],
      final_due_at: '2026-12-30T16:00:00+08:00',
      delivery_batches: [
        { batch_number: 1, target_quantity: 100, due_at: '2026-12-30T16:00:00+08:00' },
      ],
    }),
  )
  expect(vi.mocked(productionScheduleApi.createTask).mock.calls[0]![0]).not.toHaveProperty('nodes')
})
it('rejects customer batches that do not add up to the route quantity', async () => {
  await render()
  date('2026-12-30T16:00:00')
  await flushPromises()
  await button('＋ 增加一批')
  const amounts = wrapper.findAllComponents(ElInputNumber)
  amounts[0]!.vm.$emit('update:modelValue', 40)
  amounts[1]!.vm.$emit('update:modelValue', 50)
  await button('创建排期')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('合计须为 100 件')
  amounts[1]!.vm.$emit('update:modelValue', 60)
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledOnce()
})
it('preserves multiple contacts and uses the order version when editing', async () => {
  await render(task)
  await button('保存交期')
  expect(productionScheduleApi.updateTask).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ expected_version: 3, business_person_ids: [1, 2] }),
  )
})
it.each(['locked', 'admin'])('blocks writes for %s', async (mode) => {
  if (mode === 'admin') role.isDispatch = false
  await render(mode === 'locked' ? { ...task, locked_at: '2026-10-30T00:00:00Z' } : task)
  await button('保存交期')
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
})
it('keeps the editor until its closing transition finishes', async () => {
  await render()
  const dialog = wrapper.getComponent(AppDialog)
  await button('取消')
  expect(dialog.props('modelValue')).toBe(false)
  expect(wrapper.emitted('close')).toBeUndefined()
  dialog.vm.$emit('closed')
  expect(wrapper.emitted('close')).toEqual([[]])
})

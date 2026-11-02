// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElDatePicker, ElFormItem, ElInputNumber, ElOption, ElSelect } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import AppDialog from './AppDialog.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ScheduleTask, ScheduleRouteOption } from '@/types/productionSchedule'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import { processRouteApi } from '@/services/processRouteApi'
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
    { ...route, execution_serial: 'S-001' } as unknown as ScheduleRouteOption,
  ])
  vi.spyOn(productionScheduleApi, 'parseOrder').mockResolvedValue({
    ...orderFixture,
    serial_no: 'S-001',
  })
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(route)
  vi.spyOn(productionScheduleApi, 'createTask').mockResolvedValue(task)
  vi.spyOn(productionScheduleApi, 'task').mockResolvedValue(task)
  vi.spyOn(productionScheduleApi, 'updateTask').mockResolvedValue(task)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(existing?: ScheduleTask, routeSerial = 'S-001') {
  wrapper = mount(ScheduleTaskEditor, {
    props: { task: existing, routeSerial },
    global: {
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        ScheduleSelectionDialog: true,
        WordDocumentPreview: true,
        ProcessRouteDrawingPreview: true,
      },
      directives: { loading: () => {} },
    },
  })
  await flushPromises()
}
const orderFile = new File(['order'], '订单.xlsx')
async function uploadOrder() {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [orderFile] })
  await input.trigger('change')
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
function batchDate(index: number, value: string) {
  wrapper.findAllComponents(ElDatePicker)[index + 1]!.vm.$emit('update:modelValue', value)
}
it('loads the serial process but requires dispatch to set the customer deadline', async () => {
  await render()
  expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('S-001')
  const routeField = wrapper
    .findAllComponents(ElFormItem)
    .find((field) => field.props('label') === '关联工艺')!
  expect(routeField.props('required')).toBe(true)
  expect(routeField.getComponent(ElSelect).props('modelValue')).toBe(routeFixture.id)
  expect(wrapper.text()).toContain('执行工艺')
  await button('创建排期')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  date('2026-12-30T16:00:00')
  await flushPromises()
  expect(wrapper.findAllComponents(ElDatePicker)[1]!.props('modelValue')).toBe('')
  expect(wrapper.findAllComponents(ElDatePicker)[1]!.props('disabled')).not.toBe(true)
  batchDate(0, '2026-12-29T16:00:00')
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [
    { value: 1, label: '张工' },
    { value: 2, label: '李工' },
  ])
  await flushPromises()
  await button('创建排期')
  expect(wrapper.text()).toContain('请上传对应流水号的订单表')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  await uploadOrder()
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledWith(
    expect.objectContaining({
      serial_no: 'S-001',
      route_id: routeFixture.id,
      route_version: routeFixture.version,
      business_person_ids: [1, 2],
      final_due_at: '2026-12-30T16:00:00+08:00',
      delivery_batches: [
        { batch_number: 1, target_quantity: 100, due_at: '2026-12-29T16:00:00+08:00' },
      ],
    }),
    orderFile,
  )
  expect(vi.mocked(productionScheduleApi.createTask).mock.calls[0]![0]).not.toHaveProperty('nodes')
})
it('blocks creation without a process and waits for a choice when several processes match', async () => {
  vi.mocked(productionScheduleApi.taskRouteOptions).mockResolvedValueOnce([])
  await render()
  const createButton = () => wrapper.findAll('button').find((item) => item.text() === '创建排期')!
  expect(createButton().attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('暂无可用工艺')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  const route = structuredClone(routeFixture)
  route.steps.forEach((step) => {
    step.serial_nos = ['S-001']
    step.planned_quantity = '100'
  })
  vi.mocked(productionScheduleApi.taskRouteOptions).mockResolvedValueOnce([
    { ...route, execution_serial: 'S-001' } as unknown as ScheduleRouteOption,
    { ...route, id: route.id + 1, execution_serial: 'S-001' } as unknown as ScheduleRouteOption,
  ])
  await wrapper.get('button[aria-label="刷新工艺"]').trigger('click')
  await flushPromises()
  expect(createButton().attributes('disabled')).toBeDefined()
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  selection.vm.$emit('update:modelValue', route.id)
  await flushPromises()
  expect(createButton().attributes('disabled')).toBeUndefined()
  await wrapper.get('input[aria-label="任务流水号"]').setValue('OTHER')
  expect(createButton().attributes('disabled')).toBeDefined()
  expect(selection.props('modelValue')).toBe(route.id)
  await vi.waitFor(() => expect(createButton().attributes('disabled')).toBeUndefined())
  expect(selection.props('modelValue')).toBe(route.id)
  expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('modelValue')).toBe(100)
})
it('rejects customer batches that do not add up to the route quantity', async () => {
  await render()
  date('2026-12-30T16:00:00')
  await flushPromises()
  await button('＋ 增加一批')
  batchDate(0, '2026-12-28T16:00:00')
  batchDate(1, '2026-12-29T16:00:00')
  const amounts = wrapper.findAllComponents(ElInputNumber)
  amounts[0]!.vm.$emit('update:modelValue', 40)
  amounts[1]!.vm.$emit('update:modelValue', 50)
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('待分配 10 件')
  await button('创建排期')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  amounts[1]!.vm.$emit('update:modelValue', 70)
  await flushPromises()
  expect(wrapper.get('.dispatch-allocation-balance.is-exceeded').text()).toContain('超出 10 件')
  amounts[1]!.vm.$emit('update:modelValue', 60)
  await flushPromises()
  expect(wrapper.get('.dispatch-allocation-balance.is-complete').text()).toContain('剩余 0 件')
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  await uploadOrder()
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
it('preserves batch dates when changing the deadline or adding and removing another batch', async () => {
  await render(task)
  batchDate(0, '2026-12-28T16:00:00')
  date('2026-12-31T16:00:00')
  await button('＋ 增加一批')
  expect(wrapper.findAllComponents(ElDatePicker)[1]!.props('modelValue')).toBe(
    '2026-12-28T16:00:00',
  )
  expect(wrapper.findAllComponents(ElDatePicker)[2]!.props('modelValue')).toBe('')
  await wrapper
    .findAll('button')
    .filter((b) => b.text() === '删除')[1]!
    .trigger('click')
  await button('保存交期')
  expect(productionScheduleApi.updateTask).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      final_due_at: '2026-12-31T16:00:00+08:00',
      delivery_batches: [
        { batch_number: 1, target_quantity: 100, due_at: '2026-12-28T16:00:00+08:00' },
      ],
    }),
  )
})
it('rejects later hours on the final day and disables dates after the deadline', async () => {
  await render(task)
  const picker = wrapper.findAllComponents(ElDatePicker)[1]!
  const disabled = picker.props('disabledDate') as (date: Date) => boolean
  expect(disabled(new Date('2026-12-30T00:00:00'))).toBe(false)
  expect(disabled(new Date('2026-12-31T00:00:00'))).toBe(true)
  const hours = picker.props('disabledHours') as (role: string, date?: dayjs.Dayjs) => number[]
  expect(hours('', dayjs('2026-12-30T00:00:00'))).toEqual([17, 18, 19, 20, 21, 22, 23])
  expect(hours('', dayjs('2026-12-29T00:00:00'))).toEqual([])
  expect(wrapper.text()).toContain('按批次先后 · 不晚于最终交期')
  batchDate(0, '2026-12-30T17:00:00')
  await flushPromises()
  expect(
    wrapper
      .findAllComponents(ElFormItem)
      .some((field) => field.props('error') === '第 1 批交期不能晚于最终交期'),
  ).toBe(true)
  await button('保存交期')
  await vi.waitFor(() => expect(wrapper.text()).toContain('第 1 批交期不能晚于最终交期'))
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
})
it('requires dates in batch order', async () => {
  await render(task)
  await button('＋ 增加一批')
  const amounts = wrapper.findAllComponents(ElInputNumber)
  amounts[0]!.vm.$emit('update:modelValue', 40)
  amounts[1]!.vm.$emit('update:modelValue', 60)
  batchDate(0, '2026-12-29T16:00:00')
  batchDate(1, '2026-12-28T16:00:00')
  await flushPromises()
  const picker = wrapper.findAllComponents(ElDatePicker)[2]!
  const disabled = picker.props('disabledDate') as (date: Date) => boolean
  const hours = picker.props('disabledHours') as (role: string, date?: dayjs.Dayjs) => number[]
  expect(disabled(new Date('2026-12-28T00:00:00'))).toBe(true)
  expect(disabled(new Date('2026-12-29T00:00:00'))).toBe(false)
  expect(hours('', dayjs('2026-12-29T00:00:00'))).toEqual(Array.from({ length: 16 }, (_, i) => i))
  expect(
    wrapper
      .findAllComponents(ElFormItem)
      .some((field) => field.props('error') === '第 2 批交期不能早于上一批'),
  ).toBe(true)
  await button('保存交期')
  await vi.waitFor(() => expect(wrapper.text()).toContain('第 2 批交期不能早于上一批'))
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
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

it('rejects a mismatched order and clears the imported file when changing serial', async () => {
  await render()
  vi.mocked(productionScheduleApi.parseOrder).mockResolvedValueOnce({
    ...orderFixture,
    serial_no: 'OTHER',
  })
  await uploadOrder()
  expect(wrapper.text()).toContain('订单表流水号为 OTHER，与填写的 S-001 不一致，请核对。')
  expect(productionScheduleApi.task).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('替换订单表')
  await uploadOrder()
  expect(wrapper.text()).toContain('替换订单表')
  await wrapper.get('input[aria-label="任务流水号"]').setValue('OTHER')
  expect(wrapper.text()).not.toContain('替换订单表')
})

it('allows selecting a process before an order serial and retains its own execution path', async () => {
  await render(undefined, '')
  expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('')
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  expect(selection.props('filterable')).toBe(true)
  expect(selection.props('modelValue')).toBe(routeFixture.id)
  expect(wrapper.find('[aria-label="工艺执行班组"]').exists()).toBe(true)
  expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('modelValue')).toBe(100)
  await wrapper.get('input[aria-label="任务流水号"]').setValue('ORDER-OTHER')
  await vi.waitFor(() =>
    expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('ORDER-OTHER'),
  )
  await flushPromises()
  expect(selection.props('modelValue')).toBe(routeFixture.id)
  expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('modelValue')).toBe(100)
  date('2026-12-30T16:00:00')
  batchDate(0, '2026-12-29T16:00:00')
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  vi.mocked(productionScheduleApi.parseOrder).mockResolvedValueOnce({
    ...orderFixture,
    serial_no: 'ORDER-OTHER',
  })
  await uploadOrder()
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledWith(
    expect.objectContaining({ serial_no: 'ORDER-OTHER', route_id: routeFixture.id }),
    orderFile,
  )
})

it('marks an invalid batch quantity at its field before submission', async () => {
  await render()
  wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', undefined)
  await flushPromises()
  expect(
    wrapper
      .findAllComponents(ElFormItem)
      .some((field) => field.props('error') === '请输入大于 0 的整数'),
  ).toBe(true)
  expect(wrapper.get('[role="status"]').text()).toContain('待分配 100 件')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
})

it('names route choices by engineering serial and previews files before entering an order serial', async () => {
  await render(undefined, '')
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  expect(selection.findAllComponents(ElOption).map((option) => option.props('label'))).toEqual([
    'S-001',
  ])
  expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(routeFixture.id)
})

it('matches an entered serial automatically and preserves a dispatchers manual correction', async () => {
  const route = vi.mocked(productionScheduleApi.taskRouteOptions).getMockImplementation()!
  const options = await route('')
  const second = { ...options[0]!, id: 19, serial_nos: ['S-002'], execution_serial: 'S-002' }
  vi.mocked(productionScheduleApi.taskRouteOptions).mockResolvedValue([options[0]!, second])
  await render(undefined, '')
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  expect(selection.props('modelValue')).toBeUndefined()
  await wrapper.get('input[aria-label="任务流水号"]').setValue('S-002')
  await vi.waitFor(() => expect(selection.props('modelValue')).toBe(second.id))
  selection.vm.$emit('update:modelValue', routeFixture.id)
  selection.vm.$emit('change', routeFixture.id)
  await flushPromises()
  await wrapper.get('input[aria-label="任务流水号"]').setValue('ORDER-OTHER')
  await vi.waitFor(() =>
    expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('ORDER-OTHER'),
  )
  await flushPromises()
  expect(selection.props('modelValue')).toBe(routeFixture.id)
})

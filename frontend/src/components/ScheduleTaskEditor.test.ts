// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElDatePicker, ElFormItem, ElInputNumber, ElOption, ElSelect } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import AppDialog from './AppDialog.vue'
import ImportedDataConfirmation from './ImportedDataConfirmation.vue'
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
async function render(
  existing?: ScheduleTask,
  routeSerial = 'S-001',
  processRoute?: typeof routeFixture,
) {
  wrapper = mount(ScheduleTaskEditor, {
    props: { task: existing, routeSerial, processRoute },
    global: {
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        ScheduleSelectionDialog: true,
        OrderDocumentPreview: true,
        WordDocumentPreview: true,
        ProcessRouteDrawingPreview: true,
      },
      directives: { loading: () => {} },
    },
  })
  await flushPromises()
}
const orderFile = new File(['order'], '订单.xlsx')
async function uploadOrder(confirm = true) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [orderFile] })
  await input.trigger('change')
  await flushPromises()
  if (confirm && wrapper.findComponent(ImportedDataConfirmation).exists()) {
    wrapper.getComponent(ImportedDataConfirmation).vm.$emit('update:modelValue', true)
    await flushPromises()
  }
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
function batchAmounts() {
  return wrapper
    .findAllComponents(ElInputNumber)
    .filter((input) => input.props('ariaLabel') !== '计划数量')
}
function plannedAmount() {
  return wrapper
    .findAllComponents(ElInputNumber)
    .find((input) => input.props('ariaLabel') === '计划数量')!
}
function trackFocus(element: Element) {
  const focus = vi.spyOn(element as HTMLElement, 'focus')
  const scroll = vi.fn()
  Object.defineProperty(element, 'scrollIntoView', { configurable: true, value: scroll })
  return { focus, scroll }
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
      planned_quantity: 100,
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
  expect(selection.props('modelValue')).toBeUndefined()
  await vi.waitFor(() =>
    expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('OTHER'),
  )
  await flushPromises()
  expect(createButton().attributes('disabled')).toBeDefined()
  expect(plannedAmount().props('modelValue')).toBeUndefined()
})
it('rejects customer batches that do not add up to the planned quantity', async () => {
  await render()
  date('2026-12-30T16:00:00')
  await flushPromises()
  await button('＋ 增加一批')
  batchDate(0, '2026-12-28T16:00:00')
  batchDate(1, '2026-12-29T16:00:00')
  const amounts = batchAmounts()
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
  const amounts = batchAmounts()
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

it.each([undefined, routeFixture])(
  'keeps a new schedule empty until its serial is entered, including a provided route %s',
  async (processRoute) => {
    await render(undefined, '', processRoute)
    expect(productionScheduleApi.taskRouteOptions).not.toHaveBeenCalled()
    expect(processRouteApi.detail).not.toHaveBeenCalled()
    expect(wrapper.findComponent(ProcessRouteAttachments).exists()).toBe(false)
    const selection = wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.props('ariaLabel') === '关联工艺')!
    expect(selection.props('modelValue')).toBeUndefined()
    expect(selection.props('disabled')).toBe(true)
    expect(plannedAmount().props('modelValue')).toBeUndefined()
    expect(batchAmounts()[0]!.props('modelValue')).toBeUndefined()
    expect(wrapper.find('[aria-label="工艺执行班组"]').exists()).toBe(false)
    await wrapper.get('input[aria-label="任务流水号"]').setValue('   ')
    await flushPromises()
    expect(productionScheduleApi.taskRouteOptions).not.toHaveBeenCalled()
  },
)

it('does not automatically select the only available route when its serial does not match', async () => {
  await render(undefined, 'ORDER-OTHER')
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  expect(selection.props('modelValue')).toBeUndefined()
  expect(processRouteApi.detail).not.toHaveBeenCalled()
  expect(wrapper.findComponent(ProcessRouteAttachments).exists()).toBe(false)
  // Reusing another engineering route still requires an explicit selection after entering a serial.
  selection.vm.$emit('update:modelValue', routeFixture.id)
  selection.vm.$emit('change', routeFixture.id)
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(routeFixture.id)
  expect(plannedAmount().props('modelValue')).toBe(100)
})

it('marks an invalid batch quantity at its field before submission', async () => {
  await render()
  batchAmounts()[0]!.vm.$emit('update:modelValue', undefined)
  await flushPromises()
  expect(
    wrapper
      .findAllComponents(ElFormItem)
      .some((field) => field.props('error') === '请输入大于 0 的整数'),
  ).toBe(true)
  expect(wrapper.get('[role="status"]').text()).toContain('待分配 100 件')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
})

it('loads matching engineering files only after entering a serial and clears them when erased', async () => {
  await render(undefined, '')
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  await wrapper.get('input[aria-label="任务流水号"]').setValue('S-001')
  await vi.waitFor(() => expect(selection.props('modelValue')).toBe(routeFixture.id))
  await flushPromises()
  expect(selection.findAllComponents(ElOption).map((option) => option.props('label'))).toEqual([
    'S-001',
  ])
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(routeFixture.id)
  await uploadOrder()
  await wrapper.get('input[aria-label="任务流水号"]').setValue('')
  expect(selection.props('modelValue')).toBeUndefined()
  expect(plannedAmount().props('modelValue')).toBeUndefined()
  expect(batchAmounts()[0]!.props('modelValue')).toBeUndefined()
  expect(wrapper.text()).not.toContain('替换订单表')
  expect(wrapper.find('[aria-label="工艺执行班组"]').exists()).toBe(false)
  await flushPromises()
  expect(wrapper.findComponent(ProcessRouteAttachments).exists()).toBe(false)
  expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledTimes(1)
})

it('clears manual associations on a new serial and discards late route responses', async () => {
  const options = await vi.mocked(productionScheduleApi.taskRouteOptions).getMockImplementation()!(
    '',
  )
  const second = {
    ...options[0]!,
    id: 19,
    serial_nos: ['S-002'],
    execution_serial: 'S-002',
    steps: options[0]!.steps.map((step) => ({
      ...step,
      serial_nos: ['S-002'],
      planned_quantity: '200',
    })),
  }
  let finish!: (value: ScheduleRouteOption[]) => void
  vi.mocked(productionScheduleApi.taskRouteOptions).mockImplementation((serial) =>
    serial === 'S-001'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve([second]),
  )
  vi.mocked(processRouteApi.detail).mockImplementation(async (id) => ({ ...routeFixture, id }))
  await render()
  const selection = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === '关联工艺')!
  await wrapper.get('input[aria-label="任务流水号"]').setValue('S-002')
  await vi.waitFor(() => expect(selection.props('modelValue')).toBe(19))
  finish(options)
  await flushPromises()
  expect(selection.props('modelValue')).toBe(19)
  expect(plannedAmount().props('modelValue')).toBe(200)
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(19)
  selection.vm.$emit('change', 19)
  await wrapper.get('input[aria-label="任务流水号"]').setValue('ORDER-OTHER')
  expect(selection.props('modelValue')).toBeUndefined()
  expect(plannedAmount().props('modelValue')).toBeUndefined()
  await vi.waitFor(() =>
    expect(productionScheduleApi.taskRouteOptions).toHaveBeenCalledWith('ORDER-OTHER'),
  )
  await flushPromises()
  expect(selection.props('modelValue')).toBeUndefined()
  expect(wrapper.findComponent(ProcessRouteAttachments).exists()).toBe(false)
})

it('ignores an attachment response arriving after the serial was cleared', async () => {
  let finish!: (value: typeof routeFixture) => void
  vi.mocked(processRouteApi.detail).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
  await wrapper.get('input[aria-label="任务流水号"]').setValue('')
  await flushPromises()
  finish(routeFixture)
  await flushPromises()
  expect(wrapper.findComponent(ProcessRouteAttachments).exists()).toBe(false)
  expect(plannedAmount().props('modelValue')).toBeUndefined()
})

it('lets dispatch correct the quantity without overwriting batch amounts, dates or the process', async () => {
  await render()
  date('2026-12-30T16:00:00')
  batchDate(0, '2026-12-29T16:00:00')
  batchAmounts()[0]!.vm.$emit('update:modelValue', 40)
  plannedAmount().vm.$emit('update:modelValue', 80)
  await flushPromises()
  expect(batchAmounts()[0]!.props('modelValue')).toBe(40)
  expect(wrapper.findAllComponents(ElDatePicker)[1]!.props('modelValue')).toBe(
    '2026-12-29T16:00:00',
  )
  expect(wrapper.get('[role="status"]').text()).toContain('待分配 40 件')
  await wrapper.get('button[aria-label="刷新工艺"]').trigger('click')
  await flushPromises()
  expect(plannedAmount().props('modelValue')).toBe(80)
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  await uploadOrder()
  await button('创建排期')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  batchAmounts()[0]!.vm.$emit('update:modelValue', 80)
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledWith(
    expect.objectContaining({
      planned_quantity: 80,
      delivery_batches: [
        { batch_number: 1, target_quantity: 80, due_at: '2026-12-29T16:00:00+08:00' },
      ],
    }),
    orderFile,
  )
  expect(wrapper.get('[aria-label="工艺执行班组"]').text()).toContain('100')
})

it('saves a corrected existing total and restores it when reopened', async () => {
  await render(task)
  plannedAmount().vm.$emit('update:modelValue', 120)
  batchAmounts()[0]!.vm.$emit('update:modelValue', 120)
  const updated = {
    ...task,
    delivery_batches: [{ ...task.delivery_batches![0]!, target_quantity: 120 }],
  }
  vi.mocked(productionScheduleApi.updateTask).mockResolvedValue(updated)
  await button('保存交期')
  expect(productionScheduleApi.updateTask).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      planned_quantity: 120,
      expected_version: 3,
      delivery_batches: [
        { batch_number: 1, target_quantity: 120, due_at: '2026-12-30T16:00:00+08:00' },
      ],
    }),
  )
  expect(wrapper.emitted('saved')).toEqual([[updated]])
  wrapper.unmount()
  await render(updated)
  expect(plannedAmount().props('modelValue')).toBe(120)
  expect(wrapper.get('[role="status"]').text()).toContain('剩余 0 件')
})

it.each([undefined, 0, -1, 1.5, 2147483648])(
  'rejects invalid planned quantity %s',
  async (amount) => {
    await render(task)
    plannedAmount().vm.$emit('update:modelValue', amount)
    await button('保存交期')
    expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
  },
)

it('does not clamp existing batches when dispatch reduces the planned total', async () => {
  await render(task)
  plannedAmount().vm.$emit('update:modelValue', 80)
  await flushPromises()
  expect(batchAmounts()[0]!.props('modelValue')).toBe(100)
  expect(wrapper.get('[role="status"]').text()).toContain('超出 20 件')
  await button('保存交期')
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
})

it('shows the missing business contact at its field and scrolls and focuses the selection button', async () => {
  await render({ ...task, business_people: [], business_person_id: null })
  const field = wrapper
    .findAllComponents(ElFormItem)
    .find((item) => item.props('label') === '业务人员')!
  const feedback = trackFocus(field.get('button').element)
  await button('保存交期')
  expect(field.props('required')).toBe(true)
  expect(field.props('error')).toBe('请至少选择一位业务人员')
  await vi.waitFor(() => expect(field.text()).toContain('请至少选择一位业务人员'))
  expect(feedback.scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  expect(feedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  expect(field.props('error')).toBe('')
  await button('保存交期')
  expect(productionScheduleApi.updateTask).toHaveBeenCalledOnce()
})

it('focuses the first missing date and moves to the batch date after the deadline is corrected', async () => {
  await render(task)
  date('')
  batchDate(0, '')
  const due = wrapper.findAllComponents(ElDatePicker)
  const deadlineFeedback = trackFocus(due[0]!.get('input').element)
  const batchFeedback = trackFocus(due[1]!.get('input').element)
  await button('保存交期')
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('请选择最终交期')
    expect(wrapper.text()).toContain('请选择第 1 批交期')
  })
  expect(deadlineFeedback.scroll).toHaveBeenCalledOnce()
  expect(deadlineFeedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(batchFeedback.focus).not.toHaveBeenCalled()
  date('2026-12-30T16:00:00')
  await button('保存交期')
  expect(wrapper.text()).not.toContain('请选择最终交期')
  expect(batchFeedback.scroll).toHaveBeenCalledOnce()
  expect(batchFeedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
})

it('explains an allocation mismatch beside the batch quantity and focuses that input', async () => {
  await render(task)
  batchAmounts()[0]!.vm.$emit('update:modelValue', 80)
  const feedback = trackFocus(batchAmounts()[0]!.get('input').element)
  await button('保存交期')
  const field = batchAmounts()[0]!.element.closest('.el-form-item')!
  await vi.waitFor(() => expect(field.textContent).toContain('各批数量合计须为 100 件'))
  expect(feedback.scroll).toHaveBeenCalledOnce()
  expect(feedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
  batchAmounts()[0]!.vm.$emit('update:modelValue', 100)
  await button('保存交期')
  expect(field.textContent).not.toContain('各批数量合计须为')
  expect(productionScheduleApi.updateTask).toHaveBeenCalledOnce()
})

it('focuses invalid planned and batch quantities in field order', async () => {
  await render(task)
  plannedAmount().vm.$emit('update:modelValue', undefined)
  batchAmounts()[0]!.vm.$emit('update:modelValue', undefined)
  const plannedFeedback = trackFocus(plannedAmount().get('input').element)
  const batchFeedback = trackFocus(batchAmounts()[0]!.get('input').element)
  await button('保存交期')
  await vi.waitFor(() => expect(wrapper.text()).toContain('请输入 1 至 2147483647 的整数'))
  expect(plannedFeedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(batchFeedback.focus).not.toHaveBeenCalled()
  plannedAmount().vm.$emit('update:modelValue', 100)
  await button('保存交期')
  // Element Plus debounces error message visibility independently of focus.
  await vi.waitFor(() => expect(wrapper.text()).toContain('请输入大于 0 的整数'))
  expect(batchFeedback.scroll).toHaveBeenCalledOnce()
  expect(batchFeedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(productionScheduleApi.updateTask).not.toHaveBeenCalled()
})

it('shows missing serial and process errors and focuses the serial input', async () => {
  await render(undefined, '')
  const feedback = trackFocus(wrapper.get('input[aria-label="任务流水号"]').element)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('请选择流水号')
    expect(wrapper.text()).toContain('请选择关联工艺')
  })
  expect(feedback.scroll).toHaveBeenCalledOnce()
  expect(feedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
})

it('locates a missing order at the upload button and clears the error after uploading', async () => {
  await render()
  date('2026-12-30T16:00:00')
  batchDate(0, '2026-12-29T16:00:00')
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  const upload = wrapper.findAll('button').find((item) => item.text() === '上传订单表')!
  const feedback = trackFocus(upload.element)
  await button('创建排期')
  const field = upload.element.closest('.el-form-item')!
  await vi.waitFor(() => expect(field.textContent).toContain('请上传对应流水号的订单表'))
  expect(feedback.scroll).toHaveBeenCalledOnce()
  expect(feedback.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  await uploadOrder()
  expect(field.textContent).not.toContain('请上传对应流水号的订单表')
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledOnce()
})

it('requires reviewing imported quantity and invalidates confirmation when quantity or order changes', async () => {
  await render()
  date('2026-12-30T16:00:00')
  batchDate(0, '2026-12-29T16:00:00')
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  await uploadOrder(false)
  const confirmation = () => wrapper.getComponent(ImportedDataConfirmation)
  expect(wrapper.text()).toContain('文件带入')
  await button('创建排期')
  expect(confirmation().text()).toContain('请核对工艺和计划数量')
  expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  await confirmation().get('input[type="checkbox"]').setValue(true)
  plannedAmount().vm.$emit('update:modelValue', 80)
  batchAmounts()[0]!.vm.$emit('update:modelValue', 80)
  await flushPromises()
  expect(confirmation().props('modelValue')).toBe(false)
  expect(wrapper.text()).toContain('已修改')
  await confirmation().get('input[type="checkbox"]').setValue(true)
  await uploadOrder(false)
  expect(confirmation().props('modelValue')).toBe(false)
  await confirmation().get('input[type="checkbox"]').setValue(true)
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledWith(
    expect.objectContaining({ planned_quantity: 80 }),
    orderFile,
  )
})

it('keeps manually entered quantity and existing schedule edits free of import confirmation', async () => {
  const route = structuredClone(routeFixture)
  route.steps.forEach((step) => {
    step.planned_quantity = ''
  })
  vi.mocked(productionScheduleApi.taskRouteOptions).mockResolvedValue([
    { ...route, execution_serial: 'S-001' } as unknown as ScheduleRouteOption,
  ])
  await render()
  expect(wrapper.findComponent(ImportedDataConfirmation).exists()).toBe(false)
  plannedAmount().vm.$emit('update:modelValue', 90)
  batchAmounts()[0]!.vm.$emit('update:modelValue', 90)
  date('2026-12-30T16:00:00')
  batchDate(0, '2026-12-29T16:00:00')
  await button('选择业务人员')
  wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 1, label: '张工' }])
  await flushPromises()
  await uploadOrder(false)
  await button('创建排期')
  expect(productionScheduleApi.createTask).toHaveBeenCalledWith(
    expect.objectContaining({ planned_quantity: 90 }),
    orderFile,
  )
  wrapper.unmount()
  await render(task)
  expect(wrapper.findComponent(ImportedDataConfirmation).exists()).toBe(false)
  await button('保存交期')
  expect(productionScheduleApi.updateTask).toHaveBeenCalledOnce()
})

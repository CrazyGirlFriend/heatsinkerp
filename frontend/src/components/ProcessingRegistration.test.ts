// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElDatePicker, ElInputNumber, ElSwitch, ElSelect } from 'element-plus'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import ProcessingTaskFields from './ProcessingTaskFields.vue'
import WeightInput from './WeightInput.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { factoryToday } from '@/utils/format'

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isTeamAccount: true,
    currentUser: { id: 2, team_id: 2, active: true },
    currentUserError: '',
  }),
}))
const employee = { id: 71, name: '张师傅', team_id: 2, active: true, version: 1 }
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(processRouteApi, 'detail').mockImplementation(async (id) => ({ ...routeFixture, id }))
  vi.spyOn(teamMaterialApi, 'processingTasks').mockResolvedValue([
    { id: 9, team_id: 2, name: '精磨', active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([
    { id: 3, team_id: 2, name: '研磨业务1', active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([employee])
  vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
    source_transfer_id: 10,
    batch_no: 'TL001',
    quantity: 10,
    weight: 100,
    revision: 2,
    as_of: '',
    processing_mode: 'unit',
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'changeQuantity').mockResolvedValue({
    id: 1,
    source_transfer_id: 10,
    before_quantity: 10,
    after_quantity: 10,
    delta_quantity: 0,
    weight: 100,
    reason: '',
    created_by: '班组长',
    created_at: '',
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(QuantityAdjustmentDialog, {
    props: { modelValue: true, teamId: 2, sourceId: 10, processing: true, canWrite: true },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
}
async function save() {
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '保存加工登记')!
    .trigger('click')
  await flushPromises()
}
it('requires an actual employee and submits partial work without changing original piece count', async () => {
  await render()
  expect(wrapper.findComponent(ElSwitch).exists()).toBe(false)
  expect(wrapper.text()).toContain('本次完成件数')
  wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 6)
  wrapper.getComponent(WeightInput).vm.$emit('update:modelValue', 60)
  await save()
  expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  expect(wrapper.get('button[aria-label="加工人"]').attributes('aria-invalid')).toBe('true')
  wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', employee)
  wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', '2026-10-15')
  await save()
  expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      processor_employee_id: 71,
      processor_name: '张师傅',
      processing_mode: 'unit',
      processing_date: '2026-10-15',
      completed_quantity: 6,
      completed_weight: 60,
      expected_revision: 2,
    }),
  )
  expect(vi.mocked(teamMaterialApi.changeQuantity).mock.calls[0]![1].outputs).toBeUndefined()
})
it('rejects completion above available pieces and dates after today', async () => {
  await render()
  wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', employee)
  wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 11)
  await save()
  expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  expect(wrapper.getComponent(ElInputNumber).element.closest('.is-error')).not.toBeNull()
  wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 10)
  wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', '2999-01-01')
  await save()
  expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', factoryToday())
  await save()
  expect(teamMaterialApi.changeQuantity).toHaveBeenCalledOnce()
})
it('shows weight deviation reminders and does not offer completed stock for registration', async () => {
  await render()
  wrapper.getComponent(WeightInput).vm.$emit('update:modelValue', 101)
  await flushPromises()
  expect(wrapper.get('.processing-weight-notice').text()).toContain('1 kg')
  await wrapper.setProps({ modelValue: false })
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...(await teamMaterialApi.quantityContext(2, 10)),
    processing_status: 'complete',
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  expect(wrapper.findComponent(TeamEmployeeInput).exists()).toBe(false)
  expect(wrapper.text()).toContain('本批已完成加工')
})
it('opens splitting outputs directly and includes worker identity and actual work date', async () => {
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...(await teamMaterialApi.quantityContext(2, 10)),
    quantity: 1,
    processing_mode: 'split',
    task_required: true,
    process_route: {
      id: 8,
      title: '首批派工',
      version: 2,
      step_index: 1,
      sequence_no: 2,
      step_name: '精磨',
      instructions: '厚度2.5(+0.01/-0.02)，清洗吹干',
      team_id: 2,
      processing_task_id: 9,
      purpose_id: 3,
      split_here: false,
      complete: false,
      available: true,
    },
  })
  await render()
  expect(wrapper.findComponent(ElSwitch).exists()).toBe(false)
  expect(wrapper.findAllComponents(ProcessingTaskFields)).toHaveLength(1)
  const summary = wrapper.get('.quantity-summary').element
  const requirements = wrapper.get('.processing-current-step').element
  const outputs = wrapper.get('[aria-label="加工后完整实物明细"]').element
  expect(
    summary.compareDocumentPosition(requirements) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(requirements.textContent).toContain('厚度2.5(+0.01/-0.02)，清洗吹干')
  for (const field of [
    requirements,
    wrapper.getComponent(ElDatePicker).element,
    wrapper.getComponent(TeamEmployeeInput).element,
  ])
    expect(field.compareDocumentPosition(outputs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', employee)
  wrapper
    .findAllComponents(ElInputNumber)
    .find((i) => i.props('ariaLabel') === '明细2件数')!
    .vm.$emit('update:modelValue', 100)
  wrapper
    .findAllComponents(WeightInput)
    .find((i) => i.props('ariaLabel') === '明细2重量')!
    .vm.$emit('update:modelValue', 100)
  await save()
  expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      quantity: 100,
      input_quantity: 1,
      processing_mode: 'split',
      processing_date: factoryToday(),
      processor_employee_id: 71,
      outputs: [expect.objectContaining({ role: 'produced', quantity: 100, weight: 100 })],
    }),
  )
})

it('requires a task and its business, permits a different task on completed stock, and resets on another batch', async () => {
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...(await teamMaterialApi.quantityContext(2, 10)),
    processing_status: 'complete',
    task_required: true,
    purpose_id: 3,
    completed_task_ids: [8],
    allowed_task_ids: [9],
  })
  await render()
  wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', employee)
  await save()
  expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  const task = wrapper
    .findAllComponents(ElSelect)
    .find(
      (item) =>
        item.attributes('aria-label') === '加工任务' ||
        item.find('[aria-label="加工任务"]').exists(),
    )!
  expect(task.element.closest('.is-error')).not.toBeNull()
  task.vm.$emit('update:modelValue', 9)
  const business = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.find('[aria-label="加工对应业务"]').exists())!
  business.vm.$emit('update:modelValue', null)
  await save()
  expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  expect(business.element.closest('.is-error')).not.toBeNull()
  business.vm.$emit('update:modelValue', 3)
  await save()
  expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      processing_task_id: 9,
      purpose_id: 3,
      completed_quantity: 10,
      completed_weight: 100,
    }),
  )
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...(await teamMaterialApi.quantityContext(2, 10)),
    source_transfer_id: 11,
    purpose_id: null,
  })
  await wrapper.setProps({ sourceId: 11 })
  await flushPromises()
  const selects = wrapper.findAllComponents(ElSelect)
  expect(
    selects.find((item) => item.find('[aria-label="加工任务"]').exists())!.props('modelValue'),
  ).toBeNull()
  expect(
    selects.find((item) => item.find('[aria-label="加工对应业务"]').exists())!.props('modelValue'),
  ).toBeNull()
})

it('uses the engineered rework task while preserving the chosen original record', async () => {
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...(await teamMaterialApi.quantityContext(2, 10)),
    task_required: true,
    purpose_id: 3,
    rework_of_id: 52,
    rework_route_id: 9,
    rework_route_ready: true,
    process_route: {
      id: 9,
      route_kind: 'rework',
      title: '返工工艺',
      version: 1,
      step_index: 0,
      sequence_no: 1,
      step_name: '返工精磨',
      instructions: '精磨至2.50±0.01mm',
      team_id: 2,
      processing_task_id: 9,
      purpose_id: 3,
      complete: false,
      split_here: false,
    },
    rework_task_records: [
      {
        processing_task_id: 9,
        processing_task_name: '精磨',
        purpose_id: 3,
        purpose_name: '研磨业务1',
        rework_of_id: 51,
      },
      {
        processing_task_id: 8,
        processing_task_name: '粗磨',
        purpose_id: 3,
        purpose_name: '研磨业务1',
        rework_of_id: 52,
      },
    ],
  })
  wrapper = mount(QuantityAdjustmentDialog, {
    props: {
      modelValue: true,
      teamId: 2,
      sourceId: 10,
      processing: true,
      canWrite: true,
      rework: true,
      reworkRecordId: 51,
    },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
  wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', employee)
  const task = wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.find('[aria-label="加工任务"]').exists())!
  expect(task.props('disabled')).toBe(true)
  expect(task.props('modelValue')).toBe(9)
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存返工登记')!
    .trigger('click')
  await flushPromises()
  expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      work_kind: 'rework',
      rework_of_id: 51,
      processing_task_id: 9,
      purpose_id: 3,
    }),
  )
})

it('blocks legacy rework without engineering instead of bypassing the problem submission', async () => {
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...(await teamMaterialApi.quantityContext(2, 10)),
    task_required: true,
    rework_of_id: 51,
    rework_task_records: [
      {
        processing_task_id: null,
        processing_task_name: null,
        purpose_id: null,
        purpose_name: null,
        rework_of_id: 51,
      },
    ],
  })
  vi.mocked(teamMaterialApi.processingTasks).mockRejectedValue(new Error('目录已停用'))
  wrapper = mount(QuantityAdjustmentDialog, {
    props: {
      modelValue: true,
      teamId: 2,
      sourceId: 10,
      processing: true,
      canWrite: true,
      rework: true,
      reworkRecordId: 51,
    },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('请先在本班组工作台提交返工问题')
  expect(wrapper.findComponent(TeamEmployeeInput).exists()).toBe(false)
  expect(wrapper.findComponent(ProcessingTaskFields).exists()).toBe(false)
  expect(teamMaterialApi.processingTasks).not.toHaveBeenCalled()
  expect(wrapper.findAll('button').some((button) => button.text() === '保存返工登记')).toBe(false)
  expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
})

it('uses the published route task without asking again, including a planned repeated task', async () => {
  const context = await teamMaterialApi.quantityContext(2, 10)
  vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
    ...context,
    processing_status: 'complete',
    task_required: true,
    completed_task_ids: [9],
    allowed_task_ids: [],
    process_route: {
      id: 8,
      title: '首批派工',
      version: 2,
      step_index: 3,
      sequence_no: 4,
      step_name: '二次研磨',
      instructions: '厚度2.5(+0.01/-0.02)，清洗吹干',
      team_id: 2,
      processing_task_id: 9,
      purpose_id: 3,
      split_here: false,
      complete: false,
      available: true,
    },
  })
  await render()
  const task = wrapper
    .findAllComponents(ElSelect)
    .find((select) => select.props('ariaLabel') === '加工任务')!
  expect(task.props('modelValue')).toBe(9)
  expect(task.props('disabled')).toBe(true)
  expect(wrapper.text()).toContain('二次研磨')
  wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', employee)
  wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 6)
  wrapper.getComponent(WeightInput).vm.$emit('update:modelValue', 60)
  await save()
  expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
    2,
    expect.objectContaining({ processing_task_id: 9, purpose_id: 3, processor_employee_id: 71 }),
  )
})

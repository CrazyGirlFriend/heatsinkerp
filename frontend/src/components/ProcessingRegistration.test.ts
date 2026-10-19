// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElDatePicker, ElInputNumber, ElSwitch } from 'element-plus'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import WeightInput from './WeightInput.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
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
  })
  await render()
  expect(wrapper.findComponent(ElSwitch).exists()).toBe(false)
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

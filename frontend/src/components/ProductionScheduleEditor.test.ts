// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElDatePicker, ElFormItem, ElInputNumber, ElSelect } from 'element-plus'
import ProductionScheduleEditor from './ProductionScheduleEditor.vue'
import MaterialInput from './MaterialInput.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule } from '@/types/productionSchedule'

vi.mock('@/stores/auth', async (original) => ({
  ...(await original<object>()),
  useAuthStore: () => ({ isAdmin: true, currentUserError: '', currentUser: { active: true } }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 2, name: '轧制', code: 'FACTORY-ROLL', active: true },
      { id: 3, name: '研磨', code: 'FACTORY-GRIND', active: true },
      { id: 4, name: '检验', code: 'FACTORY-QC', active: true },
    ],
  }),
}))
vi.mock('@/services/materialInputApi', () => ({ materialSuggestions: async () => [] }))
const record = (): ProductionSchedule => ({
  id: 5,
  serial_no: '805881-5',
  team_id: 2,
  team_name: '轧制',
  next_team_id: 3,
  next_team_name: '研磨',
  external_destination: null,
  due_at: '2026-10-22T08:00:00Z',
  sequence_no: 1,
  predecessor_id: null,
  target_quantity: 100,
  target_weight: 10,
  notes: null,
  version: 7,
  status: 'pending',
  cancelled_at: null,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
  completed_at: null,
  dispatched_quantity: 0,
  dispatched_weight: 0,
  received_quantity: 0,
  received_weight: 0,
  remaining_quantity: 100,
  remaining_weight: 10,
  sources: [],
  deliveries: [],
  history: [],
})
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(productionScheduleApi, 'create').mockResolvedValue(record())
  vi.spyOn(productionScheduleApi, 'update').mockResolvedValue(record())
  vi.spyOn(productionScheduleApi, 'sources').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(
  props: { schedule?: ProductionSchedule; predecessor?: ProductionSchedule } = {},
) {
  wrapper = mount(ProductionScheduleEditor, {
    props,
    global: {
      directives: { loading: () => {} },
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await flushPromises()
}
async function save() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存排期')!
    .trigger('click')
  await flushPromises()
}
describe('schedule plan editing', () => {
  it('marks missing required fields and prevents sending an incomplete plan', async () => {
    await render()
    await save()
    expect(productionScheduleApi.create).not.toHaveBeenCalled()
    expect(wrapper.findAll('.el-form-item.is-error').length).toBeGreaterThanOrEqual(4)
    expect(wrapper.findAllComponents(ElFormItem).map((item) => item.props('error'))).toContain(
      '请选择接收去向',
    )
    expect(wrapper.findAllComponents(ElFormItem).map((item) => item.props('error'))).not.toContain(
      '接收班组不能与交货班组相同',
    )
  })
  it('rejects choosing the delivery team as the receiving team', async () => {
    await render({ schedule: { ...record(), next_team_id: 2 } })
    await save()
    expect(productionScheduleApi.update).not.toHaveBeenCalled()
    expect(wrapper.findAllComponents(ElFormItem).map((item) => item.props('error'))).toContain(
      '接收班组不能与交货班组相同',
    )
  })
  it('creates a later node before material arrival and preserves the same idempotency key on retry', async () => {
    vi.mocked(productionScheduleApi.create).mockRejectedValueOnce(new Error('网络暂不可用'))
    await render({ predecessor: record() })
    wrapper
      .findAllComponents(ElSelect)
      .find((select) => select.props('placeholder') === '选择接收班组')!
      .vm.$emit('update:modelValue', 4)
    wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', '2026-10-23')
    wrapper
      .findAllComponents(ElSelect)
      .find((select) => select.props('placeholder') === '小时')!
      .vm.$emit('update:modelValue', '07')
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 100)
    await save()
    const first = vi.mocked(productionScheduleApi.create).mock.calls[0]![0]
    expect(first).toMatchObject({
      serial_no: '805881-5',
      team_id: 3,
      next_team_id: 4,
      predecessor_id: 5,
      due_at: '2026-10-23T07:00:00+08:00',
      target_quantity: 100,
      target_weight: null,
      sources: [],
    })
    expect(first.idempotency_key).toBeTruthy()
    await save()
    expect(vi.mocked(productionScheduleApi.create).mock.calls[1]![0].idempotency_key).toBe(
      first.idempotency_key,
    )
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('sends the exact expected version and factory hour on edits', async () => {
    await render({ schedule: record() })
    await save()
    expect(productionScheduleApi.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ expected_version: 7, due_at: '2026-10-22T16:00:00+08:00' }),
    )
    expect(productionScheduleApi.create).not.toHaveBeenCalled()
  })
  it('does not let an edited allocation silently exceed the delivery target', async () => {
    await render({
      schedule: {
        ...record(),
        sources: [{ source_transfer_id: 10, batch_no: 'TL-001', quantity: 101, weight: 10 }],
      },
    })
    await save()
    expect(productionScheduleApi.update).not.toHaveBeenCalled()
    expect(wrapper.get('.schedule-sources').attributes('aria-invalid')).toBe('true')
  })
  it('keeps the destination immutable after dispatch records exist', async () => {
    await render({ schedule: { ...record(), dispatched_quantity: 10 } })
    expect(
      wrapper
        .findAllComponents(ElSelect)
        .find((select) => select.props('placeholder') === '选择接收班组')!
        .props('disabled'),
    ).toBe(true)
  })
  it('does not let reference weight change quantity-based completion', async () => {
    await render({ schedule: { ...record(), completion_basis: 'quantity' } })
    expect(wrapper.text()).toContain('参考重量')
    await save()
    expect(productionScheduleApi.update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        completion_basis: 'quantity',
        target_quantity: 100,
        target_weight: 10,
      }),
    )
  })
  it('keeps task serial and route identity fixed when adjusting a node', async () => {
    await render({
      schedule: { ...record(), task_id: 9, task_no: 'PQ00000009', task_title: '首批板料' },
    })
    expect(wrapper.getComponent(MaterialInput).props('disabled')).toBe(true)
    for (const label of ['选择交货班组', '选择接收班组'])
      expect(
        wrapper
          .findAllComponents(ElSelect)
          .find((select) => select.props('placeholder') === label)!
          .props('disabled'),
      ).toBe(true)
  })
})

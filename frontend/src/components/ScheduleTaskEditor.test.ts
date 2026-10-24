// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElDatePicker, ElInput, ElInputNumber, ElRadioGroup, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import AppDialog from './AppDialog.vue'
import MaterialInput from './MaterialInput.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ScheduleTask } from '@/types/productionSchedule'

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isAdmin: true, currentUserError: '', currentUser: { active: true } }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 1, name: '库房', code: 'FACTORY-WAREHOUSE', active: true },
      { id: 2, name: '轧制', code: 'FACTORY-ROLL', active: true },
      { id: 3, name: '检验', code: 'FACTORY-QC', active: true },
    ],
  }),
}))
vi.mock('@/services/materialInputApi', () => ({ materialSuggestions: async () => [] }))
const task: ScheduleTask = {
  id: 7,
  task_no: 'PQ00000007',
  title: '首批板料',
  serial_no: 'S-001',
  notes: null,
  version: 3,
  created_at: '',
  updated_at: '',
  final_due_at: '',
  status: 'pending',
  nodes: [],
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(productionScheduleApi, 'createTask').mockResolvedValue(task)
  vi.spyOn(productionScheduleApi, 'updateTask').mockResolvedValue(task)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(existing?: ScheduleTask) {
  wrapper = mount(ScheduleTaskEditor, {
    props: { task: existing },
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
function select(label: string, value: unknown) {
  wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === label)!
    .vm.$emit('update:modelValue', value)
}
function amount(label: string, value: number) {
  wrapper
    .findAllComponents(ElInputNumber)
    .find((item) => item.props('ariaLabel') === label)!
    .vm.$emit('update:modelValue', value)
}
function date(label: string, value: string) {
  wrapper
    .findAllComponents(ElDatePicker)
    .at(Number(label.match(/\d+/)?.[0]) - 1)!
    .vm.$emit('update:modelValue', value)
}
async function button(label: string) {
  await wrapper
    .findAll('button')
    .find((item) => item.text() === label)!
    .trigger('click')
  await flushPromises()
}
async function identity() {
  wrapper.getComponent(MaterialInput).vm.$emit('update:modelValue', 'S-001')
  wrapper
    .findAllComponents(ElInput)
    .find((item) => item.props('ariaLabel') === '任务名称')!
    .vm.$emit('update:modelValue', '首批板料')
  await flushPromises()
}
describe('whole-route task scheduling', () => {
  it('marks missing fields instead of creating a partial route', async () => {
    await render()
    await button('保存整条排期')
    expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
    expect(wrapper.findAll('.el-form-item.is-error').length).toBeGreaterThanOrEqual(5)
    const finalDestination = wrapper.get('.route-node__heading .route-node__final')
    expect(finalDestination.classes()).toContain('is-required')
    expect(finalDestination.classes()).toContain('is-error')
  })
  it('creates the whole route before arrival with different targets and stable retry identity', async () => {
    vi.mocked(productionScheduleApi.createTask).mockRejectedValueOnce(new Error('网络暂不可用'))
    await render()
    await identity()
    select('第1站班组', 1)
    select('第1站小时', '08')
    date('第1站日期', '2026-10-23')
    amount('第1站件数', 1)
    amount('第1站重量', 10)
    select('最终接收班组', 2)
    await button('添加下一班组')
    const headings = wrapper.findAll('.route-node__heading')
    expect(headings[0]!.find('.route-node__final').exists()).toBe(false)
    expect(headings[0]!.text()).toContain('交给 轧制')
    expect(headings[1]!.find('.route-node__final').exists()).toBe(true)
    expect(
      wrapper
        .findAllComponents(ElSelect)
        .find((item) => item.props('ariaLabel') === '第2站班组')!
        .props('modelValue'),
    ).toBe(2)
    select('第2站小时', '14')
    date('第2站日期', '2026-10-23')
    amount('第2站件数', 100)
    select('最终接收班组', 3)
    await button('保存整条排期')
    const first = vi.mocked(productionScheduleApi.createTask).mock.calls[0]![0]
    expect(first).toMatchObject({
      serial_no: 'S-001',
      nodes: [
        {
          team_id: 1,
          next_team_id: 2,
          due_at: '2026-10-23T08:00:00+08:00',
          target_quantity: 1,
          target_weight: 10,
          completion_basis: 'quantity',
          sources: [],
        },
        {
          team_id: 2,
          next_team_id: 3,
          due_at: '2026-10-23T14:00:00+08:00',
          target_quantity: 100,
          target_weight: null,
          completion_basis: 'quantity',
          sources: [],
        },
      ],
    })
    expect(wrapper.text()).toContain('参考重量')
    await button('保存整条排期')
    expect(vi.mocked(productionScheduleApi.createTask).mock.calls[1]![0].idempotency_key).toBe(
      first.idempotency_key,
    )
  })
  it('requires both targets only when both is selected and rejects reversed deadlines', async () => {
    await render()
    await identity()
    select('第1站班组', 1)
    select('第1站小时', '14')
    date('第1站日期', '2026-10-23')
    amount('第1站件数', 1)
    select('第1站完成依据', 'both')
    select('最终接收班组', 2)
    await button('保存整条排期')
    expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
    amount('第1站重量', 10)
    await button('添加下一班组')
    select('第2站小时', '08')
    date('第2站日期', '2026-10-23')
    amount('第2站件数', 100)
    select('最终接收班组', 3)
    await button('保存整条排期')
    expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
    select('第2站小时', '16')
    await button('保存整条排期')
    expect(productionScheduleApi.createTask).toHaveBeenCalledOnce()
    expect(
      vi.mocked(productionScheduleApi.createTask).mock.calls[0]![0].nodes[0]!.completion_basis,
    ).toBe('both')
  })
  it('edits task information with optimistic versioning', async () => {
    await render(task)
    expect(wrapper.getComponent(MaterialInput).props('disabled')).toBe(true)
    expect(wrapper.text()).not.toContain('添加下一班组')
    wrapper
      .findAllComponents(ElInput)
      .find((item) => item.props('ariaLabel') === '任务名称')!
      .vm.$emit('update:modelValue', '第二批板料')
    await button('保存任务信息')
    expect(productionScheduleApi.updateTask).toHaveBeenCalledWith(7, {
      expected_version: 3,
      title: '第二批板料',
      notes: null,
      business_person_id: null,
    })
    expect(productionScheduleApi.createTask).not.toHaveBeenCalled()
  })
  it('drops external destination mode when removing the final inspection node', async () => {
    await render()
    select('第1站班组', 2)
    select('最终接收班组', 3)
    await button('添加下一班组')
    wrapper.getComponent(ElRadioGroup).vm.$emit('update:modelValue', 'external')
    await flushPromises()
    expect(
      wrapper
        .findAllComponents(ElSelect)
        .some((item) => item.props('ariaLabel') === '最终外部去向'),
    ).toBe(true)
    await wrapper.get('button[aria-label="移除第2个节点"]').trigger('click')
    await flushPromises()
    expect(
      wrapper
        .findAllComponents(ElSelect)
        .some((item) => item.props('ariaLabel') === '最终外部去向'),
    ).toBe(false)
    expect(
      wrapper
        .findAllComponents(ElSelect)
        .some((item) => item.props('ariaLabel') === '最终接收班组'),
    ).toBe(true)
  })
})

it('keeps a cancelled editor mounted until its exit has finished', async () => {
  await render()
  const dialog = wrapper.getComponent(AppDialog)
  await button('取消')
  expect(dialog.props('modelValue')).toBe(false)
  expect(wrapper.emitted('close')).toBeUndefined()
  dialog.vm.$emit('closed')
  expect(wrapper.emitted('close')).toEqual([[]])
})

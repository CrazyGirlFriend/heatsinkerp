// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElDatePicker, ElInputNumber } from 'element-plus'
import ScheduleBatchEditor from './ScheduleBatchEditor.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isDispatch: false }) }))
let wrapper: VueWrapper
const schedule = {
  ...scheduleSummaryFixture(),
  id: 5,
  task_id: 2,
  version: 7,
  completion_basis: 'quantity',
  due_at: '2026-12-21T08:00:00Z',
  batches: [],
} as unknown as ProductionSchedule
async function render() {
  vi.spyOn(productionScheduleApi, 'task').mockResolvedValue({
    id: 2,
    final_due_at: '2026-12-30T08:00:00Z',
    nodes: [],
  } as unknown as ScheduleTask)
  vi.spyOn(productionScheduleApi, 'saveBatches').mockResolvedValue(schedule)
  wrapper = mount(ScheduleBatchEditor, {
    props: { schedule },
    global: {
      stubs: { AppDialog: { template: '<div><slot/><slot name="footer"/></div>' } },
      directives: { loading: () => {} },
    },
  })
  await flushPromises()
}
async function click(label: string) {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
  await flushPromises()
}
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
describe('team batch planner', () => {
  it('requires an explicit start and keeps the final deadline read-only', async () => {
    await render()
    expect(wrapper.findAllComponents(ElDatePicker)[0]!.props('modelValue')).toBe('')
    await click('提交调度确认')
    expect(productionScheduleApi.saveBatches).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('开始须早于转出')
    expect(wrapper.text()).toContain('2026-12-30 16:00')
  })
  it('saves independent 40/60 batches and their hour-level periods through the owning plan', async () => {
    await render()
    await click('＋ 增加一批')
    const dates = wrapper.findAllComponents(ElDatePicker)
    for (const [i, value] of [
      '2026-12-20T08:00:00',
      '2026-12-21T16:00:00',
      '2026-12-21T09:00:00',
      '2026-12-22T17:00:00',
    ].entries())
      dates[i]!.vm.$emit('update:modelValue', value)
    const amounts = wrapper.findAllComponents(ElInputNumber)
    amounts[1]!.vm.$emit('update:modelValue', 40)
    amounts[3]!.vm.$emit('update:modelValue', 60)
    await click('提交调度确认')
    expect(productionScheduleApi.saveBatches).toHaveBeenCalledWith(5, {
      expected_version: 7,
      batches: [
        {
          batch_number: 1,
          planned_start_at: '2026-12-20T08:00:00+08:00',
          due_at: '2026-12-21T16:00:00+08:00',
          target_quantity: 40,
          target_weight: schedule.target_weight,
          upstream_batch_ids: [],
        },
        {
          batch_number: 2,
          planned_start_at: '2026-12-21T09:00:00+08:00',
          due_at: '2026-12-22T17:00:00+08:00',
          target_quantity: 60,
          target_weight: null,
          upstream_batch_ids: [],
        },
      ],
    })
    expect(wrapper.emitted('saved')).toEqual([[schedule]])
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElPagination } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isAdmin: true, currentUser: { active: true } }),
}))
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
const global = { stubs: { AppDialog: { template: '<div><slot/><slot name="footer"/></div>' } } }

describe('schedule selections', () => {
  it('preserves exact serial selections across pages', async () => {
    vi.spyOn(productionScheduleApi, 'serialOptions').mockImplementation(async ({ page } = {}) => ({
      items: [{ serial_no: page === 2 ? 'C' : 'B', task_count: 2 }],
      total: 21,
      page: page || 1,
      page_size: 20,
    }))
    wrapper = mount(ScheduleSelectionDialog, {
      props: { kind: 'serial', selected: [{ value: 'A,B', label: 'A,B' }] },
      global,
    })
    await flushPromises()
    await wrapper.get('.selection-choice').trigger('click')
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.get('.selection-choice').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '应用选择')!
      .trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toEqual([
      { value: 'A,B', label: 'A,B' },
      { value: 'B', label: 'B' },
      { value: 'C', label: 'C' },
    ])
  })
  it('retains a stopped historical person without allowing new assignment to that person', async () => {
    vi.spyOn(productionScheduleApi, 'people').mockResolvedValue({
      items: [
        { id: 1, name: '张工', active: false, version: 2 },
        { id: 2, name: '李工', active: true, version: 1 },
      ],
      total: 2,
      page: 1,
      page_size: 20,
    })
    wrapper = mount(ScheduleSelectionDialog, {
      props: {
        kind: 'people',
        single: true,
        activeOnly: true,
        selected: [{ value: 1, label: '张工' }],
      },
      global,
    })
    await flushPromises()
    const choices = wrapper.findAll('.selection-choice')
    expect(choices[0]!.attributes('disabled')).toBeDefined()
    await choices[1]!.trigger('click')
    expect(wrapper.emitted('apply')?.[0]).toEqual([[{ value: 2, label: '李工' }]])
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '清除业务人员')!
      .trigger('click')
    expect(wrapper.emitted('apply')?.[1]).toEqual([[]])
  })
})

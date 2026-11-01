// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ElSelect } from 'element-plus'
import WorkspacePagination from './WorkspacePagination.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('WorkspacePagination', () => {
  it('keeps the displayed size consistent with the current data while navigation is pending', async () => {
    const wrapper = mount(WorkspacePagination, {
      props: { currentPage: 1, pageSize: 20, total: 23 },
    })
    wrappers.push(wrapper)
    wrapper.getComponent(ElSelect).vm.$emit('change', 10)
    await flushPromises()
    expect(wrapper.emitted('size-change')).toEqual([[10]])
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(20)
    expect(wrapper.get('.el-pagination__sizes').text()).toContain('20条/页')
    await wrapper.setProps({ pageSize: 10 })
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(10)
    expect(wrapper.get('.el-pagination__sizes').text()).toContain('10条/页')
  })
  it('forwards page and page size changes without changing the caller’s pagination state', async () => {
    const wrapper = mount(WorkspacePagination, {
      props: { currentPage: 1, pageSize: 10, total: 105 },
      slots: { default: '共 105 条库存记录' },
    })
    wrappers.push(wrapper)
    await wrapper.get('.btn-next').trigger('click')
    expect(wrapper.emitted('current-change')?.at(-1)).toEqual([2])
    wrapper.getComponent(ElSelect).vm.$emit('change', 20)
    await flushPromises()
    expect(wrapper.emitted('size-change')?.at(-1)).toEqual([20])
    expect(wrapper.props('pageSize')).toBe(10)
    expect(wrapper.get('.workspace-pagination__summary').text()).toBe('共 105 条库存记录')
  })

  it('blocks page changes while disabled and supports fixed page sizes', async () => {
    const wrapper = mount(WorkspacePagination, {
      props: {
        currentPage: 1,
        pageSize: 20,
        total: 45,
        disabled: true,
        layout: 'prev, pager, next',
      },
    })
    wrappers.push(wrapper)
    expect(wrapper.findComponent(ElSelect).exists()).toBe(false)
    expect(wrapper.get('.btn-next').attributes('disabled')).toBeDefined()
    await wrapper.get('.btn-next').trigger('click')
    expect(wrapper.emitted('current-change')).toBeUndefined()
  })
})

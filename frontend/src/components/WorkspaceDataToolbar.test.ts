// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ElInput } from 'element-plus'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'

describe('shared workbench query controls', () => {
  it('keeps search, filters, query and refresh in order and emits independent actions', async () => {
    const wrapper = mount(WorkspaceDataToolbar, {
      props: { modelValue: '901030', searchLabel: '流水号搜索', refreshLabel: '刷新记录' },
      slots: { filters: '<button type="button" data-filter>筛选</button>' },
    })
    try {
      expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['筛选', '查询', ''])
      expect(wrapper.get('input').attributes('aria-label')).toBe('流水号搜索')
      await wrapper.get('input').setValue('901030-01')
      expect(wrapper.emitted('update:modelValue')).toEqual([['901030-01']])
      await wrapper.get('form').trigger('submit')
      expect(wrapper.emitted('search')).toEqual([[]])
      await wrapper.get('[aria-label="刷新记录"]').trigger('click')
      expect(wrapper.emitted('refresh')).toEqual([[]])
      expect(wrapper.emitted('search')).toHaveLength(1)
      wrapper.getComponent(ElInput).vm.$emit('clear')
      expect(wrapper.emitted('search')).toHaveLength(2)
    } finally {
      wrapper.unmount()
    }
  })
  it('keeps specialized inventory editors inside the same query controls', async () => {
    const wrapper = mount(WorkspaceDataToolbar, {
      slots: { search: '<input type="date" aria-label="库存日期搜索" />' },
    })
    try {
      expect(wrapper.findAll('input')).toHaveLength(1)
      expect(wrapper.get('.workspace-toolbar__search input').attributes('type')).toBe('date')
      await wrapper.get('form').trigger('submit')
      expect(wrapper.emitted('search')).toEqual([[]])
      expect(wrapper.find('[aria-label="刷新工作台"]').exists()).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })
})

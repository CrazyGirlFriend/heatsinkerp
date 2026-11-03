// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { ElTableColumn } from 'element-plus'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
import WorkspaceDataPanel from './WorkspaceDataPanel.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import FilterDialog from './FilterDialog.vue'
import AppDialog from './AppDialog.vue'

vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))
const wrappers: VueWrapper[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function workbench(warehouse = true) {
  const onSearch = vi.fn(),
    onPage = vi.fn(),
    onSize = vi.fn()
  const wrapper = mount(TeamWorkspaceShell, {
    props: { title: warehouse ? '库房' : '研磨', modelValue: 'stock', warehouse },
    slots: {
      default: () =>
        h(WorkspaceDataPanel, {}, () => [
          h(
            WorkspaceDataToolbar,
            { searchLabel: '搜索库存', onSearch, columns: true },
            {
              filters: () => h(FilterDialog, { modelValue: false }),
              actions: () => h('button', { type: 'button' }, '新建入库'),
            },
          ),
          h(
            WorkspaceTable,
            { data: [{ serial: '691236-50', quantity: 100 }], rowKey: 'serial' },
            () => [
              h(ElTableColumn, { prop: 'serial', label: '流水号', fixed: 'left' }),
              h(ElTableColumn, { prop: 'quantity', label: '件数' }),
            ],
          ),
          h(
            WorkspacePagination,
            {
              currentPage: 1,
              pageSize: 10,
              total: 23,
              'onCurrent-change': onPage,
              'onSize-change': onSize,
            },
            { statistics: () => h('span', '合计 100 件') },
          ),
        ]),
    },
  })
  wrappers.push(wrapper)
  return { wrapper, onSearch, onPage, onSize }
}

describe('warehouse shared appearance', () => {
  it('uses the same components throughout warehouse sections and keeps business events', async () => {
    const { wrapper, onSearch, onPage, onSize } = workbench()
    await flushPromises()
    expect(wrapper.find('.wm-data-panel').exists()).toBe(true)
    expect(wrapper.find('.wm-data-table .el-table-fixed-column--left').exists()).toBe(true)
    expect(wrapper.text()).toContain('691236-50')
    expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(false)
    expect(wrapper.text()).toContain('显示列')
    expect(wrapper.text()).not.toContain('更多')
    await wrapper.get('input[aria-label="搜索库存"]').setValue('691236')
    await wrapper.get('input[aria-label="搜索库存"]').trigger('keydown', { key: 'Enter' })
    expect(onSearch).toHaveBeenCalledOnce()
    await wrapper.get('[aria-label="下一页"]').trigger('click')
    expect(onPage).toHaveBeenCalledWith(2)
    await wrapper.get('select[aria-label="每页条数"]').setValue('20')
    expect(onSize).toHaveBeenCalledWith(20)
    expect(wrapper.get('.wm-pagination-statistics').text()).toBe('合计 100 件')
    for (const modelValue of [
      'pending',
      'receipts',
      'outgoing',
      'delivery-schedule',
      'quality-feedback',
      'warehouse',
      'settings',
    ]) {
      await wrapper.setProps({ modelValue })
      expect(wrapper.find('.wm-data-table').exists()).toBe(true)
      expect(wrapper.find('.wm-data-toolbar').exists()).toBe(true)
    }
  })

  it('does not leak the appearance after switching teams', async () => {
    const { wrapper } = workbench()
    await wrapper.setProps({ warehouse: false, title: '研磨' })
    expect(wrapper.find('.wm-data-table').exists()).toBe(false)
    expect(wrapper.find('.business-table').exists()).toBe(true)
    expect(wrapper.find('.workspace-data-toolbar').exists()).toBe(true)
    expect(wrapper.find('.wm-pagination').exists()).toBe(false)
    expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(true)
  })

  it('inherits the appearance in dialogs and retains cancellation without applying filters', async () => {
    const { wrapper } = workbench()
    await wrapper.get('[aria-label="筛选条件"]').trigger('click')
    const filter = wrapper.getComponent(FilterDialog)
    expect(filter.emitted('open')).toEqual([[]])
    expect(filter.emitted('update:modelValue')).toEqual([[true]])
    // Existing dialog API and close events are retained, including teleported contents.
    const dialog = filter.getComponent(AppDialog)
    dialog.vm.$emit('update:modelValue', false)
    expect(filter.emitted('cancel')).toEqual([[]])
    expect(filter.emitted('apply')).toBeUndefined()
  })
})

// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())
describe('workspace tab states', () => {
  it('enables the approved reading layout on every team page', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'serials' } })
    expect(wrapper.classes()).toContain('team-workspace--reading')
    for (const modelValue of ['pending', 'stock', 'outgoing', 'receipts', 'losses', 'materials', 'overview']) {
      await wrapper.setProps({ modelValue })
      expect(wrapper.classes()).toContain('team-workspace--reading')
      expect(wrapper.classes()).toContain('reading-workspace')
    }
  })
  it('places business actions next to tabs, outside the selected data panel', () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'serials' }, slots: { actions: '<button class="sample-action">新建出库</button>', default: '<div>台账数据</div>' } })
    expect(wrapper.get('.team-workspace__navigation .sample-action').text()).toBe('新建出库')
    expect(wrapper.get('[role=tablist]').find('.sample-action').exists()).toBe(false)
    expect(wrapper.get('[role=tabpanel]').find('.sample-action').exists()).toBe(false)
    expect(wrapper.get('[role=tabpanel]').text()).toBe('台账数据')
  })
  it('keeps exactly one selected tab and preserves panel associations after clicking', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'serials', warehouse: true, pendingCount: 23 } })
    expect(wrapper.findAll('[role=tab]')).toHaveLength(8)
    expect(wrapper.findAll('[aria-selected=true]')).toHaveLength(1)
    expect(wrapper.get('.is-selected').text()).toBe('流水号台账')
    await wrapper.get('#workspace-tab-receipts').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['receipts']])
    await wrapper.setProps({ modelValue: 'receipts' })
    expect(wrapper.get('.is-selected').attributes('tabindex')).toBe('0')
    expect(wrapper.get('[role=tabpanel]').attributes('aria-labelledby')).toBe('workspace-tab-receipts')
    expect(wrapper.get('#workspace-tab-serials').attributes('aria-selected')).toBe('false')
  })
  it('retains keyboard navigation, visible counts and the hidden page heading', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '轧制', modelValue: 'pending', pendingCount: 23 } })
    expect(wrapper.get('#workspace-tab-pending small').text()).toBe('23')
    expect(wrapper.get('h1').classes()).toContain('sr-only')
    await wrapper.get('#workspace-tab-pending').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.get('#workspace-tab-pending').trigger('keydown', { key: 'Home' })
    await wrapper.get('#workspace-tab-pending').trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['stock'], ['serials'], ['overview']])
  })
})

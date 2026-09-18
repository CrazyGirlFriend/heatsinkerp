// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ElDropdown } from 'element-plus'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())
describe('workspace tab states', () => {
  it('enables the approved reading layout on every team page', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock' } })
    expect(wrapper.classes()).toContain('team-workspace--reading')
    for (const modelValue of ['pending', 'stock', 'outgoing', 'receipts', 'losses', 'materials', 'overview']) {
      await wrapper.setProps({ modelValue })
      expect(wrapper.classes()).toContain('team-workspace--reading')
      expect(wrapper.classes()).toContain('reading-workspace')
    }
  })
  it('places business actions next to tabs, outside the selected data panel', () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock' }, slots: { actions: '<button class="sample-action">新建出库</button>', default: '<div>台账数据</div>' } })
    expect(wrapper.get('.team-workspace__navigation .sample-action').text()).toBe('新建出库')
    expect(wrapper.get('[role=tablist]').find('.sample-action').exists()).toBe(false)
    expect(wrapper.get('[role=tabpanel]').find('.sample-action').exists()).toBe(false)
    expect(wrapper.get('[role=tabpanel]').text()).toBe('台账数据')
  })
  it('keeps exactly one selected tab and preserves panel associations after clicking', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock', warehouse: true, pendingCount: 23 } })
    expect(wrapper.findAll('[role=tab]')).toHaveLength(5)
    expect(wrapper.findAll('[aria-selected=true]')).toHaveLength(1)
    expect(wrapper.get('.is-selected').text()).toBe('库存明细')
    await wrapper.get('#workspace-tab-receipts').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['receipts']])
    await wrapper.setProps({ modelValue: 'receipts' })
    expect(wrapper.get('.is-selected').attributes('tabindex')).toBe('0')
    expect(wrapper.get('[role=tabpanel]').attributes('aria-labelledby')).toBe('workspace-tab-receipts')
    expect(wrapper.get('#workspace-tab-stock').attributes('aria-selected')).toBe('false')
  })
  it('keeps warehouse statistics in a dropdown and restores access to the main tabs', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock', warehouse: true } })
    expect(wrapper.get('#workspace-tab-statistics').text()).toBe('统计')
    wrapper.getComponent(ElDropdown).vm.$emit('command', 'materials')
    expect(wrapper.emitted('update:modelValue')).toEqual([['materials']])
    await wrapper.setProps({ modelValue: 'materials' })
    expect(wrapper.get('h1').text()).toBe('材质归类')
    expect(wrapper.get('[role=tabpanel]').attributes('aria-labelledby')).toBe('workspace-tab-statistics')
    expect(wrapper.get('#workspace-tab-stock').attributes('tabindex')).toBe('0')
    expect(wrapper.findAll('[aria-selected=true]')).toHaveLength(0)
  })
  it('retains keyboard navigation, visible counts and the hidden page heading', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '轧制', modelValue: 'pending', pendingCount: 23 } })
    expect(wrapper.get('#workspace-tab-pending small').text()).toBe('23')
    expect(wrapper.get('h1').classes()).toContain('sr-only')
    await wrapper.get('#workspace-tab-pending').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.get('#workspace-tab-pending').trigger('keydown', { key: 'Home' })
    await wrapper.get('#workspace-tab-pending').trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['outgoing'], ['stock'], ['overview']])
  })
})

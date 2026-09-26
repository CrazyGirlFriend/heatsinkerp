// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())
describe('workspace with sidebar navigation', () => {
  it('retains the reading layout and labels each section without duplicate tabs', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock' } })
    for (const [modelValue, label] of [['stock', '库存明细'], ['pending', '待接收'], ['receipts', '入库记录'], ['outgoing', '出库记录'], ['losses', '丢失记录'], ['materials', '材质归类'], ['history', '收发历史']]) {
      await wrapper.setProps({ modelValue })
      expect(wrapper.classes()).toContain('team-workspace--reading')
      expect(wrapper.get('h1').text()).toBe(label)
      expect(wrapper.get('[role=region]').attributes('aria-labelledby')).toBe(wrapper.get('h1').attributes('id'))
    }
    expect(wrapper.find('[role=tablist]').exists()).toBe(false)
    expect(wrapper.find('.workspace-statistics').exists()).toBe(false)
    expect(wrapper.find('.team-workspace__navigation').exists()).toBe(false)
  })
  it('keeps actions outside the data region without a second navigation bar', () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '研磨', modelValue: 'stock' }, slots: { actions: '<button>新建出库</button>', default: '<div>库存数据</div>' } })
    expect(wrapper.get('[aria-label="工作台操作"]').text()).toBe('新建出库')
    expect(wrapper.get('[role=region]').text()).toBe('库存数据')
    expect(wrapper.get('h1').classes()).toContain('sr-only')
  })
})

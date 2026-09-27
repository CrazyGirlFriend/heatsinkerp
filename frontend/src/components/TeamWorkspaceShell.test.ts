// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))

let wrapper: VueWrapper
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('workspace with in-page navigation', () => {
  it('retains the reading layout and selects each warehouse section without large headings', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock', warehouse: true } })
    for (const [modelValue, label] of [['stock', '库存明细'], ['pending', '待接收'], ['receipts', '入库记录'], ['outgoing', '出库记录'], ['losses', '丢失记录'], ['materials', '材质库存'], ['material-types', '类型库存'], ['history', '收发历史']]) {
      await wrapper.setProps({ modelValue })
      expect(wrapper.classes()).toContain('team-workspace--reading')
      expect(wrapper.classes('team-workspace--materials')).toBe(['materials', 'material-types'].includes(modelValue!))
      expect(wrapper.get('h1').text()).toBe(label)
      expect(wrapper.get('[role=region]').attributes('aria-labelledby')).toBe(wrapper.get('h1').attributes('id'))
      expect(wrapper.get('nav [aria-current=page]').text()).toBe(label)
      expect(wrapper.get('nav [aria-current=page]').attributes('aria-controls')).toBe(wrapper.get('[role=region]').attributes('id'))
    }
    expect(wrapper.find('.workspace-statistics').exists()).toBe(false)
    expect(wrapper.get('nav').attributes('aria-label')).toBe('库房功能')
    expect(wrapper.findAll('nav button')).toHaveLength(8)
  })
  it('keeps actions inside the data toolbar and hides warehouse-only sections for other teams', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '研磨', modelValue: 'stock' }, slots: { default: '<div><header><button>新建出库</button></header>库存数据</div>' } })
    expect(wrapper.findAll('nav button').map(button => button.text())).toEqual(['库存明细', '待接收', '出库记录', '丢失记录', '材质库存', '类型库存', '收发历史'])
    await wrapper.findAll('nav button')[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['pending']])
    expect(wrapper.get('[role=region] header').text()).toBe('新建出库')
    expect(wrapper.get('h1').classes()).toContain('sr-only')
  })
  it('updates pending counts without replacing the data region or showing stale zero counts', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '研磨', modelValue: 'stock', pendingCount: 23 }, slots: { default: '<input value="未提交内容" />' } })
    const input = wrapper.get('input').element
    expect(wrapper.get('.team-workspace__pending').text()).toBe('23')
    await wrapper.setProps({ pendingCount: 24, modelValue: 'pending' })
    expect(wrapper.get('nav [aria-current=page]').text()).toBe('待接收24')
    expect(wrapper.get('input').element).toBe(input)
    for (const pendingCount of [0, null]) {
      await wrapper.setProps({ pendingCount })
      expect(wrapper.find('.team-workspace__pending').exists()).toBe(false)
    }
  })
  it('reveals the selected section on narrow screens without scrolling the page and cleans up', async () => {
    let resize = () => undefined as void
    const disconnect = vi.fn(), observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe = observe; disconnect = disconnect })
    wrapper = mount(TeamWorkspaceShell, { props: { title: '研磨', modelValue: 'stock' } })
    const nav = wrapper.get('nav').element
    Object.defineProperties(nav, { clientWidth: { value: 300 }, scrollWidth: { value: 600 } })
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 310 } as DOMRect)
    const buttons = wrapper.findAll('nav button')
    vi.spyOn(buttons.at(-1)!.element, 'getBoundingClientRect').mockReturnValue({ left: 520, right: 600 } as DOMRect)
    await wrapper.setProps({ modelValue: 'history' })
    expect(nav.scrollLeft).toBe(296)
    nav.scrollLeft = 0; resize()
    expect(nav.scrollLeft).toBe(296)
    nav.scrollLeft = 0
    await wrapper.setProps({ pendingCount: 23 })
    expect(nav.scrollLeft).toBe(296)
    vi.spyOn(buttons[0]!.element, 'getBoundingClientRect').mockReturnValue({ left: -286, right: -206 } as DOMRect)
    await wrapper.setProps({ modelValue: 'stock' })
    expect(nav.scrollLeft).toBe(-6) // Browser clamps the requested offset at zero.
    expect(nav.scrollTop).toBe(0)
    expect(observe).toHaveBeenCalledWith(nav)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const key of ['fullscreenElement', 'exitFullscreen']) Reflect.deleteProperty(document, key)
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
})
function nativeFullscreen() {
  let element: Element | null = null
  const change = (value: Element | null) => { element = value; document.dispatchEvent(new Event('fullscreenchange')) }
  const request = vi.fn(async () => { change(document.documentElement) })
  const exit = vi.fn(async () => { change(null) })
  Object.defineProperties(document, { fullscreenElement: { configurable: true, get: () => element }, exitFullscreen: { configurable: true, value: exit } })
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request })
  return { change, request, exit }
}
describe('workspace with in-page navigation', () => {
  it('retains the reading layout and selects each warehouse section below the team title', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock', warehouse: true } })
    expect(wrapper.get('.team-workspace__title').text()).toBe('库房工作台')
    for (const [modelValue, label] of [['stock', '库存明细'], ['pending', '来料待签收'], ['receipts', '入库记录'], ['outgoing', '出库记录'], ['losses', '丢失记录'], ['materials', '材质库存'], ['material-types', '类型库存'], ['history', '收发历史']]) {
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
    expect(wrapper.findAll('nav button').map(button => button.text())).toEqual(['库存明细', '来料待签收', '入库记录', '出库记录', '丢失记录', '材质库存', '类型库存', '收发历史'])
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
    expect(wrapper.get('nav [aria-current=page]').text()).toBe('来料待签收24')
    expect(wrapper.get('input').element).toBe(input)
    for (const pendingCount of [0, null]) {
      await wrapper.setProps({ pendingCount })
      expect(wrapper.find('.team-workspace__pending').exists()).toBe(false)
    }
  })
  it('keeps every permission-dependent section available when there are more than nine tabs', async () => {
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock', warehouse: true, manageWarehouse: true, reallocations: true, processing: true } })
    expect(wrapper.findAll('nav button')).toHaveLength(11)
    await wrapper.findAll('nav button').at(-1)!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['warehouse']])
    await wrapper.setProps({ modelValue: 'warehouse' })
    expect(wrapper.get('nav [aria-current=page]').text()).toBe('仓库管理')
    await wrapper.setProps({ manageWarehouse: false, reallocations: false, processing: false, modelValue: 'stock' })
    expect(wrapper.findAll('nav button')).toHaveLength(8)
  })
  it('preserves export and settings permissions in the header and fullscreen commands', async () => {
    nativeFullscreen()
    wrapper = mount(TeamWorkspaceShell, { props: { title: '轧制', modelValue: 'stock', exportable: true }, slots: { settings: '<button>班组设置</button>', 'fullscreen-status': '<span role="status">连接中断</span>' } })
    const settings = wrapper.get('.team-workspace__settings button').element
    await wrapper.get('.team-workspace__export').trigger('click')
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    expect(wrapper.get('.team-workspace__settings').attributes('style')).toContain('display: none')
    expect(wrapper.get('.team-workspace__status').text()).toBe('连接中断')
    await wrapper.get('.team-workspace__export').trigger('click')
    expect(wrapper.emitted('export')).toEqual([[], []])
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    expect(wrapper.get('.team-workspace__settings button').element).toBe(settings)
    expect(wrapper.get('.team-workspace__settings').attributes('style') || '').not.toContain('display: none')
    await wrapper.setProps({ exportable: false })
    expect(wrapper.find('.team-workspace__export').exists()).toBe(false)
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
  it('expands the document with its dialogs and preserves the data region on entry and exit', async () => {
    const native = nativeFullscreen()
    wrapper = mount(TeamWorkspaceShell, { props: { title: '研磨', modelValue: 'stock' }, slots: { default: '<input value="未提交内容" />' } })
    const input = wrapper.get('input').element
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    expect(native.request).toHaveBeenCalledOnce()
    expect(document.fullscreenElement).toBe(document.documentElement)
    expect(wrapper.classes()).toContain('team-workspace--fullscreen')
    expect(wrapper.get('.team-workspace__team').text()).toBe('研磨 · 库存明细')
    expect(wrapper.get('nav').attributes('style')).toContain('display: none')
    expect(wrapper.get('.team-workspace__fullscreen').attributes('aria-pressed')).toBe('true')
    await wrapper.setProps({ modelValue: 'materials' })
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(true)
    expect(wrapper.get('.team-workspace__team').text()).toBe('研磨 · 材质库存')
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    expect(native.exit).toHaveBeenCalledOnce()
    expect(wrapper.get('input').element).toBe(input)
    expect(wrapper.get('nav').attributes('style') || '').not.toContain('display: none')
    expect(wrapper.emitted('fullscreen-change')).toEqual([[true], [false]])
  })
  it('uses a viewport fallback when native fullscreen fails and exits with Escape', async () => {
    const native = nativeFullscreen()
    native.request.mockRejectedValue(new Error('Unavailable'))
    wrapper = mount(TeamWorkspaceShell, { props: { title: '检验', modelValue: 'material-types' } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flushPromises()
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
    expect(native.exit).not.toHaveBeenCalled()
  })
  it('follows browser fullscreen exit and leaves fullscreen on team or non-table navigation', async () => {
    const native = nativeFullscreen()
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock', warehouse: true, manageWarehouse: true } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    native.change(null); await flushPromises()
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    await wrapper.setProps({ title: '检验' })
    expect(native.exit).toHaveBeenCalledOnce()
    for (const modelValue of ['history', 'warehouse']) {
      await wrapper.setProps({ modelValue: 'stock' })
      await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
      await wrapper.setProps({ modelValue })
      expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
      expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(false)
    }
  })
  it('closes a late fullscreen request after unmount and prevents duplicate requests', async () => {
    const native = nativeFullscreen()
    let resolve = () => undefined as void
    native.request.mockImplementation(() => new Promise<void>(done => { resolve = () => { native.change(document.documentElement); done() } }))
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock' } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    expect(native.request).toHaveBeenCalledOnce()
    expect(wrapper.get('.team-workspace__fullscreen').attributes('disabled')).toBeDefined()
    wrapper.unmount(); resolve(); await flushPromises()
    expect(native.exit).toHaveBeenCalledOnce()
    expect(document.fullscreenElement).toBeNull()
  })
  it('does not exit another component’s native fullscreen', async () => {
    const native = nativeFullscreen()
    const unrelated = document.createElement('video'); native.change(unrelated)
    wrapper = mount(TeamWorkspaceShell, { props: { title: '库房', modelValue: 'stock' } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click'); await flushPromises()
    wrapper.unmount()
    expect(native.request).not.toHaveBeenCalled()
    expect(native.exit).not.toHaveBeenCalled()
    expect(document.fullscreenElement).toBe(unrelated)
  })
})

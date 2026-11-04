// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
import WatermelonFilter from './watermelon/WatermelonFilter.vue'
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const key of ['fullscreenElement', 'exitFullscreen']) Reflect.deleteProperty(document, key)
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
})
function nativeFullscreen() {
  let element: Element | null = null
  const change = (value: Element | null) => {
    element = value
    document.dispatchEvent(new Event('fullscreenchange'))
  }
  const request = vi.fn(async () => {
    change(document.documentElement)
  })
  const exit = vi.fn(async () => {
    change(null)
  })
  Object.defineProperties(document, {
    fullscreenElement: { configurable: true, get: () => element },
    exitFullscreen: { configurable: true, value: exit },
  })
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: request,
  })
  return { change, request, exit }
}
function mountShell(options: {
  props: InstanceType<typeof TeamWorkspaceShell>['$props']
  slots?: Record<string, string>
}) {
  const content = { template: options.slots?.default || '<span />' }
  return mount(TeamWorkspaceShell, {
    ...options,
    global: { stubs: { teleport: true } },
    slots: {
      ...options.slots,
      default: () => [h(WorkspaceDataToolbar, { searchable: false, refresh: false }), h(content)],
    },
  })
}
describe('workspace with in-page navigation', () => {
  it('switches views from the header dropdown without adding a row or remounting content', async () => {
    wrapper = mountShell({
      props: {
        title: '库房',
        modelValue: 'pending',
        warehouse: true,
        pendingCount: 23,
        reallocations: true,
      },
      slots: { default: '<input value="未提交内容" />' },
    })
    const input = wrapper.get('input').element
    expect(wrapper.find('.team-workspace__content--card nav').exists()).toBe(false)
    const filter = wrapper.getComponent(WatermelonFilter)
    expect(filter.props('viewSwitch')).toBe(true)
    expect(
      wrapper.get('.team-workspace__heading [aria-current=page]').text().replace(/\s+/g, ''),
    ).toBe('来料待签收23')
    await filter.get('button').trigger('click')
    const choices = () => wrapper.findAll('[role=menuitemradio]')
    expect(choices().map((choice) => choice.text().replace(/\s+/g, ''))).toEqual([
      '来料待签收23',
      '入库记录',
      '出库记录',
      '转投记录',
      '收发历史',
    ])
    await choices()[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['receipts']])
    await wrapper.setProps({ modelValue: 'receipts', pendingCount: 24 })
    expect(wrapper.get('[aria-current=page]').text()).toBe('入库记录')
    expect(wrapper.get('input').element).toBe(input)
    await wrapper.setProps({ modelValue: 'delivery-schedule' })
    expect(wrapper.findComponent(WatermelonFilter).exists()).toBe(false)
  })
  it('uses the selected inventory view as the header label and omits retired material inventory', async () => {
    wrapper = mountShell({ props: { title: '库房', modelValue: 'stock', warehouse: true } })
    const filter = wrapper.getComponent(WatermelonFilter)
    expect(filter.props('options').map((option: { label: string }) => option.label)).toEqual([
      '库存明细',
      '丢失记录',
    ])
    for (const [modelValue, label] of [
      ['stock', '库存明细'],
      ['losses', '丢失记录'],
    ]) {
      await wrapper.setProps({ modelValue })
      expect(wrapper.get('h1').text()).toBe(label)
      expect(wrapper.get('[role=region]').attributes('aria-labelledby')).toBe(
        wrapper.get('h1').attributes('id'),
      )
      expect(wrapper.get('nav [aria-current=page]').text()).toBe(label)
    }
  })
  it('keeps actions inside the data toolbar and hides warehouse-only sections for other teams', async () => {
    wrapper = mountShell({
      props: { title: '研磨', modelValue: 'stock' },
      slots: { default: '<div><header><button>新建出库</button></header>库存数据</div>' },
    })
    expect(wrapper.findAll('nav button').map((button) => button.text())).toEqual([
      '库存明细',
      '丢失记录',
    ])
    expect(wrapper.get('.team-workspace__module').text()).toBe('库存')
    await wrapper.setProps({ modelValue: 'receipts' })
    await wrapper
      .findAll('nav button')
      .find((button) => button.text() === '来料待签收')!
      .trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['pending']])
    expect(wrapper.get('[role=region] header').text()).toBe('新建出库')
    expect(wrapper.get('h1').classes()).toContain('sr-only')
  })
  it('updates pending counts without replacing the data region or showing stale zero counts', async () => {
    wrapper = mountShell({
      props: { title: '研磨', modelValue: 'receipts', pendingCount: 23 },
      slots: { default: '<input value="未提交内容" />' },
    })
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
  it('keeps single-view modules direct and limits the dropdown to related views', async () => {
    wrapper = mountShell({
      props: {
        title: '库房',
        modelValue: 'stock',
        warehouse: true,
        manageWarehouse: true,
        reallocations: true,
      },
    })
    expect(wrapper.getComponent(WatermelonFilter).props('options')).toHaveLength(2)
    await wrapper.setProps({ modelValue: 'warehouse' })
    expect(wrapper.get('h1').text()).toBe('仓库管理')
    expect(wrapper.findComponent(WatermelonFilter).exists()).toBe(false)
    await wrapper.setProps({
      title: '检验',
      modelValue: 'inspections',
      processing: true,
      inspection: true,
    })
    expect(
      wrapper
        .getComponent(WatermelonFilter)
        .props('options')
        .map((option: { label: string }) => option.label),
    ).toEqual(['检验记录', '质量反馈', '巡检记录'])
  })
  it('keeps export, fullscreen and settings after the query controls without duplicates', async () => {
    nativeFullscreen()
    wrapper = mountShell({
      props: { title: '轧制', modelValue: 'stock', exportable: true, settings: true },
      slots: { 'fullscreen-status': '<span role="status">连接中断</span>' },
    })
    expect(wrapper.find('.team-workspace__navigation-row').exists()).toBe(false)
    expect(wrapper.get('.workspace-data-toolbar .team-workspace__export').text()).toBe('导出')
    expect(wrapper.get('.workspace-data-toolbar .team-workspace__fullscreen').text()).toBe('全屏')
    expect(wrapper.find('.team-workspace__navigation-bar .team-workspace__export').exists()).toBe(
      false,
    )
    expect(wrapper.findAll('.team-workspace__export')).toHaveLength(1)
    expect(wrapper.findAll('.team-workspace__fullscreen')).toHaveLength(1)
    await wrapper.get('[aria-label="班组设置"]').trigger('click')
    expect(wrapper.emitted('settings')).toEqual([[]])
    await wrapper.get('.team-workspace__export').trigger('click')
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="班组设置"]').exists()).toBe(false)
    expect(wrapper.get('.team-workspace__status').text()).toBe('连接中断')
    await wrapper.get('.team-workspace__export').trigger('click')
    expect(wrapper.emitted('export')).toEqual([[], []])
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    await wrapper.setProps({ exportable: false, settings: false })
    expect(wrapper.find('.team-workspace__export').exists()).toBe(false)
    expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
  })
  it.each(['delivery-schedule', 'inspections', 'inspection-results', 'process-routes'])(
    'retains settings, messages and fullscreen for %s without a legacy toolbar',
    async (modelValue) => {
      nativeFullscreen()
      const engineering = modelValue === 'process-routes'
      wrapper = mountShell({
        props: {
          title: engineering ? '工艺' : '检验',
          modelValue,
          engineering,
          inspection: true,
          processing: true,
          qualityCount: 3,
          settings: true,
        },
        slots: {
          messages: '<button data-message>提交返工问题</button>',
        },
      })
      await flushPromises()
      expect(wrapper.findAll('.team-workspace__fullscreen')).toHaveLength(1)
      expect(wrapper.findAll('[data-message]')).toHaveLength(1)
      if (['inspections', 'inspection-results'].includes(modelValue))
        expect(wrapper.get('nav').text()).toContain('质量反馈3')
      else expect(wrapper.get('nav').isVisible()).toBe(false)
      if (engineering) {
        expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
        expect(wrapper.get('.workspace-data-toolbar [aria-label="班组设置"]').text()).toBe(
          '班组设置',
        )
      } else {
        await wrapper.get('[aria-label="班组设置"]').trigger('click')
        expect(wrapper.emitted('settings')).toEqual([[]])
      }
      await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('[data-message]')).toHaveLength(1)
      expect(wrapper.findAll('.team-workspace__fullscreen')).toHaveLength(1)
      expect(wrapper.classes('team-workspace--fullscreen')).toBe(true)
      await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
      expect(wrapper.findAll('[data-message]')).toHaveLength(1)
    },
  )
  it('reveals the selected section on narrow screens without scrolling the page and cleans up', async () => {
    let resize = () => undefined as void
    const disconnect = vi.fn(),
      observe = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    wrapper = mountShell({ props: { title: '研磨', modelValue: 'stock' } })
    const nav = wrapper.get('nav').element
    Object.defineProperties(nav, { clientWidth: { value: 300 }, scrollWidth: { value: 600 } })
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 310 } as DOMRect)
    const buttons = wrapper.findAll('nav button')
    vi.spyOn(buttons.at(-1)!.element, 'getBoundingClientRect').mockReturnValue({
      left: 520,
      right: 600,
    } as DOMRect)
    await wrapper.setProps({ modelValue: 'losses' })
    expect(nav.scrollLeft).toBe(296)
    nav.scrollLeft = 0
    resize()
    expect(nav.scrollLeft).toBe(296)
    nav.scrollLeft = 0
    await wrapper.setProps({ pendingCount: 23 })
    expect(nav.scrollLeft).toBe(296)
    vi.spyOn(buttons[0]!.element, 'getBoundingClientRect').mockReturnValue({
      left: -286,
      right: -206,
    } as DOMRect)
    await wrapper.setProps({ modelValue: 'stock' })
    expect(nav.scrollLeft).toBe(-6) // Browser clamps the requested offset at zero.
    expect(nav.scrollTop).toBe(0)
    expect(observe).toHaveBeenCalledWith(nav)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledTimes(observe.mock.calls.length)
  })
  it('keeps the single team settings action visible without an unnecessary More menu', async () => {
    let width = 1440
    const callbacks: Array<() => void> = []
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width }) as DOMRect,
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    wrapper = mountShell({
      props: { title: '研磨', modelValue: 'stock', settings: true },
    })
    callbacks.forEach((callback) => callback())
    await flushPromises()
    expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
    expect(wrapper.get('.workspace-tools__inline [aria-label="班组设置"]').text()).toBe('班组设置')
    width = 900
    callbacks.forEach((callback) => callback())
    await flushPromises()
    expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
    await wrapper.get('[aria-label="班组设置"]').trigger('click')
    expect(wrapper.emitted('settings')).toEqual([[]])
    width = 1440
    callbacks.forEach((callback) => callback())
    await flushPromises()
    expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
    expect(wrapper.find('.workspace-tools__inline [aria-label="班组设置"]').exists()).toBe(true)
  })
  it('expands the document with its dialogs and preserves the data region on entry and exit', async () => {
    const native = nativeFullscreen()
    wrapper = mountShell({
      props: { title: '研磨', modelValue: 'stock' },
      slots: { default: '<input value="未提交内容" />' },
    })
    const input = wrapper.get('input').element
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    expect(native.request).toHaveBeenCalledOnce()
    expect(document.fullscreenElement).toBe(document.documentElement)
    expect(wrapper.classes()).toContain('team-workspace--fullscreen')
    expect(wrapper.get('.team-workspace__team').text()).toBe('研磨 · 库存明细')
    expect(wrapper.get('.team-workspace__navigation-bar').attributes('style')).toContain(
      'display: none',
    )
    expect(wrapper.get('.team-workspace__fullscreen').attributes('aria-pressed')).toBe('true')
    await wrapper.setProps({ modelValue: 'materials' })
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(true)
    expect(wrapper.get('.team-workspace__team').text()).toBe('研磨 · 材质库存')
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    expect(native.exit).toHaveBeenCalledOnce()
    expect(wrapper.get('input').element).toBe(input)
    expect(wrapper.get('.team-workspace__navigation-bar').attributes('style') || '').not.toContain(
      'display: none',
    )
    expect(wrapper.emitted('fullscreen-change')).toEqual([[true], [false]])
  })
  it('uses a viewport fallback when native fullscreen fails and exits with Escape', async () => {
    const native = nativeFullscreen()
    native.request.mockRejectedValue(new Error('Unavailable'))
    wrapper = mountShell({ props: { title: '检验', modelValue: 'losses' } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
    expect(native.exit).not.toHaveBeenCalled()
  })
  it('follows browser fullscreen exit and keeps supported workbench tabs in fullscreen', async () => {
    const native = nativeFullscreen()
    wrapper = mountShell({
      props: {
        title: '库房',
        modelValue: 'stock',
        warehouse: true,
        appearance: 'glass',
        manageWarehouse: true,
      },
    })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    native.change(null)
    await flushPromises()
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    await wrapper.setProps({ title: '检验' })
    expect(native.exit).toHaveBeenCalledOnce()
    for (const modelValue of ['history']) {
      await wrapper.setProps({ modelValue: 'stock' })
      await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      await wrapper.setProps({ modelValue })
      expect(wrapper.classes('team-workspace--fullscreen')).toBe(true)
      expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(true)
      await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
    }
  })
  it('removes fullscreen for warehouse management and exits it when switching from stock', async () => {
    const native = nativeFullscreen()
    wrapper = mountShell({
      props: {
        title: '库房',
        modelValue: 'stock',
        warehouse: true,
        appearance: 'glass',
        manageWarehouse: true,
      },
    })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    await wrapper.setProps({ modelValue: 'warehouse' })
    await flushPromises()
    expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(false)
    expect(wrapper.classes('team-workspace--fullscreen')).toBe(false)
    expect(native.exit).toHaveBeenCalledOnce()
  })
  it('closes a late fullscreen request after unmount and prevents duplicate requests', async () => {
    const native = nativeFullscreen()
    let resolve = () => undefined as void
    native.request.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = () => {
            native.change(document.documentElement)
            done()
          }
        }),
    )
    wrapper = mountShell({ props: { title: '库房', modelValue: 'stock' } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    expect(native.request).toHaveBeenCalledOnce()
    expect(wrapper.get('.team-workspace__fullscreen').attributes('disabled')).toBeDefined()
    wrapper.unmount()
    resolve()
    await flushPromises()
    expect(native.exit).toHaveBeenCalledOnce()
    expect(document.fullscreenElement).toBeNull()
  })
  it('does not exit another component’s native fullscreen', async () => {
    const native = nativeFullscreen()
    const unrelated = document.createElement('video')
    native.change(unrelated)
    wrapper = mountShell({ props: { title: '库房', modelValue: 'stock' } })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    wrapper.unmount()
    expect(native.request).not.toHaveBeenCalled()
    expect(native.exit).not.toHaveBeenCalled()
    expect(document.fullscreenElement).toBe(unrelated)
  })
})

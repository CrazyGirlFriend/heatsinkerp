// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LedgerChart from './LedgerChart.vue'

const chart = vi.hoisted(() => ({ on: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn(), getWidth: () => 800, getHeight: () => 380 }))
vi.mock('echarts/core', () => ({ use: vi.fn(), init: () => chart }))
let notifyResize: () => void, width = 800, wrapper: VueWrapper
const disconnect = vi.fn()
beforeEach(() => {
  width = 800
  vi.clearAllMocks()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(380)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('preserves entrance drawing on initial and unchanged resize notifications, but resizes actual changes', () => {
  wrapper = mount(LedgerChart, { props: { option: {}, label: '历史', enterDuration: 1400 } })
  notifyResize()
  expect(chart.setOption).toHaveBeenCalledWith(expect.objectContaining({ animation: true, animationDuration: 1400 }), expect.anything())
  expect(chart.resize).not.toHaveBeenCalled()
  width = 900
  notifyResize()
  expect(chart.resize).toHaveBeenCalledOnce()
  wrapper.unmount()
  expect(chart.dispose).toHaveBeenCalledOnce()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('honors reduced-motion preferences without losing chart data', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  wrapper = mount(LedgerChart, { props: { option: { series: [] }, label: '历史' } })
  expect(chart.setOption).toHaveBeenCalledWith(expect.objectContaining({ animation: false, series: [] }), expect.anything())
})

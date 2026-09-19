// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FlowPreviewCanvas from './FlowPreviewCanvas.vue'

const stopAnimation = vi.hoisted(() => vi.fn())
const chart = vi.hoisted(() => ({ on: vi.fn(), setOption: vi.fn(), clear: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn(), getOption: vi.fn(), getWidth: () => 800, getHeight: () => 560, getZr: () => ({ storage: { getDisplayList: () => [{ stopAnimation }] } }) }))
const initialize = vi.hoisted(() => vi.fn())
vi.mock('echarts/core', () => ({ use: vi.fn(), init: initialize }))
let wrapper: VueWrapper | undefined, notifyResize: () => void, width = 800
const disconnect = vi.fn(), removeListener = vi.fn()
beforeEach(() => {
  vi.clearAllMocks(); width = 800
  initialize.mockReturnValue(chart)
  chart.getOption.mockReturnValue({ dataZoom: [{ id: 'time', type: 'inside', start: 0, end: 100 }, { id: 'teams', type: 'inside', start: 0, end: 100 }, { id: 'time-slider', type: 'slider', start: 0, end: 100 }] })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(560)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: removeListener }))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notifyResize = callback } observe() {} disconnect = disconnect })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render() { wrapper = mount(FlowPreviewCanvas, { props: { option: { series: [] }, label: '真实流向', motion: true, replay: 0 } }); return wrapper }
it('renders on first initialization before ECharts has an option or zoom state', () => {
  chart.getOption.mockReturnValue(undefined)
  render()
  expect(chart.setOption).toHaveBeenCalledOnce()
  expect(wrapper!.emitted('zoom')?.at(-1)).toEqual([100])
})
it('keeps the ECharts instance for updates, does not interrupt drawing on unchanged resize, and disposes on exit', async () => {
  const page = render()
  notifyResize(); expect(chart.resize).not.toHaveBeenCalled()
  await page.setProps({ replay: 1 }); expect(chart.clear).toHaveBeenCalledOnce()
  width = 900; notifyResize(); expect(chart.resize).toHaveBeenCalledOnce()
  page.unmount(); wrapper = undefined
  expect(chart.dispose).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce(); expect(removeListener).toHaveBeenCalledOnce()
})
it('disables animation for reduced-motion preferences and when switched off', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: removeListener }))
  const page = render()
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ animation: false }), expect.anything())
  await page.setProps({ motion: false })
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ animation: false, series: [] }), expect.anything())
  expect(chart.clear).not.toHaveBeenCalled()
  expect(stopAnimation).toHaveBeenCalledWith(undefined, true)
})
it('retains edge/node discrimination when selecting a Sankey flow', () => {
  const page = render()
  chart.on.mock.calls[0]![1]({ dataIndex: 2, dataType: 'edge', data: { title: '电镀 → 检验' } })
  expect(page.emitted('select')?.[0]).toEqual([{ dataIndex: 2, dataType: 'edge', data: { title: '电镀 → 检验' } }])
})
it('supports SVG rendering, keyboard zoom and a double-click reset without launching new instances', async () => {
  wrapper = mount(FlowPreviewCanvas, { props: { option: {}, label: '时间画布', replay: 0, motion: true, renderer: 'svg' } })
  expect(initialize).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({ renderer: 'svg' }))
  await wrapper.trigger('keydown', { key: '+' })
  expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'dataZoom', batch: [{ dataZoomIndex: 0, start: 12.5, end: 87.5 }, { dataZoomIndex: 1, start: 12.5, end: 87.5 }] })
  await wrapper.trigger('dblclick')
  expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'dataZoom', batch: [{ dataZoomIndex: 0, start: 0, end: 100 }, { dataZoomIndex: 1, start: 0, end: 100 }] })
  expect(initialize).toHaveBeenCalledOnce()
})
it('reports the actual zoom level and preserves range width when zooming out near an edge', async () => {
  chart.getOption.mockReturnValue({ dataZoom: [{ id: 'time', type: 'inside', start: 0, end: 20 }] })
  const page = render()
  expect(page.emitted('zoom')?.at(-1)).toEqual([500])
  await page.trigger('keydown', { key: '-' })
  expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'dataZoom', batch: [{ dataZoomIndex: 0, start: 0, end: 26.6 }] })
})
it('honors a long history’s finer time limit instead of capping dense event inspection', async () => {
  chart.getOption.mockReturnValue({ dataZoom: [{ id: 'time', type: 'inside', start: 0, end: .02, minSpan: .001 }] })
  const page = render()
  expect(page.emitted('zoom')?.at(-1)).toEqual([500000])
  await page.trigger('keydown', { key: '+' })
  expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'dataZoom', batch: [{ dataZoomIndex: 0, start: .0025000000000000005, end: .0175 }] })
})
it('keeps the base series when responsive media options only adjust axes and controls', () => {
  wrapper = mount(FlowPreviewCanvas, { props: { option: { series: [{ type: 'custom', data: [[1, 2]] }], media: [{ query: { maxWidth: 620 }, option: { grid: { bottom: 150 } } }] }, label: '时间画布', replay: 0, motion: true, renderer: 'svg' } })
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ series: [{ type: 'custom', data: [[1, 2]] }] }), {})
})
it('does not select batches in pan mode and returns to selection without replacing the chart', async () => {
  const page = render()
  const click = chart.on.mock.calls.find(call => call[0] === 'click')![1]
  await page.setProps({ interaction: 'pan' })
  click({ dataIndex: 1, data: { id: 'B1' } })
  expect(page.emitted('select')).toBeUndefined()
  await page.trigger('pointerdown'); expect(page.classes()).toContain('dragging')
  await page.trigger('pointerleave'); expect(page.classes()).not.toContain('dragging')
  await page.setProps({ interaction: 'select' })
  click({ dataIndex: 1, data: { id: 'B1' } })
  expect(page.emitted('select')).toHaveLength(1)
  expect(initialize).toHaveBeenCalledOnce()
})
it('replays within the current viewport and does not clear on data, visibility or motion updates', async () => {
  chart.getOption.mockReturnValue({ dataZoom: [{ id: 'time', start: 25, end: 75 }, { id: 'teams', start: 20, end: 80 }] })
  const page = render()
  const option = { dataZoom: [{ id: 'time', type: 'inside' }, { id: 'teams', type: 'inside' }], series: [{ id: 'batch-paths', type: 'custom', data: [] }] }
  await page.setProps({ option })
  document.dispatchEvent(new Event('visibilitychange'))
  expect(chart.clear).not.toHaveBeenCalled()
  await page.setProps({ replay: 1 })
  expect(chart.clear).toHaveBeenCalledOnce()
  expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ dataZoom: [{ id: 'time', type: 'inside', start: 25, end: 75 }, { id: 'teams', type: 'inside', start: 20, end: 80 }] }), expect.anything())
})

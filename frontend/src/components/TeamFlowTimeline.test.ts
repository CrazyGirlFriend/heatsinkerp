// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import TeamFlowTimeline from './TeamFlowTimeline.vue'
import FlowPreviewCanvas from './FlowPreviewCanvas.vue'
import snapshot from '@/fixtures/flowPurposeSnapshot.json'
import type { SerialHistory } from '@/types/teamBusiness'

let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); Reflect.deleteProperty(document, 'fullscreenElement'); Reflect.deleteProperty(document, 'exitFullscreen'); document.body.innerHTML = '' })
it('expands the history container including its search, filters and export controls', async () => {
  const parent = document.createElement('section')
  parent.className = 'serial-history'
  parent.scrollTop = 700
  document.body.append(parent)
  let fullscreen: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreen, configurable: true })
  const enter = vi.fn(async () => { fullscreen = parent; document.dispatchEvent(new Event('fullscreenchange')) })
  parent.requestFullscreen = enter
  const exit = vi.fn(async () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')) })
  Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true })
  wrapper = mount(TeamFlowTimeline, { attachTo: parent, props: { history: snapshot.history as SerialHistory }, global: { stubs: { FlowPreviewCanvas: true } } })
  await wrapper.get('[aria-label="全屏画布"]').trigger('click'); await flushPromises()
  expect(enter).toHaveBeenCalledOnce()
  expect(parent.scrollTop).toBe(0)
  expect(wrapper.find('[aria-label="退出全屏"]').exists()).toBe(true)
  await wrapper.get('[aria-label="退出全屏"]').trigger('click'); await flushPromises()
  expect(exit).toHaveBeenCalledOnce()
})
it('supports pointer/pan, replay, motion and opening the selected source or outbound batch', async () => {
  wrapper = mount(TeamFlowTimeline, { props: { history: snapshot.history as SerialHistory }, global: { stubs: { FlowPreviewCanvas: true } } })
  const chart = wrapper.getComponent(FlowPreviewCanvas)
  expect(chart.props('renderer')).toBe('svg')
  await wrapper.get('[aria-label="平移画布"]').trigger('click')
  expect(chart.props('interaction')).toBe('pan')
  await wrapper.trigger('keydown', { key: 'v' })
  expect(chart.props('interaction')).toBe('select')
  await wrapper.get('[aria-label="重播收发路径"]').trigger('click')
  expect(chart.props('replay')).toBe(1)
  await wrapper.get('[aria-label="关闭动画"]').trigger('click')
  expect(chart.props('motion')).toBe(false)
  expect(wrapper.get('[aria-label="重播收发路径"]').attributes('disabled')).toBeDefined()
  chart.vm.$emit('select', { dataIndex: 0 }); await flushPromises()
  expect(wrapper.emitted('select')?.[0]?.[0]).toBeTruthy()
})
it('keeps the live canvas mounted and handles a period without events', async () => {
  wrapper = mount(TeamFlowTimeline, { props: { history: snapshot.history as SerialHistory }, global: { stubs: { FlowPreviewCanvas: true } } })
  const canvas = wrapper.getComponent(FlowPreviewCanvas).element
  await wrapper.setProps({ history: structuredClone(snapshot.history) })
  expect(wrapper.getComponent(FlowPreviewCanvas).element).toBe(canvas)
  await wrapper.setProps({ history: { ...snapshot.history, lots: [] } })
  expect(wrapper.text()).toContain('所选日期内没有已登记的收发或库存')
})

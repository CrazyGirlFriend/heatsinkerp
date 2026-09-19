// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import TeamFlowTimeline from './TeamFlowTimeline.vue'
import FlowPreviewCanvas from './FlowPreviewCanvas.vue'
import snapshot from '@/fixtures/flowPurposeSnapshot.json'
import type { SerialHistory } from '@/types/teamBusiness'

let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
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
  expect(wrapper.text()).toContain('所选日期内没有已入账的收发或结存')
})

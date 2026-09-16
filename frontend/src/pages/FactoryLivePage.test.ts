// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryLivePage from './FactoryLivePage.vue'
import LiveTeamCard from '@/components/LiveTeamCard.vue'
import FactoryRobot from '@/components/FactoryRobot.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventorySubscription } from '@/services/inventoryStream'
import { factoryFixture } from '@/testFixtures/factoryOverview'
import type { FactoryLive, LiveBatch } from '@/types/factoryLive'

function fixture(): FactoryLive {
  return { ...factoryFixture(), today: { outgoing_quantity: 180, received_batches: 3 }, teams: factoryFixture().teams.map(t => ({ ...t, incoming: 2, outgoing: 1 })), links: [],
    recent_batches: Array.from({ length: 20 }, (_, i) => ({ batch_no: 'CK-DEMO-' + i, entry_kind: 'transfer', source_id: 1, target_id: 8, source_name: '库房', target_name: '检验', external_destination: null, status: i === 1 ? 'partial' : 'pending', quantity: 20 + i, weight: 2, line_count: 2, serial_count: 2, material_count: 1, material_name: '6061铝', waiting_since: '2026-09-12T01:00:00Z', updated_at: '2026-09-12T01:00:00Z' })) }
}
let wrapper: VueWrapper
let subscription: InventorySubscription<FactoryLive>, stops: ReturnType<typeof vi.fn>[]
function push(value: FactoryLive) { subscription.onState('live'); subscription.onData(value) }
let viewport = { width: 1672, height: 940 }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-12T01:10:00Z'))
  viewport = { width: 1672, height: 940 }
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewport.width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewport.height)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(factoryLiveApi, 'get').mockResolvedValue(fixture())
  stops = []
  vi.spyOn(factoryLiveApi, 'subscribe').mockImplementation(callbacks => {
    subscription = callbacks
    const stop = vi.fn(); stops.push(stop)
    callbacks.onState('connecting')
    void Promise.resolve().then(() => { if (!stop.mock.calls.length) { callbacks.onState('live'); callbacks.onData(fixture()) } })
    return stop
  })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/factory-live', '/team-workspaces/:teamId', '/transfer-batches/scan'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push('/factory-live')
  wrapper = mount(FactoryLivePage, { global: { plugins: [router], stubs: { FactoryRobot: true } } })
  await flushPromises()
  return router
}
async function click(label: string) {
  await wrapper.findAll('button').find(b => b.text().trim() === label || b.attributes('aria-label') === label)!.trigger('click')
  await flushPromises()
}
const tableRows = () => wrapper.getComponent({ name: 'ElTable' }).props('data') as LiveBatch[]
function assertLinked(code: string) {
  expect(tableRows()[0]!.batch_no).toBe(code)
  expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toContain(code + ':')
  expect(wrapper.get('.current-flow__code').text()).toContain(code)
  expect(wrapper.get('.broadcast-window').text()).toContain(tableRows()[0]!.quantity + '件')
}
describe('first-row-driven material dashboard', () => {
  it('retains 2K density and all eight groups on narrow screens, with no flow-line canvas', async () => {
    await render()
    viewport = { width: 2560, height: 1440 }; window.dispatchEvent(new Event('resize')); await flushPromises()
    expect(wrapper.getComponent(FactoryRobot).props('displayScale')).toBeCloseTo(2560 / 1672)
    expect(wrapper.find('.live-connections').exists()).toBe(false)
    viewport = { width: 390, height: 844 }; window.dispatchEvent(new Event('resize')); await flushPromises()
    expect(wrapper.classes()).toContain('factory-live--narrow')
    expect(wrapper.findAllComponents(LiveTeamCard)).toHaveLength(8)
    viewport = { width: 2560, height: 1440 }; window.dispatchEvent(new Event('resize')); await flushPromises()
    expect(wrapper.classes()).not.toContain('factory-live--narrow')
  })
  it('shows eight different machines and eight real rows from a larger feed', async () => {
    await render()
    expect(wrapper.get('.live-metrics').text()).toContain('当前在库')
    expect(wrapper.get('.transit-hint').text()).toContain('在途 1 kg')
    expect(wrapper.findAllComponents(LiveTeamCard)[0]!.props('team').balance?.on_hand_weight).toBe(2.8)
    expect(wrapper.findAllComponents(LiveTeamCard)).toHaveLength(8)
    const images = wrapper.findAll('.live-team__machine').map(n => n.attributes('src'))
    expect(new Set(images).size).toBe(8)
    expect(images[4]).toContain('wire-cut'); expect(images[5]).toContain('engraving')
    expect(tableRows()).toHaveLength(8)
    expect(wrapper.get('.live-footer').text()).toContain('最近20条')
    assertLinked('CK-DEMO-0')
  })
  it('refreshes physical inventory and transit together without changing the batch identity', async () => {
    await render()
    const accepted = fixture()
    accepted.totals.on_hand_weight = 3.8
    accepted.totals.in_transit_weight = 0
    accepted.recent_batches[0]!.status = 'received'
    vi.mocked(factoryLiveApi.get).mockResolvedValueOnce(accepted)
    await click('刷新物料状态')
    expect(wrapper.get('.transit-hint').text()).toContain('在途 0 kg')
    expect(wrapper.get('.current-flow').text()).toContain('已接收')
    assertLinked('CK-DEMO-0')
  })
  it('moves row one every eight seconds and keeps the robot and broadcast synchronized', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(24000)
    assertLinked('CK-DEMO-3')
    await click('上一条转料')
    assertLinked('CK-DEMO-2')
    await vi.advanceTimersByTimeAsync(12000)
    assertLinked('CK-DEMO-2')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
  })
  it('freezes on hover, keyboard reading, hidden pages and refresh failures; disposes subscriptions', async () => {
    await render()
    await wrapper.get('.live-feed').trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(10000)
    assertLinked('CK-DEMO-0')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
    await wrapper.get('.live-feed').trigger('focusin')
    await wrapper.get('.live-feed').trigger('mouseleave')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
    await wrapper.get('.live-feed').trigger('focusout', { relatedTarget: null })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30000)
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
    expect(stops[0]).toHaveBeenCalledOnce()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    vi.mocked(factoryLiveApi.get).mockRejectedValueOnce(new Error('offline'))
    await click('刷新物料状态')
    expect(wrapper.text()).toContain('保留上次成功数据')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
    wrapper.unmount(); await vi.advanceTimersByTimeAsync(60000)
    expect(factoryLiveApi.get).toHaveBeenCalledOnce()
    expect(factoryLiveApi.subscribe).toHaveBeenCalledTimes(2)
    expect(stops[1]).toHaveBeenCalledOnce()
  })
  it('defers incoming records while paused, then triggers the new first row on resume', async () => {
    await render()
    await click('暂停轮播')
    const updated = fixture()
    updated.recent_batches.unshift({ ...updated.recent_batches[0]!, batch_no: 'CK-NEW', quantity: 88 })
    updated.totals.on_hand_weight = 456
    push(updated); await flushPromises()
    assertLinked('CK-DEMO-0')
    expect(wrapper.get('.live-metrics').text()).toContain('456')
    expect(wrapper.get('.live-footer').text()).toContain('播报待恢复')
    await click('播放轮播')
    assertLinked('CK-NEW')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(false)
  })
  it('does not retrigger unchanged refreshes, but propagates changed status to the first-row action', async () => {
    await render()
    const key = wrapper.getComponent(FactoryRobot).props('activityKey')
    await click('刷新物料状态')
    expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toBe(key)
    const updated = fixture(); updated.recent_batches[0]!.status = 'received'; updated.recent_batches[0]!.waiting_since = null
    vi.mocked(factoryLiveApi.get).mockResolvedValue(updated)
    await click('刷新物料状态')
    expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toContain(':received:')
    expect(wrapper.get('.current-flow').text()).toContain('已接收')
  })
  it('pauses reduced-motion mode and never fabricates a batch in an empty feed', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    await render()
    await vi.advanceTimersByTimeAsync(16000)
    assertLinked('CK-DEMO-0')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
    const empty = fixture(); empty.recent_batches = []
    vi.mocked(factoryLiveApi.get).mockResolvedValue(empty); await click('刷新物料状态')
    expect(tableRows()).toHaveLength(0)
    expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toBe('')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
  })
  it('opens actual ledgers and batch details without changing the first-row selection', async () => {
    const router = await render()
    await click('查看线切割库存明细')
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/5?tab=stock')
    await wrapper.get('.current-flow__code').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches/scan?batch_no=CK-DEMO-0')
    wrapper.getComponent({ name: 'ElTable' }).vm.$emit('row-click', tableRows()[1]); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches/scan?batch_no=CK-DEMO-1')
    await click('返回系统总览')
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('shows a retryable initial error instead of invented zero inventory', async () => {
    vi.mocked(factoryLiveApi.subscribe).mockImplementation(callbacks => { subscription = callbacks; callbacks.onState('reconnecting'); return vi.fn() })
    await render()
    expect(wrapper.text()).toContain('物料状态加载失败')
    expect(wrapper.findAllComponents(LiveTeamCard)).toHaveLength(0)
  })
  it('updates from pushed snapshots without polling and rejects callbacks after unmount', async () => {
    await render()
    const updated = fixture(); updated.recent_batches.unshift({ ...updated.recent_batches[0]!, batch_no: 'CK-PUSH' })
    push(updated); await flushPromises()
    assertLinked('CK-PUSH')
    const current = subscription
    subscription.onState('reconnecting'); await flushPromises()
    expect(wrapper.text()).toContain('连接中断')
    expect(tableRows()[0]!.batch_no).toBe('CK-PUSH')
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
    wrapper.unmount()
    current.onData(fixture()); current.onState('live')
    expect(stops[0]).toHaveBeenCalledOnce()
  })
  it('does not let an older manual request overwrite a later pushed snapshot', async () => {
    await render()
    let finish!: (value: FactoryLive) => void
    vi.mocked(factoryLiveApi.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await click('刷新物料状态')
    const updated = fixture(); updated.recent_batches[0]!.status = 'received'
    push(updated); await flushPromises()
    finish(fixture()); await flushPromises()
    expect(wrapper.get('.current-flow').text()).toContain('已接收')
    assertLinked('CK-DEMO-0')
  })
  it('recognizes entry-triggered fullscreen and exits it when returning to the system', async () => {
    let fullscreenElement: Element | null = document.documentElement
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    const exitFullscreen = vi.fn(async () => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')) })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    try {
      const router = await render()
      expect(wrapper.classes()).toContain('factory-live--fullscreen')
      expect(wrapper.find('button[aria-label="退出全屏"]').exists()).toBe(true)
      await click('返回系统总览')
      expect(exitFullscreen).toHaveBeenCalledOnce()
      expect(router.currentRoute.value.path).toBe('/')
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement')
      Reflect.deleteProperty(document, 'exitFullscreen')
    }
  })
})

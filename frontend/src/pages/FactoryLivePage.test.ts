// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryLivePage from './FactoryLivePage.vue'
import LiveTeamCard from '@/components/LiveTeamCard.vue'
import FactoryRobot from '@/components/FactoryRobot.vue'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventorySubscription } from '@/services/inventoryStream'
import { factoryFixture } from '@/testFixtures/factoryOverview'
import type { FactoryLive } from '@/types/factoryLive'

function fixture(): FactoryLive {
  const base = factoryFixture()
  return { ...base, today: { outgoing_quantity: 180, received_batches: 3 }, links: [], recent_batches: [],
    material_stock: ['铜钼 CuMo70', '钨铜 WCu80', '无氧铜 TU1', '紫铜 T2', '钼片 Mo1', '铝合金 6061', '铜钼 CuMo50'].map((key, i) => ({key,quantity:10+i,weight:1+i/10})),
    teams: base.teams.map((team, i) => ({ ...team, incoming: 4, outgoing: 1,
      pending_transfers: Array.from({ length: 5 }, (_, j) => ({
        batch_no: 'CK-' + i + '-' + j, serial_no: 'SERIAL-' + i + '-' + j,
        source_id: (i + 7) % 8 + 1, target_id: team.id!, source_name: base.teams[(i + 7) % 8]!.name,
        quantity: 20 + j, weight: 2 + j / 10, updated_at: '2026-09-12T01:00:00Z',
      })),
    })),
  }
}
let wrapper: VueWrapper
let subscription: InventorySubscription<FactoryLive>, stops: ReturnType<typeof vi.fn>[]
function push(value: FactoryLive) { subscription.onState('live'); subscription.onData(value) }
let viewport = { width: 1672, height: 940 }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-12T01:10:00Z'))
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 20)))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => window.clearTimeout(id)))
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
function assertLinked(team: number, row: number) {
  const code = 'CK-' + team + '-' + row
  expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toContain(code + ':SERIAL-')
  expect(wrapper.findAllComponents(LiveTeamCard)[team]!.findAll('.live-team__row')[0]!.attributes('data-batch')).toBe(code)
}
function scrollOffset() { return Number.parseFloat((wrapper.element as HTMLElement).style.getPropertyValue('--transfer-offset') || '0') }
describe('symmetric pending-transfer dashboard', () => {
  it('shows both quantity and weight for full material grades, factory stock and transit', async () => {
    await render()
    const summary = wrapper.get('.live-metrics')
    expect(summary.text()).toContain('全厂在库')
    expect(summary.findAll('.material-name').map(n => n.text())).toEqual(['铜钼 CuMo70', '钨铜 WCu80', '无氧铜 TU1'])
    expect(wrapper.findAllComponents(AnimatedMetric).slice(0, 8).map(n => n.props('value'))).toEqual([fixture().totals.on_hand_quantity, fixture().totals.on_hand_weight, 10, 1, 11, 1.1, 12, 1.2])
    expect(wrapper.get('.transit-hint').text()).toBe(`· 在途 ${fixture().totals.in_transit_quantity} 件 / ${fixture().totals.in_transit_weight} kg`)
    expect(wrapper.findAll('.metric-quantity')).toHaveLength(4)
    expect(wrapper.findAll('.metric-weight')).toHaveLength(4)
    expect(wrapper.findAll('.metric-quantity').every(n => n.text().endsWith('件'))).toBe(true)
    expect(wrapper.findAll('.metric-weight').every(n => n.text().endsWith('kg'))).toBe(true)
    expect(summary.text()).not.toMatch(/半成品|今日转出|待交接|今日已接收/)
  })
  it('cycles all materials in groups of three and allows manual paging while paused', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(1999)
    expect(wrapper.findAll('.material-name')[0]!.text()).toBe('铜钼 CuMo70')
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.findAll('.material-name').map(n => n.text())).toEqual(['紫铜 T2', '钼片 Mo1', '铝合金 6061'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.findAll('.material-name').map(n => n.text())).toEqual(['铜钼 CuMo50'])
    await click('暂停轮播')
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.findAll('.material-name').map(n => n.text())).toEqual(['铜钼 CuMo50'])
    await click('下一组材质')
    expect(wrapper.findAll('.material-name')[0]!.text()).toBe('铜钼 CuMo70')
    await click('上一组材质')
    expect(wrapper.findAll('.material-name')[0]!.text()).toBe('铜钼 CuMo50')
  })
  it('pushes weights without resetting the material page and clamps pages after stocks disappear', async () => {
    await render()
    await click('下一组材质')
    const update = fixture(); update.material_stock[3]!.weight = 123.456; update.material_stock[3]!.quantity = 9876
    push(update); await flushPromises()
    expect(wrapper.findAll('.material-name')[0]!.text()).toBe('紫铜 T2')
    expect(wrapper.get('.live-material .metric-weight').getComponent(AnimatedMetric).props('value')).toBe(123.456)
    expect(wrapper.get('.live-material .metric-quantity').getComponent(AnimatedMetric).props('value')).toBe(9876)
    push({ ...update, material_stock: update.material_stock.slice(0, 2) }); await flushPromises()
    expect(wrapper.findAll('.material-name')).toHaveLength(2)
    expect(wrapper.find('.material-pager').exists()).toBe(false)
    push({ ...update, material_stock: [] }); await flushPromises()
    expect(wrapper.text()).toContain('暂无在库材质')
  })
  it('cycles material weights even when there are no pending transfers', async () => {
    await render()
    const value = fixture(); value.teams.forEach(team => { team.pending_transfers = [] })
    push(value); await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.findAll('.material-name')[0]!.text()).toBe('紫铜 T2')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
  })
  it('keeps quantity and precise weight together in every team transfer, including zero quantities', async () => {
    await render()
    wrapper.findAllComponents(LiveTeamCard).forEach(card => {
      const rows = card.props('rows')
      card.findAll('.live-team__amount').forEach((cell, index) => {
        expect(cell.text()).toBe(`${rows[index]!.quantity} 件 / ${rows[index]!.weight} kg`)
      })
    })
    const update = fixture()
    update.teams[0]!.pending_transfers[0]!.quantity = 0
    update.teams[0]!.pending_transfers[0]!.weight = 0.125
    update.totals.on_hand_quantity = 0
    update.totals.on_hand_weight = 0
    update.material_stock[0] = { key: '铜钼 CuMo70', quantity: 0, weight: 0.125 }
    push(update); await flushPromises()
    expect(wrapper.findAllComponents(LiveTeamCard)[0]!.get('.live-team__amount').text()).toBe('0 件 / 0.125 kg')
    expect(wrapper.get('.live-stock-total .metric-quantity').getComponent(AnimatedMetric).props('value')).toBe(0)
    expect(wrapper.get('.live-stock-total .metric-weight').getComponent(AnimatedMetric).props('value')).toBe(0)
    expect(wrapper.get('.live-material .metric-quantity').getComponent(AnimatedMetric).props('value')).toBe(0)
    expect(wrapper.get('.live-material .metric-weight').getComponent(AnimatedMetric).props('value')).toBe(0.125)
  })
  it('shows eight machines and three-row windows with one entering buffer row per team', async () => {
    await render()
    expect(wrapper.findAllComponents(LiveTeamCard)).toHaveLength(8)
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(24)
    expect(wrapper.findAll('.live-team__row')).toHaveLength(32)
    expect(wrapper.findAll('.live-team__track.is-scrolling')).toHaveLength(8)
    const images = wrapper.findAll('.live-team__machine').map(n => n.attributes('src'))
    expect(new Set(images).size).toBe(8)
    expect(images[4]).toContain('wire-cut'); expect(images[5]).toContain('engraving')
    expect(wrapper.findAll('.is-right')).toHaveLength(4)
    expect(wrapper.find('.transfer-dock, .live-feed, .live-broadcast, .live-footer, .live-connections').exists()).toBe(false)
    const first = wrapper.findAllComponents(LiveTeamCard)[0]!
    expect(first.get('.live-team__columns').text()).toContain('来源班组')
    expect(first.findAll('.live-team__source')[0]!.text()).toBe('检验')
    expect(first.text()).not.toContain('当前结存')
    expect(wrapper.get('.flow-layout').text()).not.toMatch(/[→←]/)
    expect(wrapper.get('.live-connection').text()).toBe('实时同步')
    assertLinked(0, 0)
  })
  it('keeps equal eight-team composition at 2K and all teams on narrow viewports', async () => {
    await render()
    viewport = { width: 2560, height: 1440 }; window.dispatchEvent(new Event('resize')); await flushPromises()
    expect(wrapper.getComponent(FactoryRobot).props('displayScale')).toBeCloseTo(2560 / 1672)
    viewport = { width: 390, height: 844 }; window.dispatchEvent(new Event('resize')); await flushPromises()
    expect(wrapper.classes()).toContain('factory-live--narrow')
    expect(wrapper.findAllComponents(LiveTeamCard)).toHaveLength(8)
  })
  it('moves continuously at 32 pixels per three seconds and wraps each list without a gap', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(500)
    expect(scrollOffset()).toBeCloseTo(-32 / 6)
    await vi.advanceTimersByTimeAsync(500)
    expect(scrollOffset()).toBeCloseTo(-32 / 3)
    await vi.advanceTimersByTimeAsync(1999)
    assertLinked(0, 0)
    await vi.advanceTimersByTimeAsync(1)
    assertLinked(1, 1)
    expect(wrapper.findAllComponents(LiveTeamCard)[0]!.findAll('.live-team__row')[0]!.attributes('data-batch')).toBe('CK-0-1')
    expect(scrollOffset()).toBeCloseTo(0)
    await vi.advanceTimersByTimeAsync(6000)
    assertLinked(3, 3)
    await click('暂停轮播')
    await vi.advanceTimersByTimeAsync(12000)
    assertLinked(3, 3)
    // Pausing text rotation leaves the current robot's handoff animation running.
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(false)
    await click('播放轮播')
    await vi.advanceTimersByTimeAsync(3000)
    assertLinked(4, 4)
    await vi.advanceTimersByTimeAsync(3000)
    assertLinked(5, 0)
    expect(wrapper.findAllComponents(LiveTeamCard)[0]!.findAll('.live-team__row').map(row => row.attributes('data-batch'))).toEqual(['CK-0-0', 'CK-0-1', 'CK-0-2', 'CK-0-3'])
  })
  it('pauses mid-row and resumes from the same pixel instead of snapping back', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(1000)
    const offset = scrollOffset()
    await click('暂停轮播')
    await vi.advanceTimersByTimeAsync(5000)
    expect(scrollOffset()).toBe(offset)
    assertLinked(0, 0)
    await click('播放轮播')
    expect(scrollOffset()).toBe(offset)
    await vi.advanceTimersByTimeAsync(1000)
    expect(scrollOffset()).toBeCloseTo(-64 / 3)
    await vi.advanceTimersByTimeAsync(1000)
    assertLinked(1, 1)
  })
  it('selects a team on heading click without pausing rotation or live updates', async () => {
    const router = await render()
    await click('展示轧制转料')
    expect(router.currentRoute.value.path).toBe('/factory-live')
    assertLinked(1, 0)
    expect(wrapper.text()).toContain('暂停轮播')
    await vi.advanceTimersByTimeAsync(3000)
    assertLinked(2, 1)
    const updated = fixture()
    updated.teams[2]!.pending_transfers.shift()
    push(updated); await flushPromises()
    assertLinked(2, 1)
    await click('暂停轮播')
    await click('展示轧制转料')
    await vi.advanceTimersByTimeAsync(4000)
    assertLinked(1, 1)
    expect(wrapper.text()).toContain('播放轮播')
  })
  it('removes confirmed rows on pushes even while hovered, without stopping live totals', async () => {
    await render()
    await wrapper.get('.team-rail').trigger('mouseenter')
    const updated = fixture()
    updated.teams[0]!.pending_transfers.shift()
    updated.totals.on_hand_weight = 456
    push(updated); await flushPromises()
    assertLinked(0, 1)
    expect(wrapper.get('.live-stock-total .metric-weight').getComponent(AnimatedMetric).props('value')).toBe(456)
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(false)
    await wrapper.get('.team-rail').trigger('focusin')
    await vi.advanceTimersByTimeAsync(3000)
    assertLinked(1, 1)
    expect(wrapper.findAllComponents(LiveTeamCard)[0]!.findAll('.live-team__row')[0]!.attributes('data-batch')).toBe('CK-0-2')
    await wrapper.get('.team-rail').trigger('mouseleave')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(false)
  })
  it('does not retrigger unchanged pushes or reset a rolling window on refresh', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(3500)
    const key = wrapper.getComponent(FactoryRobot).props('activityKey')
    const offset = scrollOffset()
    push(fixture()); await flushPromises()
    expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toBe(key)
    expect(scrollOffset()).toBe(offset)
    await click('刷新物料状态')
    expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toBe(key)
    expect(scrollOffset()).toBe(offset)
  })
  it('freezes for hidden pages and refresh errors', async () => {
    await render()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30000)
    assertLinked(0, 0)
    expect(stops[0]).toHaveBeenCalledOnce()
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    vi.mocked(factoryLiveApi.get).mockRejectedValueOnce(new Error('offline'))
    await click('刷新物料状态')
    expect(wrapper.text()).toContain('保留上次成功数据')
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
  })
  it('honestly renders empty or missing teams and does not invent transfer rows', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    await render()
    await vi.advanceTimersByTimeAsync(16000)
    assertLinked(0, 0)
    expect(wrapper.getComponent(FactoryRobot).props('paused')).toBe(true)
    const empty = fixture(); empty.teams.forEach(team => { team.pending_transfers = [] })
    empty.teams[0]!.id = null
    push(empty); await flushPromises()
    expect(wrapper.findAll('.live-team__row')).toHaveLength(0)
    expect(wrapper.text()).toContain('班组未配置')
    expect(wrapper.text()).toContain('暂无待接收转料')
    expect(wrapper.getComponent(FactoryRobot).props('activityKey')).toBe('')
  })
  it('keeps one to three rows static without duplicating them to fill a scrolling track', async () => {
    await render()
    const value = fixture()
    value.teams[0]!.pending_transfers = value.teams[0]!.pending_transfers.slice(0, 1)
    value.teams[1]!.pending_transfers = value.teams[1]!.pending_transfers.slice(0, 2)
    value.teams[2]!.pending_transfers = value.teams[2]!.pending_transfers.slice(0, 3)
    push(value); await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.findAllComponents(LiveTeamCard)[0]!.findAll('.live-team__row')).toHaveLength(1)
    expect(wrapper.findAllComponents(LiveTeamCard)[1]!.findAll('.live-team__row')).toHaveLength(2)
    expect(wrapper.findAllComponents(LiveTeamCard)[2]!.findAll('.live-team__row')).toHaveLength(3)
    for (const card of wrapper.findAllComponents(LiveTeamCard).slice(0, 3)) expect(card.find('.is-scrolling').exists()).toBe(false)
    assertLinked(1, 0)
  })
  it('opens the actual CK detail from a serial row', async () => {
    const router = await render()
    await wrapper.findAll('.live-team__serial')[0]!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches/scan?batch_no=CK-0-0')
    await click('返回系统总览')
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('shows an initial stream error without fabricated rows', async () => {
    vi.mocked(factoryLiveApi.subscribe).mockImplementation(callbacks => { subscription = callbacks; callbacks.onState('reconnecting'); return vi.fn() })
    await render()
    expect(wrapper.text()).toContain('物料状态加载失败')
    expect(wrapper.findAllComponents(LiveTeamCard)).toHaveLength(0)
  })
  it('uses SSE without polling and disposes subscriptions on exit', async () => {
    await render()
    const current = subscription
    subscription.onState('reconnecting'); await flushPromises()
    expect(wrapper.text()).toContain('连接中断')
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
    wrapper.unmount()
    current.onData(fixture()); current.onState('live')
    expect(stops[0]).toHaveBeenCalledOnce()
  })
  it('cancels the animation frame loop on exit', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(1000)
    wrapper.unmount()
    const frames = vi.mocked(requestAnimationFrame).mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(frames)
  })
  it('rejects stale manual reads arriving after a newer pushed receipt', async () => {
    await render()
    let finish!: (value: FactoryLive) => void
    vi.mocked(factoryLiveApi.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await click('刷新物料状态')
    const updated = fixture(); updated.teams[0]!.pending_transfers.shift()
    push(updated); await flushPromises()
    finish(fixture()); await flushPromises()
    assertLinked(0, 1)
  })
  it('exits entry-triggered fullscreen when returning to the system', async () => {
    let fullscreenElement: Element | null = document.documentElement
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    const exitFullscreen = vi.fn(async () => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')) })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    try {
      const router = await render()
      expect(wrapper.classes()).toContain('factory-live--fullscreen')
      await click('返回系统总览')
      expect(exitFullscreen).toHaveBeenCalledOnce()
      expect(router.currentRoute.value.path).toBe('/')
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement'); Reflect.deleteProperty(document, 'exitFullscreen')
    }
  })
})

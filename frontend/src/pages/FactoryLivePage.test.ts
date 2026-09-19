// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryLivePage from './FactoryLivePage.vue'
import FactoryGlassScene from '@/components/FactoryGlassScene.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventorySubscription } from '@/services/inventoryStream'
import type { FactoryLive } from '@/types/factoryLive'
import { liveFixture } from '@/testFixtures/factoryLive'

let wrapper: VueWrapper
let subscription: InventorySubscription<FactoryLive>, stops: ReturnType<typeof vi.fn>[]
function push(value: FactoryLive) { subscription.onState('live'); subscription.onData(value) }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-12T01:10:00Z'))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.spyOn(factoryLiveApi, 'get').mockResolvedValue(liveFixture())
  stops = []
  vi.spyOn(factoryLiveApi, 'subscribe').mockImplementation(callbacks => {
    subscription = callbacks
    const stop = vi.fn(); stops.push(stop)
    callbacks.onState('connecting')
    void Promise.resolve().then(() => { if (!stop.mock.calls.length) push(liveFixture()) })
    return stop
  })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/factory-live', '/transfer-batches', '/transfer-batches/scan'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push('/factory-live')
  wrapper = mount(FactoryLivePage, { global: { plugins: [router], stubs: { FactoryGlassScene: true, FactoryStockRing: true } } })
  await flushPromises()
  return router
}
async function click(label: string) {
  const button = wrapper.findAll('button').find(node => node.text().trim() === label || node.attributes('aria-label') === label)
  expect(button, label).toBeTruthy()
  await button!.trigger('click'); await flushPromises()
}

describe('glass dashboard connected to factory live snapshots', () => {
  it('displays actual typed balances and all actual routes with no demo receipt actions', async () => {
    await render()
    expect(wrapper.get('[data-testid="total-quantity"]').text()).toBe('800')
    expect(wrapper.get('[data-testid="total-weight"]').text()).toBe('80.0')
    expect(wrapper.get('[data-testid="pending-count"]').text()).toBe('5')
    expect(wrapper.get('[data-testid="pending-links"]').text()).toBe('4')
    expect(wrapper.getComponent(FactoryGlassScene).props('links')).toHaveLength(4)
    expect(wrapper.findAll('.team-stock-row')).toHaveLength(8)
    expect(wrapper.text()).not.toMatch(/演示|接收 1 批|全部接收$/)
    expect(wrapper.get('.global-type-list').text()).toContain('半成品750 件 / 74.875 kg')
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
  })
  it('rotates eight teams and manual focus pauses rotation without pausing live updates', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(8000)
    expect(wrapper.getComponent(FactoryGlassScene).props('focus')).toBe('FACTORY-ROLL')
    await click('切换到线切割')
    await vi.advanceTimersByTimeAsync(16000)
    expect(wrapper.getComponent(FactoryGlassScene).props('focus')).toBe('FACTORY-WIRE')
    expect(wrapper.get('.team-types').text()).toContain('废泥0 / 0.125')
    const update = liveFixture(); update.internal_pending.batches = 9
    push(update); await flushPromises()
    expect(wrapper.get('[data-testid="pending-count"]').text()).toBe('9')
    expect(wrapper.getComponent(FactoryGlassScene).props('focus')).toBe('FACTORY-WIRE')
  })
  it('keeps a partially received link active, stops only completed links and updates stock from the pushed snapshot', async () => {
    await render()
    const update = liveFixture()
    update.links[0] = { ...update.links[0]!, pending_batches: 1, confirmed_batches: 1, pending_quantity: 10, pending_weight: 1 }
    update.internal_pending = { batches: 4, quantity: 35, weight: 3.5 }
    update.totals.on_hand_quantity = 810; update.totals.on_hand_weight = 81
    update.teams[1]!.balance!.on_hand_quantity = 110; update.teams[1]!.balance!.on_hand_weight = 11
    update.teams[1]!.material_types[0]!.quantity = 110; update.teams[1]!.material_types[0]!.weight = 11
    update.material_types[1]!.quantity = 760; update.material_types[1]!.weight = 75.875
    push(update); await flushPromises()
    expect(wrapper.get('.route-status').text()).toContain('待接收 1 批')
    expect(wrapper.get('[data-testid="pending-links"]').text()).toBe('4')
    expect(wrapper.get('[data-testid="total-quantity"]').text()).toBe('810')
    const complete = structuredClone(update)
    complete.links[0] = { ...complete.links[0]!, pending_batches: 0, confirmed_batches: 2, pending_quantity: 0, pending_weight: 0 }
    push(complete); await flushPromises()
    expect(wrapper.get('.route-status').text()).toBe('全部接收完成 · 光点已停止')
    expect(wrapper.get('[data-testid="pending-links"]').text()).toBe('3')
    expect(wrapper.getComponent(FactoryGlassScene).props('links')).toHaveLength(4)
  })
  it('navigates to filtered real transfers and the real batch details', async () => {
    const router = await render()
    await click('查看待接收')
    expect(router.currentRoute.value.path).toBe('/transfer-batches')
    expect(router.currentRoute.value.query).toMatchObject({ source_team_id: '1', next_team_id: '2', status: 'pending' })
    await wrapper.get('.recent-item').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/transfer-batches/scan')
    expect(router.currentRoute.value.query.batch_no).toBe('TL-REAL-BATCH')
  })
  it('shows all other categories and supports closing the dialog with Escape', async () => {
    await render()
    await click('其余 6 类 ›')
    expect(wrapper.get('[role="dialog"]').text()).toContain('废泥0 件0.125 kg')
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
  it('preserves genuine zero stock, missing teams and an empty network without fabricated routes', async () => {
    await render()
    const empty = liveFixture()
    empty.links = []; empty.recent_batches = []; empty.material_types = []; empty.internal_pending = { batches: 0, quantity: 0, weight: 0 }
    empty.totals.on_hand_quantity = 0; empty.totals.on_hand_weight = 0
    empty.teams.forEach(team => { team.material_types = []; team.balance!.on_hand_quantity = 0; team.balance!.on_hand_weight = 0 })
    empty.teams[0]!.id = null; empty.teams[0]!.balance = null
    push(empty); await flushPromises()
    expect(wrapper.get('[data-testid="total-quantity"]').text()).toBe('0')
    expect(wrapper.getComponent(FactoryGlassScene).props('links')).toEqual([])
    expect(wrapper.get('.team-stock-row').text()).toContain('未配置')
    expect(wrapper.text()).toContain('暂无在库物料')
    expect(wrapper.text()).toContain('暂无批次记录')
    expect(wrapper.find('.route-detail-button').exists()).toBe(false)
  })
  it('freezes motion on disconnect, retains and labels last successful data, and resumes on a fresh push', async () => {
    await render()
    subscription.onState('reconnecting'); await flushPromises()
    expect(wrapper.get('[data-testid="total-quantity"]').text()).toBe('800')
    expect(wrapper.get('.live-notices').text()).toContain('显示上次成功数据')
    expect(wrapper.getComponent(FactoryGlassScene).props('motion')).toBe(false)
    push(liveFixture()); await flushPromises()
    expect(wrapper.getComponent(FactoryGlassScene).props('motion')).toBe(true)
    expect(wrapper.find('.live-notices').exists()).toBe(false)
  })
  it('does not let a late manual GET overwrite a newer SSE snapshot', async () => {
    await render()
    let finish!: (value: FactoryLive) => void
    vi.mocked(factoryLiveApi.get).mockReturnValue(new Promise(resolve => { finish = resolve }))
    await click('刷新物料状态')
    const newer = liveFixture(); newer.as_of = '2026-09-12T01:12:00Z'; newer.internal_pending.batches = 1
    push(newer); await flushPromises()
    finish(liveFixture()); await flushPromises()
    expect(wrapper.get('[data-testid="pending-count"]').text()).toBe('1')
  })
  it('closes subscriptions on hidden pages and unmount, without polling or continued timers', async () => {
    await render()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(stops[0]).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(factoryLiveApi.subscribe).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    expect(stops[1]).toHaveBeenCalledOnce()
  })
  it('honors reduced motion and reports unreconciled data without hiding it', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    await render()
    expect(wrapper.getComponent(FactoryGlassScene).props('motion')).toBe(false)
    await vi.advanceTimersByTimeAsync(10000)
    expect(wrapper.getComponent(FactoryGlassScene).props('focus')).toBe('FACTORY-WAREHOUSE')
    const update = liveFixture(); update.material_types[0]!.weight += .001
    push(update); await flushPromises()
    expect(wrapper.get('.live-notices').text()).toContain('分类库存与汇总不一致')
  })
  it('rejects missing classification fields rather than falling back to synthetic data', async () => {
    vi.mocked(factoryLiveApi.subscribe).mockImplementation(callbacks => {
      callbacks.onData({ ...liveFixture(), material_types: undefined } as unknown as FactoryLive)
      return vi.fn()
    })
    await render()
    expect(wrapper.text()).toContain('接口尚未提供分类库存')
    expect(wrapper.find('.global-stock').exists()).toBe(false)
  })
  it('exits fullscreen before returning to the application', async () => {
    const router = await render()
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(wrapper.element)
    const exit = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    document.dispatchEvent(new Event('fullscreenchange'))
    await click('返回系统总览')
    expect(exit).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/')
  })
})

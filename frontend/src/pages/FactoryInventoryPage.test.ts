// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryInventoryPage from './FactoryInventoryPage.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryFixture } from '@/testFixtures/factoryOverview'
import type { InventorySubscription } from '@/services/inventoryStream'

let wrapper: VueWrapper
let subscription: InventorySubscription, stop: ReturnType<typeof vi.fn>, initial = true
function fixture() {
  const data = factoryFixture()
  data.teams = data.teams.map((team, index) => ({ ...team, id: 800 + index, serial_count: 12,
    urgent_serial_count: index === 0 ? 2 : 0, pending_incoming: { batches: index === 0 ? 3 : 0, quantity: index === 0 ? 15 : 0, weight: index === 0 ? .125 : 0 } }))
  data.teams[0]!.balance!.on_hand_quantity = 120
  data.teams[0]!.balance!.on_hand_weight = .375
  return data
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  initial = true; stop = vi.fn()
  vi.spyOn(factoryOverviewApi, 'get')
  vi.spyOn(factoryOverviewApi, 'subscribe').mockImplementation(callbacks => {
    subscription = callbacks
    callbacks.onState('connecting')
    if (initial) { callbacks.onState('live'); callbacks.onData(fixture()) }
    return stop
  })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/team-workspaces/:teamId', component: { template: '<div />' } },
    { path: '/factory-analysis', component: { template: '<div />' } },
  ] })
  await router.push('/')
  wrapper = mount(FactoryInventoryPage, { global: { plugins: [router], stubs: { InventoryAmbient: true } } })
  await flushPromises()
  return router
}
async function click(label: string) {
  await wrapper.findAll('button').find(button => button.text().trim() === label || button.attributes('aria-label') === label)!.trigger('click')
  await flushPromises()
}
describe('factory inventory homepage', () => {
  it('renders the eight distinct selected equipment illustrations, not generic team glyphs', async () => {
    await render()
    const sources = wrapper.findAll('img.team-symbol').map(image => image.attributes('src'))
    expect(sources).toHaveLength(8)
    expect(new Set(sources).size).toBe(8)
    expect(wrapper.get('[data-team-code="FACTORY-WIRE"] img').attributes('src')).toContain('/wire-v2.png')
    expect(wrapper.get('[data-team-code="FACTORY-ENGRAVE"] img').attributes('src')).toContain('/engraving-v2.png')
    expect(wrapper.get('.summary-icon').attributes('src')).toContain('/stock-v2.png')
  })
  it('uses real report values for all eight teams, including fractional weights and pending receipts', async () => {
    await render()
    expect(wrapper.findAll('.inventory-card')).toHaveLength(8)
    expect(wrapper.findAll('.summary-group')).toHaveLength(2)
    const warehouse = wrapper.get('[data-team-code="FACTORY-WAREHOUSE"]')
    expect(warehouse.get('.stock-quantity').text()).toContain('120')
    expect(warehouse.get('.stock-weight').text()).toContain('0.375')
    expect(warehouse.get('.inventory-card-pending').text()).toContain('3 批')
    expect(warehouse.get('.pending-amount').text()).toContain('0.125')
    expect(warehouse.text()).toContain('12 个在库流水号')
    expect(warehouse.text()).toContain('加急 2')
    expect(wrapper.text()).toContain('当前库存不含在途物料')
  })
  it('drills into real team ids and the right tabs; retains access to the original analysis page', async () => {
    const router = await render()
    await wrapper.get('[aria-label="查看库房库存明细"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/800?tab=serials')
    await wrapper.get('[aria-label="查看库房待接收"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/800?tab=pending')
    expect(wrapper.get('a[href="/factory-analysis"]').text()).toContain('数据分析')
  })
  it('keeps missing or disabled teams readable but not actionable, with unavailable counts shown as dashes', async () => {
    const data = fixture()
    data.teams[0] = { ...data.teams[0]!, id: null, balance: null, serial_count: null, urgent_serial_count: null, pending_incoming: null }
    data.teams[1]!.active = false
    await render()
    subscription.onData(data); await flushPromises()
    expect(wrapper.text()).toContain('未配置：库房')
    expect(wrapper.get('[data-team-code="FACTORY-WAREHOUSE"] .stock-quantity').text()).toContain('—')
    expect(wrapper.find('[aria-label="查看库房库存明细"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="查看轧制库存明细"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已停用')
  })
  it('retains labelled stale data on disconnect, reconnects on visibility and cleans up on unmount', async () => {
    await render()
    subscription.onState('reconnecting'); await flushPromises()
    expect(wrapper.text()).toContain('当前显示上次成功读取的数据')
    expect(wrapper.findAll('.inventory-card')).toHaveLength(8)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(stop).toHaveBeenCalledOnce()
    expect(factoryOverviewApi.subscribe).toHaveBeenCalledOnce()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange')); await flushPromises()
    expect(factoryOverviewApi.subscribe).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('当前显示上次成功读取的数据')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(10000)
    expect(factoryOverviewApi.subscribe).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(2)
    expect(factoryOverviewApi.get).not.toHaveBeenCalled()
  })
  it('pauses all homepage motion without pausing refresh, and highlights only genuinely changed teams', async () => {
    await render()
    const next = fixture(); next.teams[0]!.serial_count = 13
    subscription.onData(next); await flushPromises()
    expect(wrapper.findAll('.inventory-card--changed')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1400)
    expect(wrapper.findAll('.inventory-card--changed')).toHaveLength(0)
    await click('暂停动效')
    expect(wrapper.classes()).toContain('factory-inventory--still')
    next.teams[0]!.serial_count = 14
    subscription.onData(structuredClone(next)); await flushPromises()
    expect(wrapper.get('[data-team-code="FACTORY-WAREHOUSE"]').text()).toContain('14 个在库流水号')
    expect(factoryOverviewApi.get).not.toHaveBeenCalled()
    expect(wrapper.findAll('.inventory-card--changed')).toHaveLength(0)
  })
  it('honors reduced motion and offers retry instead of a fake zero-stock report on first failure', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    initial = false
    await render()
    subscription.onState('reconnecting'); await flushPromises()
    expect(wrapper.text()).toContain('库存数据连接失败')
    expect(wrapper.find('.inventory-summary').exists()).toBe(false)
    initial = true; await click('刷新')
    expect(wrapper.findAll('.inventory-card')).toHaveLength(8)
    expect(wrapper.classes()).toContain('factory-inventory--still')
    expect(wrapper.get('[aria-label="系统已减少动画"]').attributes('disabled')).toBeDefined()
  })
  it('never polls and keeps unchanged cards still when a fresh snapshot has identical amounts', async () => {
    await render()
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryOverviewApi.get).not.toHaveBeenCalled()
    expect(factoryOverviewApi.subscribe).toHaveBeenCalledOnce()
    const next = fixture(); next.as_of = '2026-09-14T07:45:20Z'
    subscription.onData(next); await flushPromises()
    expect(wrapper.findAll('.inventory-card--changed')).toHaveLength(0)
    expect(wrapper.get('time').text()).toContain('15:45:20')
    expect(wrapper.text()).toContain('实时同步')
    expect(wrapper.text()).not.toContain('10 秒自动更新')
  })
  it('animates actual pushed stock, pending and serial counts immediately without a refresh request', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.push(callback); return frames.length }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    await render()
    const next = fixture()
    next.teams[0]!.balance!.on_hand_quantity = 110
    next.teams[0]!.balance!.on_hand_weight = .35
    next.teams[0]!.serial_count = 13
    next.teams[0]!.pending_incoming = { batches: 4, quantity: 20, weight: .15 }
    subscription.onData(next); await flushPromises()
    expect(factoryOverviewApi.get).not.toHaveBeenCalled()
    expect(wrapper.findAll('.inventory-card--changed')).toHaveLength(1)
    const warehouse = wrapper.get('[data-team-code="FACTORY-WAREHOUSE"]')
    expect(warehouse.get('.stock-quantity > strong > span').attributes('aria-label')).toBe('110')
    frames.splice(0).forEach(frame => frame(1800)); await wrapper.vm.$nextTick()
    expect(warehouse.get('.stock-quantity').text()).toContain('110')
    expect(warehouse.get('.stock-weight').text()).toContain('0.35')
    expect(warehouse.get('.inventory-card-pending').text()).toContain('4 批')
    expect(warehouse.get('.inventory-card-footer').text()).toContain('13 个在库流水号')
  })
  it('ignores late snapshots from replaced or unmounted connections', async () => {
    await render()
    const previous = subscription
    await click('刷新')
    expect(stop).toHaveBeenCalledOnce()
    const next = fixture(); next.teams[0]!.serial_count = 999
    previous.onData(next); previous.onState('reconnecting'); await flushPromises()
    expect(wrapper.text()).not.toContain('999 个在库流水号')
    expect(wrapper.text()).not.toContain('连接中断')
    wrapper.unmount()
    subscription.onData(next)
    expect(stop).toHaveBeenCalledTimes(2)
  })
})

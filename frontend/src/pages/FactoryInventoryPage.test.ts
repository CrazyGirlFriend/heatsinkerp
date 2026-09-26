// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryInventoryPage from './FactoryInventoryPage.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import { liveFixture } from '@/testFixtures/factoryLive'
import type { FactoryLive } from '@/types/factoryLive'
import type { InventorySubscription } from '@/services/inventoryStream'

let wrapper: VueWrapper
let subscription: InventorySubscription<FactoryLive>,
  stop: ReturnType<typeof vi.fn>,
  initial = true
function fixture() {
  const data = liveFixture()
  data.teams[0]!.urgent_serial_count = 2
  data.teams[0]!.pending_incoming = { batches: 3, quantity: 15, weight: 0.125 }
  return data
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  initial = true
  stop = vi.fn()
  vi.spyOn(factoryLiveApi, 'get')
  vi.spyOn(factoryLiveApi, 'subscribe').mockImplementation((callbacks) => {
    subscription = callbacks
    callbacks.onState('connecting')
    if (initial) {
      callbacks.onState('live')
      callbacks.onData(fixture())
    }
    return stop
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      ...[
        '/team-workspaces/:teamId',
        '/factory-stock',
        '/factory-analysis',
        '/factory-live',
        '/transfer-batches',
        '/transfer-batches/scan',
      ].map((path) => ({ path, component: { template: '<div />' } })),
    ],
  })
  await router.push('/')
  wrapper = mount(FactoryInventoryPage, {
    global: {
      plugins: [router],
      stubs: {
        LedgerChart: true,
        ElDialog: {
          props: ['modelValue', 'title'],
          template:
            '<div v-if="modelValue" role="dialog"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
  await flushPromises()
  return router
}
async function click(label: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text().trim() === label || button.attributes('aria-label') === label)!
    .trigger('click')
  await flushPromises()
}
describe('factory inventory homepage', () => {
  it('uses one live snapshot for eight teams, internal-only pending and daily receipts', async () => {
    await render()
    expect(wrapper.findAll('.team-stock-row')).toHaveLength(8)
    expect(wrapper.findAll('.home-metric')).toHaveLength(4)
    expect(wrapper.get('.home-metrics').text()).toContain('800')
    expect(wrapper.get('.home-metrics').text()).toContain('5 批')
    expect(wrapper.get('.attention-list').text()).toContain('0.125 kg')
    expect(wrapper.get('.attention-list').text()).toContain('3 批')
    expect(wrapper.text()).toContain('在库含废料，不含已转出待确认物料')
    expect(wrapper.text()).not.toContain('未核平')
  })
  it('drills into real team ids, pending and urgent filters without manufacturing a global urgency total', async () => {
    const router = await render()
    await wrapper.get('[aria-label="查看库房库存明细"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/1?tab=stock')
    await wrapper.get('[aria-label="查看库房待接收"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/1?tab=pending')
    await click('在库加急')
    await wrapper.get('[aria-label="查看库房加急物料"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/1?tab=stock&urgent_only=true')
    expect(wrapper.get('a[href="/factory-analysis"]').text()).toContain('数据分析')
  })
  it('shows all categories including zero-piece positive-weight waste and each team classification', async () => {
    await render()
    await click('全部类型')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('800 件 / 80.0 kg')
    expect(dialog.text()).toContain('废泥00.125')
    await click('关闭')
    await click('查看线切割物料分类')
    expect(wrapper.get('[role="dialog"]').text()).toContain('线切割 · 在库物料分类')
    expect(wrapper.get('[role="dialog"]').text()).toContain('100 件 / 10.0 kg')
  })
  it('keeps missing or disabled teams readable but not actionable and surfaces discrepancies', async () => {
    await render()
    const data = fixture()
    data.teams[0] = { ...data.teams[0]!, id: null, balance: null, pending_incoming: null }
    data.teams[1]!.active = false
    subscription.onData(data)
    await flushPromises()
    expect(wrapper.text()).toContain('未配置：库房')
    expect(wrapper.text()).toContain('未核平')
    expect(wrapper.get('[data-team-code="FACTORY-WAREHOUSE"] .stock-quantity').text()).toBe('—')
    expect(wrapper.find('[aria-label="查看库房库存明细"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="查看轧制库存明细"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="查看库房物料分类"]').attributes('disabled')).toBeDefined()
  })
  it('filters pending rows without summing capped feeds or mixing external operations', async () => {
    const router = await render()
    const data = fixture(),
      row = data.recent_batches[0]!
    data.recent_batches = [
      { ...row, batch_no: 'EXTERNAL', entry_kind: 'warehouse_outbound', target_id: null },
      { ...row, batch_no: 'CONFIRMED', status: 'received' },
      { ...row, batch_no: 'PARTIAL-LONG-BATCH-20260924-000000001', status: 'partial' },
    ]
    subscription.onData(data)
    await flushPromises()
    expect(wrapper.get('.pending-table').text()).not.toMatch(/EXTERNAL|CONFIRMED/)
    expect(wrapper.get('.pending-table').text()).toContain('部分接收')
    expect(wrapper.text()).toContain('部分接收显示整批件数与重量')
    await wrapper
      .get('[aria-label="查看批次 PARTIAL-LONG-BATCH-20260924-000000001"]')
      .trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.batch_no).toBe('PARTIAL-LONG-BATCH-20260924-000000001')
    data.recent_batches = []
    subscription.onData(structuredClone(data))
    await flushPromises()
    expect(wrapper.text()).toContain('近期记录中没有待接收批次')
    expect(wrapper.text()).not.toContain('暂无班组间待接收物料')
  })
  it('handles zero stock without fake chart data and retains classifications', async () => {
    await render()
    const data = fixture()
    data.totals.on_hand_quantity = data.totals.on_hand_weight = 0
    data.material_types = []
    data.recent_batches = []
    data.internal_pending = { quantity: 0, weight: 0, batches: 0 }
    data.teams.forEach((team) => {
      team.balance!.on_hand_quantity = team.balance!.on_hand_weight = 0
      team.material_types = []
      team.pending_incoming = { quantity: 0, weight: 0, batches: 0 }
      team.urgent_serial_count = 0
    })
    subscription.onData(data)
    await flushPromises()
    expect(wrapper.text()).toContain('暂无班组间待接收物料')
    expect(wrapper.get('ledger-chart-stub').attributes('empty')).toBe('true')
    expect(wrapper.text()).not.toContain('未核平')
    await click('全部类型')
    expect(wrapper.get('[role="dialog"]').text()).toContain('0 件 / 0.0 kg')
  })
  it('retains labelled stale data, reconnects on visibility and disposes its subscription', async () => {
    await render()
    subscription.onState('reconnecting')
    await flushPromises()
    expect(wrapper.text()).toContain('当前显示上次成功读取的数据')
    expect(wrapper.get('ledger-chart-stub').attributes('motion')).toBe('false')
    expect(wrapper.findAll('.team-stock-row')).toHaveLength(8)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stop).toHaveBeenCalledOnce()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(factoryLiveApi.subscribe).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('当前显示上次成功读取的数据')
    wrapper.unmount()
    expect(stop).toHaveBeenCalledTimes(2)
  })
  it('honors reduced motion and retries initial failures without displaying fake zeros', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    initial = false
    await render()
    subscription.onState('reconnecting')
    await flushPromises()
    expect(wrapper.text()).toContain('库存数据连接失败')
    expect(wrapper.find('.home-metrics').exists()).toBe(false)
    initial = true
    await click('刷新库存')
    expect(wrapper.findAll('.team-stock-row')).toHaveLength(8)
    expect(wrapper.get('ledger-chart-stub').attributes('motion')).toBe('false')
  })
  it('applies real pushed values immediately without polling or accepting superseded connections', async () => {
    await render()
    const previous = subscription
    await click('刷新库存')
    const next = fixture()
    next.totals.on_hand_quantity = 999
    next.today.received_batches = 18
    previous.onData(next)
    previous.onState('reconnecting')
    await flushPromises()
    expect(wrapper.get('.home-metrics').text()).not.toContain('999')
    subscription.onData(next)
    await flushPromises()
    expect(wrapper.get('.home-metrics').text()).toContain('999')
    expect(wrapper.get('.home-metrics').text()).toContain('18 批')
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryLiveApi.get).not.toHaveBeenCalled()
    expect(factoryLiveApi.subscribe).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    subscription.onData(fixture())
    expect(stop).toHaveBeenCalledTimes(2)
  })
})

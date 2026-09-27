// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryInventoryPage from './FactoryInventoryPage.vue'
import { factoryDashboardApi } from '@/services/factoryDashboardApi'
import * as streams from '@/services/inventoryStream'
import type { FactoryDashboard } from '@/types/factoryDashboard'
import SerialMaterialDrawer from '@/components/SerialMaterialDrawer.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { serialFixture } from '@/testFixtures/materialAnalytics'

vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: () => ({ message: ref(''), request: vi.fn() }) }
})

let wrapper: VueWrapper
let subscription: streams.InventorySubscription<streams.InventoryChange>
const stop = vi.fn()
function fixture(): FactoryDashboard {
  return {
    as_of: '2026-09-26T04:00:00Z',
    today: '2026-09-26',
    stock: {
      materials: [{ name: '铜钼', quantity: 100, weight: 10 }],
      rows: [
        {
          team_id: 1,
          team_code: 'FACTORY-WAREHOUSE',
          team_name: '库房',
          active: true,
          amounts: { 铜钼: { quantity: 100, weight: 10 } },
          total: { quantity: 100, weight: 10 },
        },
      ],
      total: { quantity: 100, weight: 10 },
    },
    yields: [
      {
        material: '铜钼',
        input_weight: 100,
        output_weight: 90,
        rate: 90,
        completed_count: 1,
        active_count: 0,
      },
    ],
    delivery: {
      on_time_rate: null,
      due_count: 0,
      overdue_count: 0,
      upcoming_count: 0,
      items: [],
      total: 0,
    },
    shipping: {
      dates: ['2026-09-26'],
      series: [{ serial_no: 'REAL-01', created_at: '2026-09-20', values: [20] }],
    },
    serial_count: 1,
    attention: [
      {
        serial_no: 'REAL-01',
        materials: ['铜钼'],
        teams: ['库房'],
        reasons: ['加急'],
        age_days: 1,
        overdue_days: 0,
        remaining: null,
      },
    ],
    legacy_count: 0,
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(factoryDashboardApi, 'get').mockResolvedValue(fixture())
  vi.spyOn(factoryDashboardApi, 'stockDetail').mockResolvedValue({
    items: [
      {
        team_id: 1,
        team_name: '库房',
        serial_no: 'REAL-01',
        material: '铜钼',
        material_type: 'raw_material',
        quantity: 100,
        weight: 10,
      },
    ],
    total: 1,
    page: 1,
    page_size: 30,
  })
  vi.spyOn(streams, 'subscribeInventoryChanges').mockImplementation((callbacks) => {
    subscription = callbacks
    return stop
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
  stop.mockClear()
})
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/material-trace', component: { template: '<div/>' } },
    ],
  })
  await router.push('/')
  wrapper = mount(FactoryInventoryPage, {
    global: {
      plugins: [router],
      directives: { loading: {} },
      stubs: {
        FactoryShipmentChart: true,
        FactoryShippingAnalysis: true,
        FactoryDeliveryPlans: true,
        MaterialTransferDrawer: true,
        ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot/></div>' },
        ElDrawer: {
          props: ['modelValue'],
          template:
            '<section v-if="modelValue"><slot name="header"/><slot/><slot name="footer"/></section>',
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
    .find((b) => b.text().trim() === label || b.attributes('aria-label') === label)!
    .trigger('click')
  await flushPromises()
}
describe('live factory dashboard', () => {
  it('renders the five agreed modules from one API snapshot and switches stock units', async () => {
    await render()
    expect(wrapper.findAll('.dashboard>.panel')).toHaveLength(5)
    expect(wrapper.find('.stock-table tbody').text()).toContain('10')
    await click('件数')
    expect(wrapper.find('.stock-table tbody').text()).toContain('100')
    expect(wrapper.text()).not.toContain('示例')
    expect(wrapper.text()).not.toContain('班组每日收发')
    expect(wrapper.find('.deadline-summary').text()).toContain('—')
  })
  it('opens the all-serial analysis with the newest API selection and no material selector', async () => {
    await render()
    await click('展开分析')
    expect(
      wrapper.findComponent({ name: 'FactoryShippingAnalysis' }).props('initialSelection'),
    ).toEqual(fixture().shipping.series)
  })
  it('opens scoped serial inventory from cells, team totals, material totals and the factory total', async () => {
    await render()
    for (const [label, material, team] of [
      ['库房 铜钼 库存明细', '铜钼', 1],
      ['库房全部材质库存明细', '', 1],
      ['全厂铜钼库存明细', '铜钼', undefined],
      ['全厂全部库存明细', '', undefined],
    ] as const) {
      await click(label)
      expect(factoryDashboardApi.stockDetail).toHaveBeenLastCalledWith(material, team, 1)
      expect(wrapper.find('button[aria-label="查看库房 REAL-01流水号详情"]').exists()).toBe(true)
    }
  })
  it('drills through the selected team serial and source batch to its original document', async () => {
    const summary = serialFixture('REAL-01')
    const transfer = normalizeMaterialTransfer({
      id: 101,
      batch_no: 'TL-SOURCE-101',
      serial_no: 'REAL-01',
      status: 'received',
      next_team_id: 1,
    })
    vi.spyOn(teamMaterialApi, 'serials').mockResolvedValue({
      items: [summary],
      total: 1,
      page: 1,
      page_size: 1,
    })
    vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
      items: [{ ...summary, transfer }],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render()
    await click('库房 铜钼 库存明细')
    await click('查看库房 REAL-01流水号详情')
    const drawer = wrapper.getComponent(SerialMaterialDrawer)
    expect(drawer.props()).toMatchObject({ teamId: 1, serialNo: 'REAL-01', canWrite: false })
    expect(teamMaterialApi.stock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ serial_no: 'REAL-01', availability: 'all' }),
    )
    expect(drawer.find('.serial-stock-actions').exists()).toBe(false)
    await click('TL-SOURCE-101')
    expect(drawer.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      transfer,
      traceScope: { team_id: 1, direction: 'all' },
    })
    drawer.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.findComponent(SerialMaterialDrawer).exists()).toBe(false)
    expect(wrapper.find('button[aria-label="查看库房 REAL-01流水号详情"]').exists()).toBe(true)
  })
  it('does not show a previous scope when a new stock detail query fails', async () => {
    await render()
    await click('库房 铜钼 库存明细')
    vi.mocked(factoryDashboardApi.stockDetail).mockRejectedValueOnce(new Error('offline'))
    await click('全厂全部库存明细')
    expect(wrapper.text()).toContain('库存明细读取失败')
    expect(wrapper.find('button[aria-label="查看库房 REAL-01流水号详情"]').exists()).toBe(false)
    await click('重试')
    expect(factoryDashboardApi.stockDetail).toHaveBeenLastCalledWith('', undefined, 1)
    expect(wrapper.find('button[aria-label="查看库房 REAL-01流水号详情"]').exists()).toBe(true)
  })
  it('filters attention by serial and links to the existing trace', async () => {
    await render()
    expect(wrapper.find('.attention a').attributes('href')).toBe(
      '/material-trace?serial_no=REAL-01',
    )
    await click('超期')
    expect(wrapper.find('.attention').text()).not.toContain('REAL-01')
    await click('加急')
    expect(wrapper.find('.attention').text()).toContain('REAL-01')
  })
  it('shows failed reads instead of mock zeros and retries', async () => {
    vi.mocked(factoryDashboardApi.get).mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(wrapper.text()).toContain('全厂总览读取失败')
    expect(wrapper.find('.dashboard').exists()).toBe(false)
    await click('重新加载')
    expect(wrapper.find('.dashboard').exists()).toBe(true)
  })
  it('retains a labeled previous snapshot when refresh fails', async () => {
    await render()
    vi.mocked(factoryDashboardApi.get).mockRejectedValueOnce(new Error('offline'))
    await click('刷新总览')
    expect(wrapper.text()).toContain('上次成功读取')
    expect(wrapper.find('.stock-table').text()).toContain('铜钼')
  })
  it('refreshes on committed changes and releases the stream and timer', async () => {
    await render()
    subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(260)
    expect(factoryDashboardApi.get).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    expect(stop).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60001)
    expect(factoryDashboardApi.get).toHaveBeenCalledTimes(2)
  })
})

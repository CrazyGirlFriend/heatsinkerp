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
describe('live team material stock page', () => {
  it('renders only the full-page stock matrix and switches stock units', async () => {
    await render()
    expect(wrapper.get('h1').text()).toBe('班组材质库存')
    expect(wrapper.findAll('.stock-panel')).toHaveLength(1)
    expect(wrapper.find('.stock-table tbody').text()).toContain('10')
    await wrapper.get('input[value="quantity"]').setValue(true)
    expect(wrapper.find('.stock-table tbody').text()).toContain('100')
    expect(wrapper.get('.stock-table').attributes('aria-label')).toBe('班组材质库存（件）')
    expect(wrapper.text()).not.toContain('示例')
    for (const title of ['成品率', '交期与超时', '发货速率', '重点关注流水号'])
      expect(wrapper.text()).not.toContain(title)
    expect(wrapper.find('.dashboard, .shipping-chart, .attention').exists()).toBe(false)
    expect(factoryDashboardApi.get).toHaveBeenCalledTimes(1)
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
  it('shows failed reads instead of mock zeros and retries', async () => {
    vi.mocked(factoryDashboardApi.get).mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(wrapper.text()).toContain('班组材质库存读取失败')
    expect(wrapper.find('.stock-table').exists()).toBe(false)
    await click('重新加载')
    expect(wrapper.find('.stock-table').exists()).toBe(true)
  })
  it('retains a labeled previous snapshot when refresh fails', async () => {
    await render()
    vi.mocked(factoryDashboardApi.get).mockRejectedValueOnce(new Error('offline'))
    await click('刷新库存')
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
  it('renders dynamic materials, exact totals, missing teams and three-decimal weights', async () => {
    const data = fixture()
    data.stock.materials.push({ name: '钨铜 WCu80', quantity: 0, weight: 1.234 })
    data.stock.rows[0]!.amounts['钨铜 WCu80'] = { quantity: 0, weight: 1.234 }
    data.stock.rows[0]!.total = { quantity: 100, weight: 11.234 }
    data.stock.rows.push({
      team_id: null,
      team_name: '研磨',
      team_code: 'FACTORY-GRIND',
      active: false,
      amounts: {},
      total: null,
    })
    data.stock.total = { quantity: 100, weight: 11.234 }
    data.legacy_count = 2
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    await render()
    expect(wrapper.findAll('.stock-table thead th').map((th) => th.text())).toEqual([
      '班组',
      '铜钼',
      '钨铜 WCu80',
      '合计',
    ])
    expect(wrapper.findAll('.stock-table tbody tr')[0]!.text()).toContain('1.234')
    expect(wrapper.findAll('.stock-table tfoot td').map((td) => td.text())).toEqual([
      '10',
      '1.234',
      '11.234',
    ])
    expect(
      wrapper
        .findAll('.stock-table tbody tr')[1]!
        .findAll('td')
        .map((td) => td.text()),
    ).toEqual(['—', '—', '—'])
    expect(
      wrapper
        .findAll('.stock-table tbody tr')[1]!
        .findAll('button')
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    expect(wrapper.text()).toContain('未配置班组：研磨')
    expect(wrapper.text()).toContain('2 条历史接收未纳入库存')
  })
  it('keeps the full panel and configured teams when there is no material stock', async () => {
    const data = fixture()
    data.stock.materials = []
    data.stock.rows[0]!.amounts = {}
    data.stock.rows[0]!.total = { quantity: 0, weight: 0 }
    data.stock.total = { quantity: 0, weight: 0 }
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    await render()
    expect(wrapper.find('.stock-panel').exists()).toBe(true)
    expect(wrapper.get('.stock-empty').text()).toBe('暂无材质库存')
    expect(wrapper.get('.stock-table tbody th').text()).toBe('库房')
    expect(wrapper.get('.stock-count').text()).toContain('1 个班组 · 0 种材质')
    expect(wrapper.get('.stock-updated').attributes('datetime')).toBe(data.as_of)
    expect(wrapper.find('.stock-footer').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('点击库存数字查看明细')
    expect(wrapper.get('.stock-wrap').attributes('style')).toContain('--stock-material-count: 1')
    expect(wrapper.findAll('colgroup col')).toHaveLength(2)
  })
  it('sizes the matrix from live axes without hiding columns or changing numeric precision', async () => {
    const data = fixture()
    data.stock.materials = Array.from({ length: 14 }, (_, index) => ({
      name: `材质-${index}`,
      quantity: 12345678,
      weight: 1234567.891,
    }))
    data.stock.rows = Array.from({ length: 9 }, (_, index) => ({
      ...data.stock.rows[0]!,
      team_id: index + 1,
      team_code: `TEAM-${index}`,
      team_name: `班组-${index}`,
      amounts: Object.fromEntries(
        data.stock.materials.map((material) => [material.name, material]),
      ),
    }))
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    await render()
    expect(wrapper.get('.stock-wrap').attributes('style')).toContain('--stock-material-count: 14')
    expect(wrapper.get('.stock-wrap').attributes('style')).toContain('--stock-row-count: 10')
    expect(wrapper.findAll('colgroup col')).toHaveLength(16)
    expect(wrapper.findAll('tbody tr')).toHaveLength(9)
    expect(wrapper.get('tbody td button').text()).toBe('1,234,567.891')

    data.stock.materials.push({ name: '新增材质', quantity: 0, weight: 0 })
    data.stock.rows.push({ ...data.stock.rows[0]!, team_id: 10, team_code: 'TEAM-9' })
    subscription.onData({ changed: true, directory_changed: true })
    await vi.advanceTimersByTimeAsync(260)
    expect(wrapper.get('.stock-wrap').attributes('style')).toContain('--stock-material-count: 15')
    expect(wrapper.get('.stock-wrap').attributes('style')).toContain('--stock-row-count: 11')
    expect(wrapper.findAll('colgroup col')).toHaveLength(17)
    await wrapper.get('input[value="quantity"]').setValue(true)
    expect(wrapper.get('tbody td button').text()).toBe('12,345,678')
  })
  it('updates live cells and open stock details without resetting the selected unit', async () => {
    await render()
    await wrapper.get('input[value="quantity"]').setValue(true)
    await click('库房 铜钼 库存明细')
    const data = fixture()
    data.stock.rows[0]!.amounts['铜钼'] = { quantity: 80, weight: 8 }
    data.stock.rows[0]!.total = { quantity: 80, weight: 8 }
    data.stock.materials[0]!.quantity = 80
    data.stock.materials[0]!.weight = 8
    data.stock.total = { quantity: 80, weight: 8 }
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    subscription.onData({ changed: true })
    subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(260)
    expect(factoryDashboardApi.get).toHaveBeenCalledTimes(2)
    expect(factoryDashboardApi.stockDetail).toHaveBeenCalledTimes(2)
    expect(factoryDashboardApi.stockDetail).toHaveBeenLastCalledWith('铜钼', 1, 1)
    expect(wrapper.get('.stock-table').attributes('aria-label')).toBe('班组材质库存（件）')
    expect(wrapper.get('.stock-table tbody td').text()).toBe('80')
    expect(wrapper.get('.stock-table tfoot .sum-col').text()).toBe('80')
  })
  it('stops hidden-page refresh and reconnects when visible', async () => {
    await render()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stop).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60001)
    expect(factoryDashboardApi.get).toHaveBeenCalledTimes(1)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(factoryDashboardApi.get).toHaveBeenCalledTimes(2)
    expect(streams.subscribeInventoryChanges).toHaveBeenCalledTimes(2)
  })
  it('adds and renames directory rows and material columns on push, without fixed axes', async () => {
    await render()
    await wrapper.get('input[value="quantity"]').setValue(true)
    const data = fixture()
    data.stock.rows[0]!.team_name = '中心库房'
    data.stock.materials.push({ name: '新增牌号 X', quantity: 0, weight: 0 })
    data.stock.rows.push({
      team_id: 902,
      team_code: 'CUSTOM-902',
      team_name: '新增配置班组',
      active: true,
      amounts: {},
      total: { quantity: 0, weight: 0 },
    })
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    subscription.onData({ changed: true, directory_changed: true })
    await vi.advanceTimersByTimeAsync(260)
    expect(wrapper.findAll('.stock-table tbody th').map((th) => th.text())).toEqual([
      '中心库房',
      '新增配置班组',
    ])
    expect(wrapper.findAll('.stock-table thead th').map((th) => th.text())).toEqual([
      '班组',
      '铜钼',
      '新增牌号 X',
      '合计',
    ])
    expect(wrapper.get('.stock-count').text()).toBe('2 个班组 · 2 种材质')
    expect(wrapper.get('.stock-table').attributes('aria-label')).toBe('班组材质库存（件）')
    await click('新增配置班组 新增牌号 X 库存明细')
    expect(factoryDashboardApi.stockDetail).toHaveBeenLastCalledWith('新增牌号 X', 902, 1)
  })
  it('keeps zeros readable, shows inactive stock and highlights material for mouse and keyboard', async () => {
    const data = fixture()
    data.stock.materials.push({ name: '仅重量材质', quantity: 0, weight: 1 })
    data.stock.rows[0]!.active = false
    data.stock.rows[0]!.amounts['仅重量材质'] = { quantity: 0, weight: 1 }
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    await render()
    const cell = wrapper.findAll('.stock-table tbody td')[1]!
    expect(cell.classes()).not.toContain('is-zero')
    expect(wrapper.get('.stock-retired').text()).toBe('已停用')
    await wrapper.get('input[value="quantity"]').setValue(true)
    expect(cell.classes()).toContain('is-zero')
    expect(cell.text()).toBe('0')
    await cell.get('button').trigger('mouseenter')
    expect(wrapper.findAll('.stock-table thead th')[2]!.classes()).toContain('is-column-active')
    await wrapper.get('.stock-table').trigger('mouseleave')
    expect(cell.classes()).not.toContain('is-column-active')
    await cell.get('button').trigger('focus')
    expect(cell.classes()).toContain('is-column-active')
    await wrapper.get('.stock-table').trigger('mouseleave')
    expect(cell.classes()).toContain('is-column-active')
    await cell.get('button').trigger('blur')
    expect(cell.classes()).not.toContain('is-column-active')
  })
  it('separates material names and codes without changing text or detail lookup keys', async () => {
    const data = fixture()
    const names = ['钨铜 WCu80', '动态材质-00', '铝 6061 T6', '超长未分类纯中文材质', '316L不锈钢']
    data.stock.materials = names.map((name) => ({ name, quantity: 0, weight: 0 }))
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    await render()
    const headings = wrapper.findAll('.stock-table thead th').slice(1, -1)
    expect(headings.map((heading) => heading.text())).toEqual(names)
    expect(headings.map((heading) => heading.attributes('title'))).toEqual(names)
    expect(headings.map((heading) => heading.get('.material-heading').text())).toEqual([
      '钨铜',
      '动态材质',
      '铝',
      '超长未分类纯中文材质',
      '316L不锈钢',
    ])
    expect(headings.slice(0, 3).map((heading) => heading.get('.material-code').text())).toEqual([
      'WCu80',
      '-00',
      '6061 T6',
    ])
    expect(headings[3]!.find('.material-code').exists()).toBe(false)
    await click('库房 钨铜 WCu80 库存明细')
    expect(factoryDashboardApi.stockDetail).toHaveBeenLastCalledWith('钨铜 WCu80', 1, 1)
  })
  it('keeps scope help accessible and distinguishes zero stock from the grand total', async () => {
    await render()
    const scope = wrapper.get('button[aria-label="统计口径"]')
    expect(scope.text()).toBe('')
    expect(scope.attributes('title')).toBe('统计口径')
    expect(wrapper.get('tbody td button').attributes('title')).toBe('查看库房 · 铜钼库存明细')
    expect(wrapper.get('tfoot .grand-total button').text()).toBe('10')
    expect(wrapper.get('tbody td').classes()).not.toContain('is-zero')
    const data = fixture()
    data.stock.rows[0]!.total = { quantity: 0, weight: 0 }
    data.stock.rows[0]!.amounts['铜钼'] = { quantity: 0, weight: 0 }
    vi.mocked(factoryDashboardApi.get).mockResolvedValue(data)
    subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(260)
    expect(wrapper.get('tbody td').text()).toBe('0')
    expect(wrapper.get('tbody td').classes()).toContain('is-zero')
    expect(wrapper.get('tbody .sum-col').classes()).toContain('is-zero')
  })
})

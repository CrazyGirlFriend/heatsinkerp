// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElTable } from 'element-plus'
import FactoryStockMatrixPage from './FactoryStockMatrixPage.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryFixture } from '@/testFixtures/factoryOverview'
import type { InventorySubscription } from '@/services/inventoryStream'

let wrapper: VueWrapper | undefined
let subscription: InventorySubscription
let stopped: ReturnType<typeof vi.fn>
let initial = true
let reduced = false

function fixture() {
  const data = factoryFixture()
  data.stock_matrix.materials = [
    { name: '铜钼 CuMo70', quantity: 120, weight: 10.125 },
    { name: '铜钼 CuMo50', quantity: 0, weight: 0.375 },
  ]
  data.stock_matrix.rows[0]!.amounts = {
    '铜钼 CuMo70': { quantity: 100, weight: 8.125 },
    '铜钼 CuMo50': { quantity: 0, weight: 0.375 },
  }
  data.stock_matrix.rows[0]!.total = { quantity: 100, weight: 8.5 }
  data.stock_matrix.rows[1]!.amounts = { '铜钼 CuMo70': { quantity: 20, weight: 2 } }
  data.stock_matrix.rows[1]!.total = { quantity: 20, weight: 2 }
  data.stock_matrix.total = { quantity: 120, weight: 10.5 }
  return data
}

beforeEach(() => {
  vi.useFakeTimers()
  initial = true
  reduced = false
  stopped = vi.fn()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduced-motion') && reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  vi.spyOn(factoryOverviewApi, 'get')
  vi.spyOn(factoryOverviewApi, 'subscribe').mockImplementation((callbacks) => {
    subscription = callbacks
    callbacks.onState('connecting')
    if (initial) {
      callbacks.onState('live')
      callbacks.onData(fixture())
    }
    return stopped
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function render() {
  wrapper = mount(FactoryStockMatrixPage, {
    global: {
      stubs: {
        AnimatedMetric: {
          props: ['value', 'animate', 'precision'],
          template: '<span>{{ value ?? "—" }}</span>',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}
function cell(team: string, key: string) {
  return wrapper!.get(`[data-cell="${team}:${key}"]`)
}

describe('factory material inventory matrix', () => {
  it('shows eight teams as rows, exact material grades as columns and both totals with pieces and kg', async () => {
    await render()
    expect(wrapper!.getComponent({ name: 'ElTable' }).props('data')).toHaveLength(9)
    expect(wrapper!.findAll('th').map((header) => header.text())).toEqual([
      '班组 / 材质',
      '铜钼 CuMo70',
      '铜钼 CuMo50',
      '班组合计',
    ])
    expect(cell('FACTORY-WAREHOUSE', 'material:铜钼 CuMo70').text()).toContain('100件8.125kg')
    expect(cell('FACTORY-WAREHOUSE', 'material:铜钼 CuMo50').text()).toContain('0件0.375kg')
    expect(cell('FACTORY-GRIND', 'total').text()).toContain('0件0kg')
    expect(cell('__total', 'material:铜钼 CuMo70').text()).toContain('120件10.125kg')
    expect(cell('__total', 'total').text()).toContain('120件10.5kg')
    expect(wrapper!.text()).toContain('含废料，不含在途')
    expect(wrapper!.text()).toContain('实时同步')
  })

  it('updates pushed cells and totals without polling, replacing the table or resetting horizontal scroll', async () => {
    await render()
    const table = wrapper!.getComponent(ElTable).element
    const scroll = wrapper!.get('.el-scrollbar__wrap').element
    scroll.scrollLeft = 90
    const data = fixture()
    data.stock_matrix.rows[0]!.amounts['铜钼 CuMo70'] = { quantity: 99, weight: 8 }
    data.stock_matrix.rows[0]!.total = { quantity: 99, weight: 8.375 }
    data.stock_matrix.materials[0] = { name: '铜钼 CuMo70', quantity: 119, weight: 10 }
    data.stock_matrix.total = { quantity: 119, weight: 10.375 }
    subscription.onData(data)
    await flushPromises()
    expect(wrapper!.getComponent(ElTable).element).toBe(table)
    expect(scroll.scrollLeft).toBe(90)
    expect(cell('FACTORY-WAREHOUSE', 'material:铜钼 CuMo70').classes()).toContain('is-changed')
    expect(cell('FACTORY-ROLL', 'material:铜钼 CuMo70').classes()).not.toContain('is-changed')
    expect(cell('__total', 'total').text()).toContain('119件10.375kg')
    expect(cell('__total', 'total').classes()).toContain('is-changed')
    await vi.advanceTimersByTimeAsync(1800)
    expect(wrapper!.find('.is-changed').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(30000)
    expect(factoryOverviewApi.get).not.toHaveBeenCalled()
    expect(factoryOverviewApi.subscribe).toHaveBeenCalledOnce()
  })

  it('retains labelled stale values when disconnected, reconnects on visibility and releases its subscription', async () => {
    await render()
    const previous = subscription
    subscription.onState('reconnecting')
    await flushPromises()
    expect(wrapper!.text()).toContain('当前保留上次数据')
    expect(cell('__total', 'total').text()).toContain('120件10.5kg')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stopped).toHaveBeenCalledOnce()
    previous.onData({
      ...fixture(),
      stock_matrix: { ...fixture().stock_matrix, total: { quantity: 999, weight: 999 } },
    })
    await flushPromises()
    expect(cell('__total', 'total').text()).not.toContain('999')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(factoryOverviewApi.subscribe).toHaveBeenCalledTimes(2)
    wrapper!.unmount()
    wrapper = undefined
    expect(stopped).toHaveBeenCalledTimes(2)
  })

  it('does not show missing or incompatible data as a zero inventory', async () => {
    initial = false
    await render()
    expect(wrapper!.findComponent(ElTable).exists()).toBe(false)
    const data = fixture()
    Reflect.deleteProperty(data, 'stock_matrix')
    subscription.onState('live')
    subscription.onData(data)
    await flushPromises()
    expect(wrapper!.text()).toContain('库存明细数据不可用')
    expect(wrapper!.findComponent(ElTable).exists()).toBe(false)
    const next = fixture()
    next.stock_matrix.rows[0] = {
      ...next.stock_matrix.rows[0]!,
      team_id: null,
      amounts: {},
      total: null,
    }
    next.stock_matrix.rows[1]!.active = false
    subscription.onData(next)
    await flushPromises()
    expect(cell('FACTORY-WAREHOUSE', 'total').text()).toContain('—')
    expect(wrapper!.text()).toContain('未配置班组：库房')
    expect(wrapper!.text()).toContain('已停用')
  })

  it('keeps all material columns, handles empty stock and honors reduced motion', async () => {
    reduced = true
    await render()
    const data = fixture()
    data.stock_matrix.materials.push(
      ...Array.from({ length: 12 }, (_, n) => ({ name: `材质${n}`, quantity: 0, weight: 0.001 })),
    )
    subscription.onData(data)
    await flushPromises()
    expect(wrapper!.findAll('th')).toHaveLength(16)
    expect(wrapper!.find('.is-changed').exists()).toBe(false)
    const empty = fixture()
    empty.stock_matrix.materials = []
    empty.stock_matrix.rows.forEach((row) => {
      row.amounts = {}
      row.total = { quantity: 0, weight: 0 }
    })
    empty.stock_matrix.total = { quantity: 0, weight: 0 }
    subscription.onData(empty)
    await flushPromises()
    expect(wrapper!.text()).toContain('暂无在库物料')
    expect(wrapper!.getComponent({ name: 'ElTable' }).props('data')).toHaveLength(9)
    expect(cell('__total', 'total').text()).toContain('0件0kg')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElInputNumber, ElSelect } from 'element-plus'
import FactoryOverviewPage from './FactoryOverviewPage.vue'
import FactoryOperationsOverview from '@/components/FactoryOperationsOverview.vue'
import FactoryOverviewCharts from '@/components/FactoryOverviewCharts.vue'
import FactoryPerformancePanel from '@/components/FactoryPerformancePanel.vue'
import FactoryRecentBatches from '@/components/FactoryRecentBatches.vue'
import TableExportButton from '@/components/TableExportButton.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryFixture } from '@/testFixtures/factoryOverview'
let wrapper: VueWrapper
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(factoryOverviewApi, 'get').mockResolvedValue(factoryFixture())
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function render(path = '/', inventory = true) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/team-workspaces/:teamId', component: { template: '<div/>' } },
      { path: '/transfer-batches', component: { template: '<div/>' } },
    ],
  })
  await router.push(inventory ? `${path}${path.includes('?') ? '&' : '?'}view=inventory` : path)
  wrapper = mount(FactoryOverviewPage, {
    global: {
      plugins: [router],
      stubs: {
        FactoryOverviewCharts: true,
        FactoryPerformancePanel: true,
        FactoryOperationsOverview: true,
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
describe('factory dashboard', () => {
  it('keeps all four sections mounted and navigates without resetting their data', async () => {
    const router = await render('/', false)
    const root = wrapper.get('.factory-overview').element
    const scrollTo = vi.fn()
    Object.defineProperty(root, 'scrollTo', { value: scrollTo, configurable: true })
    expect(wrapper.getComponent(FactoryOperationsOverview).props('days')).toBe(7)
    expect(wrapper.findAll('.factory-section > h2').map((heading) => heading.text())).toEqual([
      '01运行概览',
      '02生产完成',
      '03检验与质量',
      '04库存与交接',
    ])
    const panels = wrapper.findAllComponents(FactoryPerformancePanel)
    expect(panels.map((panel) => panel.props('scene'))).toEqual(['production', 'quality'])
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(1)
    await click('检验与质量')
    expect(router.currentRoute.value.query.view).toBe('quality')
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(wrapper.get('[aria-current="location"]').text()).toBe('检验与质量')
    await click('库存与交接')
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(1)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('all')
    await click('生产完成')
    expect(wrapper.findAllComponents(FactoryPerformancePanel).map((panel) => panel.vm)).toEqual(
      panels.map((panel) => panel.vm),
    )
    expect(wrapper.getComponent(FactoryOperationsOverview).props('days')).toBe(7)
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
  })
  it('locates legacy analysis links and follows the current section while scrolling', async () => {
    await render('/?view=quality', false)
    expect(wrapper.get('[aria-current="location"]').text()).toBe('检验与质量')
    for (const [index, section] of wrapper.findAll('.factory-section').entries()) {
      vi.spyOn(section.element, 'getBoundingClientRect').mockReturnValue({
        top: index * 500 - 520,
      } as DOMRect)
    }
    await wrapper.get('.factory-overview').trigger('scroll')
    expect(wrapper.get('[aria-current="location"]').text()).toBe('生产完成')
    expect(wrapper.findAll('.factory-section')).toHaveLength(4)
  })
  it('keeps a linked section aligned while reports load, then releases it when browsing', async () => {
    let resize!: ResizeObserverCallback
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe = vi.fn()
        disconnect = disconnect
      },
    )
    await render('/?view=quality', false)
    const scrollTo = vi.fn()
    Object.defineProperty(wrapper.element, 'scrollTo', { value: scrollTo, configurable: true })
    resize([], {} as ResizeObserver)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    scrollTo.mockClear()
    await wrapper.trigger('wheel')
    resize([], {} as ResizeObserver)
    expect(scrollTo).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })
  it('exports the displayed analysis, unit and period with readable material type names', async () => {
    vi.mocked(factoryOverviewApi.get).mockImplementation(async (days) => ({
      ...factoryFixture(),
      days: days || 30,
    }))
    await render('/?days=3&metric=weight')
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    const rows = await source.load(new AbortController().signal, () => undefined)
    expect(source.title).toContain('近3天')
    expect(source.fields.at(-1)!.label).toBe('重量 (kg)')
    expect(rows.find((row) => row.category === '物料性质')).toMatchObject({
      name: '半成品',
      value: 10,
    })
    expect(rows.some((row) => row.category === '全厂对外收发')).toBe(true)
  })
  it('loads a global report, keeps period in the URL and drills into a team without a fixed id', async () => {
    const router = await render('/?days=7&metric=quantity')
    expect(factoryOverviewApi.get).toHaveBeenCalledWith(7)
    expect(wrapper.findAll('.factory-metric')).toHaveLength(4)
    expect(wrapper.text()).toContain('全厂在库物料')
    expect(wrapper.text()).toContain('在途 10 件')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('metric')).toBe('quantity')
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 30)
    await flushPromises()
    expect(router.currentRoute.value.query.days).toBe('30')
    wrapper
      .getComponent(FactoryOverviewCharts)
      .vm.$emit('team', { ...factoryFixture().teams[1], id: 914 })
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/914?tab=stock')
  })
  it('refreshes only while visible, keeps old data explicitly marked on failure, and clears its timer', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    await render()
    vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60000)
    await flushPromises()
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('当前显示上次成功读取的数据')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('data').as_of).toBe(
      '2026-09-12T01:02:00Z',
    )
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
  })
  it('clears the previous period while loading and never restores it after a failed or late request', async () => {
    const router = await render('/?days=7')
    let resolveOld!: (data: ReturnType<typeof factoryFixture>) => void
    vi.mocked(factoryOverviewApi.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    await router.push('/?view=inventory&days=14')
    await flushPromises()
    expect(wrapper.findComponent(FactoryOverviewCharts).exists()).toBe(false)
    expect(wrapper.getComponent(TableExportButton).props('disabled')).toBe(true)
    vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
    await router.push('/?view=inventory&days=30')
    await flushPromises()
    resolveOld({ ...factoryFixture(), days: 14 })
    await flushPromises()
    expect(wrapper.text()).toContain('全厂数据加载失败')
    expect(wrapper.findComponent(FactoryOverviewCharts).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('近7天入库')
    expect(wrapper.text()).not.toContain('近14天入库')
  })
  it('discards cached inventory when changing the period from another analysis view', async () => {
    const router = await render('/?days=7')
    vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
    await router.push('/?view=overview&days=30')
    await flushPromises()
    await router.push('/?view=inventory&days=30')
    await flushPromises()
    expect(wrapper.findComponent(FactoryOverviewCharts).exists()).toBe(false)
    expect(wrapper.text()).toContain('全厂数据加载失败')
  })
  it('applies arbitrary days to the URL, summary and charts while preserving the unit', async () => {
    vi.mocked(factoryOverviewApi.get).mockImplementation(async (days = 30) => ({
      ...factoryFixture(),
      days,
    }))
    const router = await render('/?days=3&metric=quantity')
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(3)
    expect(wrapper.text()).toContain('近3天入库')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('data').days).toBe(3)
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 5)
    await flushPromises()
    await wrapper.get('.factory-custom-period').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({
      days: '5',
      metric: 'quantity',
      view: 'inventory',
    })
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(5)
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(5)
    expect(wrapper.text()).toContain('近5天入库')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('data').days).toBe(5)
    await vi.advanceTimersByTimeAsync(60000)
    await flushPromises()
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(5)
    await router.push('/?days=365&view=inventory')
    await flushPromises()
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(365)
  })
  it('does not submit an empty custom period and falls back safely for invalid bookmarks', async () => {
    const router = await render('/?days=366')
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(7)
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', undefined)
    await flushPromises()
    expect(wrapper.get('.factory-custom-period button').attributes('disabled')).toBeDefined()
    await wrapper.get('.factory-custom-period').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.days).toBe('366')
    for (const value of ['0', '-1', '3.5', 'invalid', '5&days=7']) {
      await router.push(`/?days=${value}&view=inventory`)
      await flushPromises()
      expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(7)
    }
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(1)
  })
  it('shows missing scope and legacy warnings without inventing configured teams', async () => {
    const data = factoryFixture()
    data.teams[0] = { ...data.teams[0]!, id: null, balance: null }
    data.legacy_received_count = 3
    vi.mocked(factoryOverviewApi.get).mockResolvedValue(data)
    await render()
    expect(wrapper.text()).toContain('未配置：库房')
    expect(wrapper.text()).toContain('3 条历史接收未纳入库存')
  })
  it('shows a retryable first-load error instead of a zero report', async () => {
    vi.mocked(factoryOverviewApi.get).mockRejectedValue(new Error('offline'))
    await render()
    expect(wrapper.text()).toContain('全厂数据加载失败')
    expect(wrapper.findComponent(FactoryOverviewCharts).exists()).toBe(false)
  })
  it('shows inventory analysis together without nested navigation or timed rotation', async () => {
    await render()
    expect(wrapper.text()).not.toMatch(/大屏模式|轮播|锁定当前屏/)
    expect(wrapper.find('nav[aria-label="分析分类"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(45000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('all')
  })
  it('cycles through today’s batches and opens the selected detail', async () => {
    const data = factoryFixture()
    data.recent_batches = Array.from({ length: 7 }, (_, i) => ({
      batch_no: `TL-RECENT-${i}`,
      entry_kind: 'transfer',
      source_name: '库房',
      target_name: '轧制',
      external_destination: null,
      status: 'received',
      line_count: 1,
      quantity: 10,
      weight: 1,
      updated_at: data.as_of,
      received_at: data.as_of,
    }))
    vi.mocked(factoryOverviewApi.get).mockResolvedValue(data)
    const router = await render()
    const recent = wrapper.getComponent(FactoryRecentBatches)
    expect(recent.text()).toContain('TL-RECENT-0')
    expect(recent.findAll('tbody tr:not([aria-hidden])').map((row) => row.text())).not.toEqual(
      expect.arrayContaining([expect.stringContaining('TL-RECENT-3')]),
    )
    for (let i = 0; i < 6; i++) await recent.get('tbody').trigger('animationiteration')
    expect(recent.get('tbody tr:first-child').text()).toContain('TL-RECENT-6')
    await click('TL-RECENT-6')
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches?batch_no=TL-RECENT-6')
  })
  it('keeps rows still when motion is disabled and offers the complete list', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      batch_no: `TL-REDUCED-${i}`,
      entry_kind: 'transfer' as const,
      source_name: '库房',
      target_name: '轧制',
      external_destination: null,
      status: 'received' as const,
      line_count: 1,
      quantity: 10,
      weight: 1,
      updated_at: factoryFixture().as_of,
      received_at: factoryFixture().as_of,
    }))
    vi.mocked(factoryOverviewApi.get).mockResolvedValue({
      ...factoryFixture(),
      recent_batches: rows,
    })
    const router = await render()
    const recent = wrapper.getComponent(FactoryRecentBatches)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(wrapper.findAll('tbody tr:not([aria-hidden])')).toHaveLength(3)
    expect(recent.find('.recent-rolling').exists()).toBe(false)
    expect(wrapper.get('tbody tr:first-child').text()).toContain('TL-REDUCED-0')
    await click('查看全部')
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches')
  })
})

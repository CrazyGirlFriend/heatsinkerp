// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElInputNumber, ElSelect } from 'element-plus'
import FactoryOverviewPage from './FactoryOverviewPage.vue'
import FactoryOverviewCharts from '@/components/FactoryOverviewCharts.vue'
import FactoryRecentBatches from '@/components/FactoryRecentBatches.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryFixture } from '@/testFixtures/factoryOverview'
let wrapper: VueWrapper
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(factoryOverviewApi, 'get').mockResolvedValue(factoryFixture()) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/team-workspaces/:teamId', component: { template: '<div/>' } }, { path: '/transfer-batches', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(FactoryOverviewPage, { global: { plugins: [router], stubs: { FactoryOverviewCharts: true } } })
  await flushPromises()
  return router
}
async function click(label: string) { await wrapper.findAll('button').find(button => button.text().trim() === label || button.attributes('aria-label') === label)!.trigger('click'); await flushPromises() }
describe('factory dashboard', () => {
  it('loads a global report, keeps period in the URL and drills into a team without a fixed id', async () => {
    const router = await render('/?days=7&metric=quantity')
    expect(factoryOverviewApi.get).toHaveBeenCalledWith(7)
    expect(wrapper.findAll('.factory-metric')).toHaveLength(4)
    expect(wrapper.text()).toContain('全厂在库物料')
    expect(wrapper.text()).toContain('在途 10 件')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('metric')).toBe('quantity')
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 30); await flushPromises()
    expect(router.currentRoute.value.query.days).toBe('30')
    wrapper.getComponent(FactoryOverviewCharts).vm.$emit('team', { ...factoryFixture().teams[1], id: 914 }); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/914?tab=stock')
  })
  it('refreshes only while visible, keeps old data explicitly marked on failure, and clears its timer', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    await render()
    vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60000); await flushPromises()
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('当前显示上次成功读取的数据')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('data').as_of).toBe('2026-09-12T01:02:00Z')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(2)
  })
  it('applies arbitrary days to the URL, summary and charts while preserving the unit', async () => {
    vi.mocked(factoryOverviewApi.get).mockImplementation(async (days = 30) => ({ ...factoryFixture(), days }))
    const router = await render('/?days=3&metric=quantity')
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(3)
    expect(wrapper.text()).toContain('近3天入库')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('data').days).toBe(3)
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 5); await flushPromises()
    await wrapper.get('.factory-custom-period').trigger('submit'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ days: '5', metric: 'quantity' })
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(5)
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(5)
    expect(wrapper.text()).toContain('近5天入库')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('data').days).toBe(5)
    await vi.advanceTimersByTimeAsync(60000); await flushPromises()
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(5)
    await router.push('/?days=365'); await flushPromises()
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(365)
  })
  it('does not submit an empty custom period and falls back safely for invalid bookmarks', async () => {
    const router = await render('/?days=366')
    expect(factoryOverviewApi.get).toHaveBeenLastCalledWith(30)
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', undefined); await flushPromises()
    expect(wrapper.get('.factory-custom-period button').attributes('disabled')).toBeDefined()
    await wrapper.get('.factory-custom-period').trigger('submit'); await flushPromises()
    expect(router.currentRoute.value.query.days).toBe('366')
    for (const value of ['0', '-1', '3.5', 'invalid', '5&days=7']) {
      await router.push(`/?days=${value}`); await flushPromises()
      expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(30)
    }
    expect(factoryOverviewApi.get).toHaveBeenCalledTimes(1)
  })
  it('shows missing scope and legacy warnings without inventing configured teams', async () => {
    const data = factoryFixture(); data.teams[0] = { ...data.teams[0]!, id: null, balance: null }; data.legacy_received_count = 3
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
  it('keeps analysis sections manual without fullscreen or timed rotation', async () => {
    await render()
    expect(wrapper.text()).not.toMatch(/大屏模式|轮播|锁定当前屏/)
    await click('库存分析')
    await vi.advanceTimersByTimeAsync(45000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('stock')
    await click('交接与异常')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('handoff')
    await click('全厂态势')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('overview')
  })
  it('keeps every recent batch reachable manually and opens the selected detail', async () => {
    const data = factoryFixture()
    data.recent_batches = Array.from({ length: 7 }, (_, i) => ({ batch_no: `TL-RECENT-${i}`, entry_kind: 'transfer', source_name: '库房', target_name: '轧制', external_destination: null, status: 'received', line_count: 1, quantity: 10, weight: 1, updated_at: data.as_of }))
    vi.mocked(factoryOverviewApi.get).mockResolvedValue(data)
    const router = await render()
    const recent = wrapper.getComponent(FactoryRecentBatches)
    expect(recent.text()).toContain('TL-RECENT-0')
    expect(recent.findAll('tbody tr:not([aria-hidden])').map(row => row.text())).not.toEqual(expect.arrayContaining([expect.stringContaining('TL-RECENT-3')]))
    for (let i = 0; i < 6; i++) await click('下一条近期转料')
    expect(recent.get('tbody tr:first-child').text()).toContain('TL-RECENT-6')
    await click('TL-RECENT-6')
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches?batch_no=TL-RECENT-6')
  })
  it('keeps recent rows accessible manually with reduced motion', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ batch_no: `TL-REDUCED-${i}`, entry_kind: 'transfer' as const, source_name: '库房', target_name: '轧制', external_destination: null, status: 'received' as const, line_count: 1, quantity: 10, weight: 1, updated_at: factoryFixture().as_of }))
    wrapper = mount(FactoryRecentBatches, { props: { rows, motion: false }, global: { stubs: { transition: false } } })
    await click('下一条近期转料')
    expect(wrapper.findAll('tbody tr:not([aria-hidden])')).toHaveLength(3)
    expect(wrapper.get('tbody tr:first-child').text()).toContain('TL-REDUCED-1')
    expect(wrapper.text()).toContain('TL-REDUCED-3')
    expect(wrapper.find('.recent-rolling').exists()).toBe(false)
    await click('上一条近期转料')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('TL-REDUCED-0')
  })
})

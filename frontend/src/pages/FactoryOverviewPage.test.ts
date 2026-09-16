// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElSelect } from 'element-plus'
import FactoryOverviewPage from './FactoryOverviewPage.vue'
import FactoryOverviewCharts from '@/components/FactoryOverviewCharts.vue'
import FactoryRecentBatches from '@/components/FactoryRecentBatches.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryFixture } from '@/testFixtures/factoryOverview'
let wrapper: VueWrapper
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(factoryOverviewApi, 'get').mockResolvedValue(factoryFixture()) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/team-workspaces/:teamId', component: { template: '<div/>' } }, { path: '/transfer-batches/scan', component: { template: '<div/>' } }] })
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
    expect(wrapper.text()).toContain('另有内部在途 10 件')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('metric')).toBe('quantity')
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 30); await flushPromises()
    expect(router.currentRoute.value.query.days).toBe('30')
    wrapper.getComponent(FactoryOverviewCharts).vm.$emit('team', { ...factoryFixture().teams[1], id: 914 }); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/914?tab=serials')
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
  it('rotates scenes every twenty seconds, points every four and recent groups every eight; lock preserves the scene', async () => {
    await render()
    await click('播放轮播')
    await vi.advanceTimersByTimeAsync(8000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('focusIndex')).toBe(2)
    expect(wrapper.getComponent(FactoryRecentBatches).props('group')).toBe(1)
    await vi.advanceTimersByTimeAsync(12000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('stock')
    await click('锁定当前屏')
    await vi.advanceTimersByTimeAsync(40000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('stock')
    await click('解除锁定')
    await vi.advanceTimersByTimeAsync(20000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('handoff')
    await click('下一屏')
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('overview')
    await vi.advanceTimersByTimeAsync(25000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('overview')
  })
  it('pauses for reading, hidden pages, stale data and detail navigation', async () => {
    const router = await render()
    await click('播放轮播')
    await wrapper.get('.factory-presentation').trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(21000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('overview')
    await wrapper.get('.factory-presentation').trigger('mouseleave')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(21000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('overview')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'))
    vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
    await click('刷新')
    await vi.advanceTimersByTimeAsync(21000)
    expect(wrapper.getComponent(FactoryOverviewCharts).props('scene')).toBe('overview')
    wrapper.getComponent(FactoryRecentBatches).vm.$emit('open', { batch_no: 'CK202609120001' }); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches/scan?batch_no=CK202609120001')
    expect(wrapper.text()).toContain('轮播已暂停')
  })
})

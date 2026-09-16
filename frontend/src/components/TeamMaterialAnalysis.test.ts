// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElSelect } from 'element-plus'
import TeamMaterialAnalysis from './TeamMaterialAnalysis.vue'
import TeamAnalyticsCharts from './TeamAnalyticsCharts.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { analyticsFixture, serialFixture } from '@/testFixtures/materialAnalytics'
let wrapper: VueWrapper
beforeEach(() => { vi.spyOn(teamMaterialApi, 'analytics').mockResolvedValue(analyticsFixture()); vi.spyOn(teamMaterialApi, 'serials') })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(path = '/team-workspaces/914?days=7&metric=quantity') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(TeamMaterialAnalysis, { props: { teamId: 914, overview: { team_id: 914, totals: serialFixture(), materials: [], pending_incoming: { quantity: 0, weight: 0, count: 0 }, legacy_received_count: 0 } }, global: { plugins: [router], stubs: { TeamAnalyticsCharts: true } } })
  await flushPromises()
  return router
}
describe('standalone team analysis', () => {
  it('loads team-wide charts without a serial table request and preserves period settings', async () => {
    const router = await render()
    expect(teamMaterialApi.analytics).toHaveBeenCalledWith(914, { metric: 'quantity', days: 7 })
    expect(teamMaterialApi.serials).not.toHaveBeenCalled()
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 30); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'overview', metric: 'quantity', days: '30' })
  })
  it('clicking a chart navigates to the filtered serial page and browser Back returns to the chart page', async () => {
    const router = await render()
    wrapper.getComponent(TeamAnalyticsCharts).vm.$emit('filter', { stock_age: 'ge7' }, '库存停留：7天及以上'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'serials', days: '7', metric: 'quantity', stock_age: 'ge7' })
    router.back(); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ days: '7', metric: 'quantity' })
  })
  it('does not replace failed analytics with zero charts', async () => {
    vi.mocked(teamMaterialApi.analytics).mockRejectedValue(new Error('分析服务不可用'))
    await render()
    expect(wrapper.text()).toContain('分析服务不可用')
    expect(wrapper.findComponent(TeamAnalyticsCharts).exists()).toBe(false)
  })
})

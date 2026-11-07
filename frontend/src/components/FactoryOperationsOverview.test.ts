// @vitest-environment jsdom
import { computed } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FactoryOperationsOverview from './FactoryOperationsOverview.vue'
import LedgerChart from './LedgerChart.vue'
import TeamProductionChart from './TeamProductionChart.vue'
import AppSelect from './AppSelect.vue'
import DashboardMetric from './DashboardMetric.vue'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { factoryFixture } from '@/testFixtures/factoryOverview'
import { performanceFixture } from '@/testFixtures/factoryPerformance'
import type { ScheduleOverview } from '@/types/productionSchedule'

let wrapper: VueWrapper
const scheduleFixture = (): ScheduleOverview => ({
  as_of: '2026-11-06T01:00:00Z',
  date_from: '2026-10-31',
  date_to: '2026-11-06',
  period: { completed: 8, completed_late: 1, overdue: 1 },
  assessed_count: 10,
  on_time_rate: 80,
  overdue_count: 130,
  today_count: 4,
  attention: [],
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(factoryOverviewApi, 'get').mockResolvedValue({
    ...factoryFixture(),
    stock_age: [{ key: 'ge7', label: '7天及以上', quantity: 12, weight: 2 }],
  })
  vi.spyOn(productionScheduleApi, 'overview').mockResolvedValue(scheduleFixture())
  vi.spyOn(factoryPerformanceApi, 'get').mockResolvedValue({
    ...performanceFixture(),
    activity: {
      totals: {
        ...performanceFixture().production.totals,
        completed_quantity: 920,
        rework_quantity: 25,
      },
      teams: [
        {
          ...performanceFixture().production.totals,
          team_id: 2,
          team_name: '轧制',
          completed_quantity: 610,
        },
        {
          ...performanceFixture().production.totals,
          team_id: 3,
          team_name: '研磨',
          completed_quantity: 310,
        },
      ],
      trend: [
        {
          ...performanceFixture().production.totals,
          date: '2026-11-06',
          completed_quantity: 920,
          rework_quantity: 25,
        },
      ],
    },
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/material-trace', component: { template: '<div />' } },
      { path: '/team-workspaces/:id', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  wrapper = mount(FactoryOperationsOverview, {
    props: { days: 7, metric: 'quantity', motion: false },
    global: {
      plugins: [router],
      provide: { [workspaceAppearanceKey as symbol]: computed(() => 'watermelon') },
      stubs: { LedgerChart: true },
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
it('shows each team’s production independently and filters or opens the selected team', async () => {
  const router = await render()
  expect(
    wrapper
      .findAllComponents(DashboardMetric)
      .map((card) => card.props('value'))
      .slice(2),
  ).toEqual([130, 80])
  await click('加工')
  const chart = wrapper.getComponent(TeamProductionChart)
  expect(chart.props('rows').map((row) => [row.team_name, row.completed_quantity])).toEqual([
    ['轧制', 610],
    ['研磨', 310],
  ])
  expect(wrapper.find('.operations-trend-summary').exists()).toBe(false)
  wrapper.getComponent(AppSelect).vm.$emit('update:modelValue', 3)
  await flushPromises()
  expect(chart.props('rows').map((row) => row.team_name)).toEqual(['研磨'])
  await wrapper.setProps({ metric: 'weight' })
  expect(chart.props('metric')).toBe('weight')
  chart.vm.$emit('select', 3)
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/team-workspaces/3')
  expect(router.currentRoute.value.query).toMatchObject({
    tab: 'processing',
    date_from: expect.any(String),
    date_to: expect.any(String),
  })
  wrapper.getComponent(AppSelect).vm.$emit('update:modelValue', undefined)
  await flushPromises()
  expect(chart.props('rows')).toHaveLength(2)
  expect(factoryPerformanceApi.get).toHaveBeenCalledWith(
    expect.objectContaining({ include_activity: true }),
  )
  wrapper
    .findAllComponents(LedgerChart)
    .find((chart) => chart.props('label') === '各班组当前库存与待签收量')!
    .vm.$emit('select', { dataIndex: 1, seriesIndex: 1 })
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/2?tab=pending')
  await click('查看长期滞留物料')
  expect(router.currentRoute.value.query).toEqual({ availability: 'current', stock_age_min: '7' })
})
it('shows unavailable and unassessed rates as missing, retains successful data during refresh failure', async () => {
  vi.mocked(productionScheduleApi.overview).mockResolvedValueOnce({
    ...scheduleFixture(),
    on_time_rate: null,
    assessed_count: 0,
  })
  vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
  await render()
  const cards = wrapper.findAllComponents(DashboardMetric)
  expect(cards[0]!.props('value')).toBeNull()
  expect(cards[3]!.props('value')).toBeNull()
  expect(wrapper.text()).toContain('库存与交接更新失败')
  await click('刷新运行概览')
  const stockValue = wrapper.findAllComponents(DashboardMetric)[0]!.props('value')
  vi.mocked(factoryOverviewApi.get).mockRejectedValueOnce(new Error('offline'))
  await vi.advanceTimersByTimeAsync(60000)
  expect(wrapper.findAllComponents(DashboardMetric)[0]!.props('value')).toBe(stockValue)
  expect(wrapper.text()).toContain('已有数据保留')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  const count = vi.mocked(factoryOverviewApi.get).mock.calls.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(factoryOverviewApi.get).toHaveBeenCalledTimes(count)
  wrapper.unmount()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  await vi.advanceTimersByTimeAsync(60000)
  expect(factoryOverviewApi.get).toHaveBeenCalledTimes(count)
})
it('does not restore stale results when the period changes during a request', async () => {
  let resolveOld!: (value: ScheduleOverview) => void
  vi.mocked(productionScheduleApi.overview).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve
    }),
  )
  await render()
  await wrapper.setProps({ days: 30 })
  await flushPromises()
  expect(productionScheduleApi.overview).toHaveBeenLastCalledWith(30)
  expect(wrapper.findAllComponents(DashboardMetric)[2]!.props('value')).toBe(130)
  resolveOld({ ...scheduleFixture(), overdue_count: 999 })
  await flushPromises()
  expect(wrapper.findAllComponents(DashboardMetric)[2]!.props('value')).toBe(130)
})

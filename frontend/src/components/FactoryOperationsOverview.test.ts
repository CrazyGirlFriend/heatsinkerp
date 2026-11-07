// @vitest-environment jsdom
import { computed } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FactoryOperationsOverview from './FactoryOperationsOverview.vue'
import FactoryTeamStatus from './FactoryTeamStatus.vue'
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
    stock_attention: [
      {
        transfer_id: 11,
        batch_no: 'CK-11',
        serial_no: '691236-51',
        team_id: 2,
        team_name: '轧制',
        quantity: 12,
        weight: 2,
        received_at: '2026-09-01T01:02:00Z',
      },
    ],
    pending_attention: [
      {
        id: 12,
        batch_no: 'CK-12',
        serial_no: '691236-52',
        quantity: 8,
        weight: 1,
        source_team_name: '库房',
        next_team_name: '轧制',
        external_destination: null,
        created_at: '2026-09-11T01:02:00Z',
      },
    ],
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
      { path: '/transfer-batches', component: { template: '<div />' } },
      { path: '/production-schedules', component: { template: '<div />' } },
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
  await click('加工完成')
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
})
it('opens physical stock with its processing state, pending receipt and specific follow-up records', async () => {
  const router = await render()
  const table = wrapper.getComponent(FactoryTeamStatus)
  const team = table.props('teams')[1]!
  table.vm.$emit('open', team, 'partial')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe(`/team-workspaces/${team.id}`)
  expect(router.currentRoute.value.query).toEqual({
    tab: 'stock',
    availability: 'current',
    processing_state: 'partial',
  })
  table.vm.$emit('open', team, 'pending')
  await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'pending', availability: 'current' })
  table.vm.$emit('open', { ...team, active: false }, 'complete')
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/material-trace')
  expect(router.currentRoute.value.query).toEqual({
    inventory_team_id: String(team.id),
    availability: 'current',
    processing_state: 'complete',
  })
  await click('滞留最长')
  expect(wrapper.get('.operations-attention').text()).toContain('滞留 11天')
  expect(wrapper.get('.operations-attention').text()).toContain('12 件 · 2 kg')
  await wrapper.get('.operations-attention-item').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query).toEqual({
    availability: 'current',
    inventory_team_id: '2',
    serial_no: '691236-51',
  })
  await click('待签收 2')
  expect(wrapper.get('.operations-attention').text()).toContain('库房 → 轧制')
  await wrapper.get('.operations-attention-item').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/transfer-batches?batch_no=CK-12')
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
it('separates warehouse work and preserves partial or unclassified stock instead of treating it as complete', async () => {
  const data = factoryFixture()
  data.teams[0]!.processing = [{ state: 'not_required', quantity: 100, weight: 10, batch_count: 1 }]
  data.teams[1]!.processing = [
    { state: 'unregistered', quantity: 40, weight: 4, batch_count: 1 },
    { state: 'partial', quantity: 20, weight: 2, batch_count: 1 },
    { state: 'complete', quantity: 60, weight: 6, batch_count: 2 },
    { state: 'registered', quantity: 5, weight: 0.5, batch_count: 1 },
  ]
  vi.mocked(factoryOverviewApi.get).mockResolvedValueOnce(data)
  await render()
  const rows = wrapper.findAll('.team-status tbody tr')
  expect(rows[0]!.text()).toContain('备料与转出')
  expect(rows[0]!.find('.team-state').exists()).toBe(false)
  expect(rows[1]!.findAll('.team-state').map((cell) => cell.text())).toEqual([
    '40',
    '20',
    '60',
    '0',
  ])
  expect(rows[2]!.findAll('.team-state').map((cell) => cell.text())).toEqual(['—', '—', '—', '—'])
  expect(rows[2]!.get('.team-state button').attributes('disabled')).toBeDefined()
  await wrapper.setProps({ metric: 'weight' })
  expect(rows[1]!.findAll('.team-state').map((cell) => cell.text())).toEqual(['4', '2', '6', '0'])
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

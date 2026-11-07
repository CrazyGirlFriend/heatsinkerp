// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TeamDashboard from './TeamDashboard.vue'
import DashboardMetric from './DashboardMetric.vue'
import DashboardDonut from './DashboardDonut.vue'
import DashboardDistribution from './DashboardDistribution.vue'
import AppButton from './AppButton.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { performanceFixture } from '@/testFixtures/factoryPerformance'
import type { TeamMaterialOverview } from '@/types/teamMaterials'

const overview = {
  work_orders: {
    mode: 'processing',
    in_progress_count: 1,
    overdue_count: 2,
    periods: [
      {
        key: 'today',
        date_from: '2026-11-07',
        date_to: '2026-11-07',
        processed_count: 2,
        completed_count: 1,
      },
      {
        key: 'week',
        date_from: '2026-11-02',
        date_to: '2026-11-07',
        processed_count: 4,
        completed_count: 2,
      },
      {
        key: 'month',
        date_from: '2026-11-01',
        date_to: '2026-11-07',
        processed_count: 6,
        completed_count: 3,
      },
    ],
  },
  totals: { on_hand_quantity: 125, on_hand_weight: 12.5 },
  material_types: [{ material_type: 'semi_finished', on_hand_quantity: 125, on_hand_weight: 12.5 }],
  pending_incoming: { count: 3, quantity: 30, weight: 3 },
  current_stock: {
    serial_count: 1,
    unnumbered_batch_count: 0,
    processing: [
      { state: 'complete', batch_count: 2, quantity: 60, weight: 6 },
      { state: 'partial', batch_count: 1, quantity: 20, weight: 2 },
      { state: 'unregistered', batch_count: 1, quantity: 40, weight: 4 },
      { state: 'registered', batch_count: 1, quantity: 5, weight: 0.5 },
    ],
  },
} as TeamMaterialOverview
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(factoryPerformanceApi, 'get').mockResolvedValue(performanceFixture())
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(processing = true) {
  wrapper = mount(TeamDashboard, {
    props: { teamId: 2, processing, overview, loading: false, error: '' },
    global: { stubs: { LedgerChart: true, AnimatedMetric: true } },
  })
  await flushPromises()
}
it('separates complete, partial and legacy work, and drills into actual remaining stock', async () => {
  await render()
  const metrics = wrapper.findAllComponents(DashboardMetric)
  expect(metrics.map((item) => [item.props('label'), item.props('value')])).toEqual([
    ['在库流水号', 1],
    ['今日在途工单', 1],
    ['当前逾期工单', 2],
    ['待签收', 3],
  ])
  const donut = wrapper.findAllComponents(DashboardDonut)[0]!
  expect(donut.props('rows').map((row) => [row.key, row.value])).toEqual([
    ['unregistered', 40],
    ['partial', 20],
    ['complete', 60],
    ['rework', 0],
    ['registered', 5],
  ])
  donut.vm.$emit('select', 'partial')
  expect(wrapper.emitted('navigate')?.at(-1)).toEqual([
    { tab: 'stock', availability: 'current', processing_state: 'partial' },
  ])
  metrics[2]!.vm.$emit('open')
  expect(wrapper.emitted('navigate')?.at(-1)).toEqual([
    { tab: 'delivery-schedule', status: 'overdue' },
  ])
  wrapper.findAllComponents(WatermelonSegmented)[0]!.vm.$emit('update:modelValue', 'weight')
  await flushPromises()
  expect(metrics[1]!.props()).toMatchObject({ value: 1, unit: '单', static: true })
  expect(donut.props('rows').map((row) => row.value)).toEqual([4, 2, 6, 0, 0.5])
})
it('uses a team-scoped quality period for both chart and detail, and shows failures', async () => {
  await render()
  expect(factoryPerformanceApi.get).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: 2 }),
  )
  const period = vi.mocked(factoryPerformanceApi.get).mock.calls.at(-1)![0]!
  wrapper.findAllComponents(DashboardDonut)[2]!.vm.$emit('select', 'pending')
  expect(wrapper.emitted('navigate')?.at(-1)).toEqual([
    {
      tab: 'quality-feedback',
      team_id: '2',
      status: 'pending',
      date_from: period.date_from,
      date_to: period.date_to,
    },
  ])
  vi.mocked(factoryPerformanceApi.get).mockRejectedValueOnce(new Error('unavailable'))
  wrapper.findAllComponents(WatermelonSegmented)[1]!.vm.$emit('update:modelValue', 'month')
  await flushPromises()
  expect(wrapper.text()).toContain('质量数据读取失败')
  expect(wrapper.findAllComponents(DashboardDonut)).toHaveLength(2)
})
it('shows warehouse balances instead of pretending warehouse stock has processing progress', async () => {
  await render(false)
  expect(wrapper.findAllComponents(DashboardMetric).map((item) => item.props('label'))).toEqual([
    '在库流水号',
    '待转出工单',
    '当前逾期工单',
    '待签收',
  ])
  expect(wrapper.findAllComponents(DashboardDonut)).toHaveLength(2)
  expect(wrapper.text()).not.toContain('在库加工状态')
  expect(wrapper.text()).toContain('本周收发工单')
  expect(wrapper.text()).toContain('库房交期不考核')
})
it('does not present a failed inventory request as zero stock', async () => {
  await render()
  await wrapper.setProps({ overview: null, error: '库存读取失败' })
  expect(wrapper.findAllComponents(DashboardMetric)).toHaveLength(0)
  expect(wrapper.text()).toContain('库存读取失败')
})
it('shows all three calendar periods and carries the chosen period to work records and quality', async () => {
  await render()
  const distributions = wrapper.findAllComponents(DashboardDistribution)
  expect(distributions.map((item) => item.props('rows').map((row) => row.value))).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ])
  const records = wrapper
    .findAllComponents(AppButton)
    .filter((button) => button.text().includes('加工记录'))
  await records[1]!.trigger('click')
  expect(wrapper.emitted('navigate')?.at(-1)).toEqual([
    { tab: 'processing', date_from: '2026-11-02', date_to: '2026-11-07' },
  ])
  expect(factoryPerformanceApi.get).toHaveBeenLastCalledWith({
    team_id: 2,
    date_from: '2026-11-02',
    date_to: '2026-11-07',
  })
  wrapper.findAllComponents(WatermelonSegmented)[1]!.vm.$emit('update:modelValue', 'today')
  await flushPromises()
  expect(factoryPerformanceApi.get).toHaveBeenLastCalledWith({
    team_id: 2,
    date_from: '2026-11-07',
    date_to: '2026-11-07',
  })
})

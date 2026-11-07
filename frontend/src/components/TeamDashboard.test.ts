// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TeamDashboard from './TeamDashboard.vue'
import DashboardMetric from './DashboardMetric.vue'
import DashboardDonut from './DashboardDonut.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { performanceFixture } from '@/testFixtures/factoryPerformance'
import type { TeamMaterialOverview } from '@/types/teamMaterials'

const overview = {
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
    ['待加工', 40],
    ['已加工', 60],
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
    { tab: 'stock', availability: 'current', processing_state: 'complete' },
  ])
  wrapper.findAllComponents(WatermelonSegmented)[0]!.vm.$emit('update:modelValue', 'weight')
  await flushPromises()
  expect(metrics[2]!.props()).toMatchObject({ value: 6, unit: 'kg' })
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
  wrapper.findAllComponents(WatermelonSegmented)[1]!.vm.$emit('update:modelValue', '7')
  await flushPromises()
  expect(wrapper.text()).toContain('质量数据读取失败')
  expect(wrapper.findAllComponents(DashboardDonut)).toHaveLength(2)
})
it('shows warehouse balances instead of pretending warehouse stock has processing progress', async () => {
  await render(false)
  expect(wrapper.findAllComponents(DashboardMetric).map((item) => item.props('label'))).toEqual([
    '在库流水号',
    '在库数量',
    '在库重量',
    '待签收',
  ])
  expect(wrapper.findAllComponents(DashboardDonut)).toHaveLength(2)
  expect(wrapper.text()).not.toContain('在库加工状态')
})
it('does not present a failed inventory request as zero stock', async () => {
  await render()
  await wrapper.setProps({ overview: null, error: '库存读取失败' })
  expect(wrapper.findAllComponents(DashboardMetric)).toHaveLength(0)
  expect(wrapper.text()).toContain('库存读取失败')
})

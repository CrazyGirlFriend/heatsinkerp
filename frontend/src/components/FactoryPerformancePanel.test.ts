// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElRadioGroup, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactoryPerformancePanel from './FactoryPerformancePanel.vue'
import FactoryPerformanceCharts from './FactoryPerformanceCharts.vue'
import AnimatedMetric from './AnimatedMetric.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import TableExportButton from './TableExportButton.vue'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { performanceFixture } from '@/testFixtures/factoryPerformance'
import type { FactoryPerformance } from '@/types/factoryPerformance'

let wrapper: VueWrapper
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T04:00:00Z'))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(factoryPerformanceApi, 'get').mockResolvedValue(performanceFixture())
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function render(scene: 'production' | 'quality' = 'production') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/team-workspaces/:teamId', component: { template: '<div/>' } },
    ],
  })
  await router.push('/')
  wrapper = mount(FactoryPerformancePanel, {
    props: { scene, motion: false },
    global: {
      plugins: [router],
      stubs: { FactoryPerformanceCharts: true, RecordDateFilter: true, TableExportButton: true },
    },
  })
  await flushPromises()
  return router
}
async function loadExport(
  source: ReturnType<InstanceType<typeof TableExportButton>['$props']['source']>,
) {
  return source!.load(new AbortController().signal, () => undefined)
}
function selection(label: string) {
  return wrapper
    .findAllComponents(ElRadioGroup)
    .find((group) => group.attributes('aria-label') === label)!
}

describe('factory production and quality reporting', () => {
  it('separates actual first work from rework and exports team/day work quantities', async () => {
    const router = await render()
    expect(factoryPerformanceApi.get).toHaveBeenCalledWith({
      date_from: '2026-09-21',
      date_to: '2026-10-20',
      team_id: undefined,
    })
    const metrics = wrapper.findAllComponents(AnimatedMetric)
    expect(metrics.map((metric) => metric.props('value'))).toEqual([110, 30, 5, 0.2])
    expect(wrapper.text()).toContain('跨班组工作量不能作为全厂成品产量')
    const exporter = wrapper.getComponent(TableExportButton)
    const source = exporter.props('source')()
    expect(source?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'completed_quantity', label: '正常加工完成 (件次)' }),
        expect.objectContaining({ key: 'rework_quantity', label: '返工完成 (件次)' }),
      ]),
    )
    expect(await loadExport(source)).toEqual([
      expect.objectContaining({
        name: '轧制',
        completed_quantity: 110,
        rework_quantity: 30,
        work_quantity: 140,
      }),
    ])
    expect(exporter.props('variants')!()[0]?.title).toBe('每日加工汇总')
    wrapper.getComponent(FactoryPerformanceCharts).vm.$emit('team', 2)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({
      tab: 'processing',
      date_from: '2026-09-21',
      date_to: '2026-10-20',
    })
    expect(router.currentRoute.value.path).toBe('/team-workspaces/2')
  })

  it('uses weighted actual checked quantities and keeps full inspections/rechecks separate', async () => {
    await render('quality')
    let values = wrapper.findAllComponents(AnimatedMetric).map((metric) => metric.props('value'))
    expect(values[0]).toBeCloseTo((95 / 110) * 100)
    expect(values.slice(1)).toEqual([110, 15, 2])
    expect(wrapper.text()).toContain('质量问题 2 条')
    expect(wrapper.text()).not.toContain('质量问题 3 条')
    const exporter = wrapper.getComponent(TableExportButton)
    const source = exporter.props('source')()
    const rows = await loadExport(source)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ basis: '巡检 · 抽检 · 首次检查', pass_rate: 90 })
    const issues = await loadExport(exporter.props('variants')!()[1]!)
    expect(issues[0]).toMatchObject({ category: '去重合计', total: 2 })
    expect(issues.filter((row) => row.category === '问题分类（可多选）')).toHaveLength(2)
    selection('检查阶段').vm.$emit('update:modelValue', 'recheck')
    await flushPromises()
    values = wrapper.findAllComponents(AnimatedMetric).map((metric) => metric.props('value'))
    expect(values).toEqual([100, 100, 0, 1])
    selection('检查范围').vm.$emit('update:modelValue', 'full')
    await flushPromises()
    expect(wrapper.get('.performance-metric').text()).toContain('未检查')
    expect(
      wrapper.findAllComponents(AnimatedMetric).map((metric) => metric.props('value')),
    ).toEqual([0, 0, 0])
    expect(wrapper.text()).toContain('当前口径没有检查记录')
    expect(factoryPerformanceApi.get).toHaveBeenCalledTimes(1)
  })

  it('applies date/team filters and rejects unbounded intervals without showing stale scoped data', async () => {
    await render()
    const picker = wrapper.getComponent(RecordDateFilter)
    picker.vm.$emit('update:modelValue', { from: '2026-10-01', to: '2026-10-10' })
    await flushPromises()
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 3)
    await flushPromises()
    expect(factoryPerformanceApi.get).toHaveBeenLastCalledWith({
      date_from: '2026-10-01',
      date_to: '2026-10-10',
      team_id: 3,
    })
    picker.vm.$emit('update:modelValue', { from: '2020-01-01', to: '2026-10-20' })
    await flushPromises()
    expect(wrapper.text()).toContain('最多 366 天')
    expect(factoryPerformanceApi.get).toHaveBeenCalledTimes(3)
    picker.vm.$emit('update:modelValue', { from: '', to: '' })
    await flushPromises()
    expect(factoryPerformanceApi.get).toHaveBeenLastCalledWith({
      date_from: '2026-09-21',
      date_to: '2026-10-20',
      team_id: 3,
    })
  })

  it('ignores late responses after changing the team and preserves old data only on refresh failure', async () => {
    await render()
    let resolveFirst: (value: FactoryPerformance) => void = () => undefined
    vi.mocked(factoryPerformanceApi.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 2)
    await flushPromises()
    expect(wrapper.findComponent(FactoryPerformanceCharts).exists()).toBe(false)
    const latest = performanceFixture()
    latest.production.totals.completed_quantity = 42
    vi.mocked(factoryPerformanceApi.get).mockResolvedValueOnce(latest)
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 3)
    await flushPromises()
    resolveFirst(performanceFixture())
    await flushPromises()
    expect(wrapper.findAllComponents(AnimatedMetric)[0]!.props('value')).toBe(42)
    vi.mocked(factoryPerformanceApi.get).mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(wrapper.text()).toContain('当前显示上次成功读取的数据')
    expect(wrapper.getComponent(TableExportButton).props('disabled')).toBe(true)
    expect(wrapper.findAllComponents(AnimatedMetric)[0]!.props('value')).toBe(42)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const calls = vi.mocked(factoryPerformanceApi.get).mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryPerformanceApi.get).toHaveBeenCalledTimes(calls)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60000)
    expect(factoryPerformanceApi.get).toHaveBeenCalledTimes(calls)
  })

  it('offers a retryable first-load error without reporting invented zero production', async () => {
    vi.mocked(factoryPerformanceApi.get).mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(wrapper.text()).toContain('生产与质量数据读取失败')
    expect(wrapper.findAll('.performance-metric')).toHaveLength(0)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重新加载')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.performance-metric')).toHaveLength(4)
  })
})

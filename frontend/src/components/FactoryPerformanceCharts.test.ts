// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import type { EChartsCoreOption } from 'echarts/core'
import { describe, expect, it, vi } from 'vitest'
import FactoryPerformanceCharts from './FactoryPerformanceCharts.vue'
import LedgerChart from './LedgerChart.vue'
import TeamProductionChart from './TeamProductionChart.vue'
import { performanceFixture } from '@/testFixtures/factoryPerformance'

function series(option: EChartsCoreOption) {
  return option.series as { data: unknown[]; stack?: string }[]
}

describe('production and quality chart meanings', () => {
  it('compares teams by default and only shows the daily trend when a team is selected', async () => {
    const data = performanceFixture()
    const wrapper = mount(FactoryPerformanceCharts, {
      props: {
        data,
        scene: 'production',
        aggregate: true,
        metric: 'quantity',
        basis: { kind: 'patrol', scope: 'sample', phase: 'first' },
        motion: false,
      },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      expect(wrapper.findAllComponents(LedgerChart)).toHaveLength(1)
      const teams = wrapper.getComponent(TeamProductionChart)
      expect(teams.props('rows')).toEqual(data.activity!.teams)
      teams.vm.$emit('select', 2)
      expect(wrapper.emitted('team')).toEqual([[2]])
      await wrapper.setProps({ teamName: '轧制' })
      expect(wrapper.findComponent(TeamProductionChart).exists()).toBe(false)
      const trend = wrapper.getComponent(LedgerChart)
      expect(trend.props('label')).toBe('轧制 · 每日加工完成量')
      expect(series(trend.props('option'))[0]!.data).toEqual([110])
    } finally {
      wrapper.unmount()
    }
  })
  it('only charts the current serial/task and keeps normal work and rework separate', async () => {
    const wrapper = mount(FactoryPerformanceCharts, {
      props: {
        data: performanceFixture(),
        scene: 'production',
        metric: 'quantity',
        basis: { kind: 'patrol', scope: 'sample', phase: 'first' },
        motion: false,
      },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      expect(wrapper.findAllComponents(LedgerChart)).toHaveLength(1)
      expect(wrapper.text()).not.toContain('当前班组、流水号、任务和工序的实际加工记录')
      await wrapper.get('button[aria-label="每日加工完成量统计说明"]').trigger('click')
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain('当前班组、流水号、任务和工序的实际加工记录'),
      )
      await wrapper
        .get('button[aria-label="每日加工完成量统计说明"]')
        .trigger('keydown', { key: 'Escape' })
      await vi.waitFor(() => {
        const popover = document
          .querySelector('.statistic-help-content')
          ?.closest<HTMLElement>('[role="tooltip"]')
        expect(popover?.style.display).toBe('none')
      })
      expect(wrapper.text()).not.toContain('班组完成量')
      const chart = wrapper.getComponent(LedgerChart)
      expect(chart.props('option').series).toEqual([
        expect.objectContaining({ name: '正常加工', type: 'bar', data: [110, 0] }),
        expect.objectContaining({ name: '返工', type: 'bar', data: [30, 0] }),
      ])
      expect(chart.props('option').yAxis).toMatchObject({ minInterval: 1 })
      await wrapper.setProps({ metric: 'weight' })
      expect(series(chart.props('option'))[0]!.data).toEqual([11, 0])
      expect(chart.props('option').yAxis).not.toHaveProperty('minInterval')
    } finally {
      wrapper.unmount()
    }
  })
  it('compares materials and keeps isolated inspection days visible, with unobserved days null and uses deduplicated backend issue counts without stacked totals', () => {
    const wrapper = mount(FactoryPerformanceCharts, {
      props: {
        data: performanceFixture(),
        scene: 'quality',
        metric: 'quantity',
        basis: { kind: 'patrol', scope: 'sample', phase: 'first' },
        motion: false,
      },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      const charts = wrapper.findAllComponents(LedgerChart)
      expect(charts).toHaveLength(4)
      const materials = charts.find((chart) => chart.props('label') === '各材质合格率')!
      const trend = charts.find((chart) => chart.props('label') === '每日材质合格率')!
      const problems = charts.find((chart) => chart.props('label') === '检出问题分类')!
      expect(series(materials.props('option'))[0]!.data).toEqual([90, 50])
      expect(materials.props('option').yAxis).toMatchObject({ data: ['W80', '铜铝'] })
      expect(series(trend.props('option'))[0]!).toMatchObject({
        name: 'W80',
        showSymbol: true,
        data: [90, null],
        connectNulls: false,
      })
      expect(problems.props('option').series).toEqual([
        expect.objectContaining({ name: '问题数', data: [2, 1] }),
        expect.objectContaining({ name: '未结束', data: [2, 1] }),
      ])
      expect(series(problems.props('option'))[0]!.stack).toBeUndefined()
      materials.vm.$emit('select', { dataIndex: 0, seriesIndex: 0 })
      expect(wrapper.emitted('team')).toBeUndefined()
      expect(problems.props('option').xAxis).toMatchObject({ minInterval: 1 })
    } finally {
      wrapper.unmount()
    }
  })
  it('uses one empty state and restores only charts with relevant data', async () => {
    const data = performanceFixture()
    data.quality = { materials: [], groups: [], trend: [] }
    data.issues.problems = []
    data.issues.teams = []
    const wrapper = mount(FactoryPerformanceCharts, {
      props: {
        data,
        scene: 'quality',
        metric: 'quantity',
        basis: { kind: 'patrol', scope: 'sample', phase: 'first' },
        motion: false,
      },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      expect(wrapper.findAllComponents(LedgerChart)).toHaveLength(0)
      expect(wrapper.text()).toContain('当前范围暂无检查记录或质量问题')
      await wrapper.setProps({
        data: {
          ...data,
          issues: { ...data.issues, problems: performanceFixture().issues.problems },
        },
      })
      expect(wrapper.findAllComponents(LedgerChart)).toHaveLength(1)
      expect(wrapper.getComponent(LedgerChart).props('label')).toBe('检出问题分类')
      expect(wrapper.text()).not.toContain('当前范围暂无检查记录或质量问题')
    } finally {
      wrapper.unmount()
    }
  })
})

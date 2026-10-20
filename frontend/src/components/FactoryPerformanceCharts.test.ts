// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import type { EChartsCoreOption } from 'echarts/core'
import { describe, expect, it } from 'vitest'
import FactoryPerformanceCharts from './FactoryPerformanceCharts.vue'
import LedgerChart from './LedgerChart.vue'
import { performanceFixture } from '@/testFixtures/factoryPerformance'

function series(option: EChartsCoreOption) {
  return option.series as { data: unknown[]; stack?: string }[]
}

describe('production and quality chart meanings', () => {
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
      expect(wrapper.text()).toContain('仅当前班组、流水号和任务')
      expect(wrapper.text()).not.toContain('班组完成量')
      const chart = wrapper.getComponent(LedgerChart)
      expect(chart.props('option').series).toEqual([
        expect.objectContaining({ name: '正常加工', data: [110, 0] }),
        expect.objectContaining({ name: '返工', data: [30, 0] }),
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
      expect(series(charts[0]!.props('option'))[0]!.data).toEqual([90, 50])
      expect(charts[0]!.props('option').yAxis).toMatchObject({ data: ['W80', '铜铝'] })
      expect(series(charts[1]!.props('option'))[0]!).toMatchObject({
        name: 'W80',
        showSymbol: true,
        data: [90, null],
        connectNulls: false,
      })
      expect(charts[2]!.props('option').series).toEqual([
        expect.objectContaining({ name: '问题数', data: [2, 1] }),
        expect.objectContaining({ name: '未结束', data: [2, 1] }),
      ])
      expect(series(charts[2]!.props('option'))[0]!.stack).toBeUndefined()
      charts[0]!.vm.$emit('select', { dataIndex: 0, seriesIndex: 0 })
      expect(wrapper.emitted('team')).toBeUndefined()
      expect(charts[2]!.props('option').xAxis).toMatchObject({ minInterval: 1 })
    } finally {
      wrapper.unmount()
    }
  })
})

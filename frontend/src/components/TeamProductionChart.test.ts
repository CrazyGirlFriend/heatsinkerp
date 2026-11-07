// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TeamProductionChart from './TeamProductionChart.vue'
import LedgerChart from './LedgerChart.vue'
import { productionFixture } from '@/testFixtures/factoryPerformance'

it('preserves each team’s quantities and weights, including zero output, and selects its team id', async () => {
  const wrapper = mount(TeamProductionChart, {
    props: {
      rows: [
        { ...productionFixture(), team_id: 2, team_name: '轧制' },
        {
          ...productionFixture(),
          team_id: 3,
          team_name: '研磨',
          completed_quantity: 0,
          completed_weight: 0,
          rework_quantity: 0,
          rework_weight: 0,
        },
      ],
      metric: 'quantity',
      motion: false,
    },
    global: { stubs: { LedgerChart: true } },
  })
  try {
    const chart = wrapper.getComponent(LedgerChart)
    expect(chart.props('option').yAxis).toMatchObject({ data: ['轧制', '研磨'] })
    expect(chart.props('option').series).toEqual([
      expect.objectContaining({
        name: '正常加工',
        data: [110, 0],
        label: expect.objectContaining({ show: true }),
      }),
      expect.objectContaining({ name: '返工', data: [30, 0] }),
    ])
    expect(chart.props('empty')).toBe(false)
    chart.vm.$emit('select', { dataIndex: 1, seriesIndex: 1 })
    expect(wrapper.emitted('select')).toEqual([[3]])
    await wrapper.setProps({ metric: 'weight' })
    expect(chart.props('option').series).toEqual([
      expect.objectContaining({ name: '正常加工', data: [11, 0] }),
      expect.objectContaining({ name: '返工', data: [3, 0] }),
    ])
    expect(chart.props('label')).toContain('kg')
    await wrapper.setProps({ rows: [] })
    expect(chart.props('empty')).toBe(true)
  } finally {
    wrapper.unmount()
  }
})

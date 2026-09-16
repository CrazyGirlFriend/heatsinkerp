// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TeamAnalyticsCharts from './TeamAnalyticsCharts.vue'
import LedgerChart from './LedgerChart.vue'
import { analyticsFixture } from '@/testFixtures/materialAnalytics'
describe('meaningful chart selection', () => {
  it('renders six distinct charts and maps clicks to serial-level filters', () => {
    const wrapper = mount(TeamAnalyticsCharts, { props: { data: analyticsFixture(), metric: 'weight' }, global: { stubs: { LedgerChart: true } } })
    try {
      expect(wrapper.findAll('.analytics-card')).toHaveLength(6)
      const charts = wrapper.findAllComponents(LedgerChart)
      expect(charts[0]!.props('option').textStyle).toMatchObject({ fontFamily: 'HeatSink Han, sans-serif', fontSize: 14 })
      charts[0]!.vm.$emit('select', { dataIndex: 0, seriesIndex: 1 })
      charts[3]!.vm.$emit('select', { dataIndex: 0, seriesIndex: 0 })
      charts[4]!.vm.$emit('select', { dataIndex: 0, seriesIndex: 1 })
      expect(wrapper.emitted('filter')?.map(args => args[0])).toEqual([
        { activity_day: '2026-09-12', activity_kind: 'outgoing' }, { stock_age: 'ge7' }, { waiting_direction: 'outgoing', waiting_age: 'ge7' },
      ])
    } finally { wrapper.unmount() }
  })
  it('keeps external outbound destinations separate from internal teams', () => {
    const wrapper = mount(TeamAnalyticsCharts, { props: { data: analyticsFixture(), metric: 'quantity', mode: 'peers' }, global: { stubs: { LedgerChart: true } } })
    try {
      expect(wrapper.findAll('.analytics-card')).toHaveLength(2)
      wrapper.findAllComponents(LedgerChart)[1]!.vm.$emit('select', { dataIndex: 0, seriesIndex: 0 })
      expect(wrapper.emitted('filter')?.[0]?.[0]).toEqual({ flow_direction: 'outgoing', peer: 'warehouse_outbound' })
    } finally { wrapper.unmount() }
  })
})

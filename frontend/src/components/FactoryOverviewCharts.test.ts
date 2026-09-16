// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FactoryOverviewCharts from './FactoryOverviewCharts.vue'
import LedgerChart from './LedgerChart.vue'
import { factoryFixture } from '@/testFixtures/factoryOverview'

describe('factory screen charts', () => {
  it('uses readable canvas fonts and excludes internal flow from factory receipts', async () => {
    const wrapper = mount(FactoryOverviewCharts, { props: { data: factoryFixture(), metric: 'weight', dark: true }, global: { stubs: { LedgerChart: true } } })
    try {
      const charts = wrapper.findAllComponents(LedgerChart)
      expect(charts).toHaveLength(3)
      expect(charts[0]!.props('option').series).toEqual([
        expect.objectContaining({ name: '当前库存', data: Array(8).fill(2.8) }),
      ])
      expect(wrapper.text()).toContain('不含内部在途')
      expect(charts[0]!.props('option').textStyle).toMatchObject({ fontFamily: 'system-ui, sans-serif', fontSize: 14 })
      expect(charts[1]!.props('option').series).toEqual([
        expect.objectContaining({ name: '库房入库', data: [10] }),
        expect.objectContaining({ name: '库房对外出库' }),
        expect.objectContaining({ name: '检验发货' }),
      ])
      await wrapper.setProps({ metric: 'quantity', dark: false })
      expect(charts[1]!.props('option').series).toEqual(expect.arrayContaining([expect.objectContaining({ name: '库房入库', data: [100] })]))
      expect(charts[0]!.props('option')).toMatchObject({ textStyle: { fontSize: 14, fontFamily: 'HeatSink Han, sans-serif' } })
    } finally { wrapper.unmount() }
  })
  it('separates stock and handoff scenes and rotates readable point summaries', async () => {
    const wrapper = mount(FactoryOverviewCharts, { props: { data: factoryFixture(), metric: 'weight', dark: true, scene: 'stock', focusIndex: 0 }, global: { stubs: { LedgerChart: true } } })
    try {
      expect(wrapper.findAll('.factory-chart')).toHaveLength(3)
      expect(wrapper.text()).toContain('流水号库存排行')
      expect(wrapper.text()).toContain('SERIAL-001')
      expect(wrapper.text()).toContain('100 件')
      expect(wrapper.text()).not.toContain('全厂对外收发')
      expect(wrapper.findAllComponents(LedgerChart)[0]!.props('highlightIndex')).toBe(0)
      await wrapper.setProps({ scene: 'handoff' })
      expect(wrapper.text()).toContain('待交接时长')
      expect(wrapper.text()).toContain('对外出库与发货')
      expect(wrapper.text()).not.toContain('流水号库存排行')
    } finally { wrapper.unmount() }
  })
  it('opens only a configured active team and does not treat other charts as teams', () => {
    const data = factoryFixture()
    data.teams[0]!.active = false
    data.teams[1]!.id = null
    data.teams[2]!.id = 914
    const wrapper = mount(FactoryOverviewCharts, { props: { data, metric: 'weight', dark: false }, global: { stubs: { LedgerChart: true } } })
    try {
      const charts = wrapper.findAllComponents(LedgerChart)
      for (const dataIndex of [0, 1, 2]) charts[0]!.vm.$emit('select', { dataIndex, seriesIndex: 0 })
      charts[1]!.vm.$emit('select', { dataIndex: 2, seriesIndex: 0 })
      expect(wrapper.emitted('team')).toEqual([[data.teams[2]]])
    } finally { wrapper.unmount() }
  })
})

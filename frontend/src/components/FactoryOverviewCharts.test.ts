// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FactoryOverviewCharts from './FactoryOverviewCharts.vue'
import LedgerChart from './LedgerChart.vue'
import DashboardCard from './DashboardCard.vue'
import DashboardDistribution from './DashboardDistribution.vue'
import { factoryFixture } from '@/testFixtures/factoryOverview'

describe('factory analysis charts', () => {
  it('uses readable canvas fonts and excludes internal flow from factory receipts', async () => {
    const wrapper = mount(FactoryOverviewCharts, {
      props: { data: factoryFixture(), metric: 'weight' },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      const charts = wrapper.findAllComponents(LedgerChart)
      expect(charts).toHaveLength(2)
      expect(charts[0]!.props('option').series).toEqual([
        expect.objectContaining({ name: '未转出库存', data: Array(8).fill(2.8) }),
      ])
      expect(wrapper.findAllComponents(DashboardCard)[0]!.props('help')).toContain('未转出库存')
      expect(wrapper.text()).not.toContain('不含内部在途')
      expect(charts[0]!.props('option').textStyle).toMatchObject({
        fontFamily: 'HeatSink Inter, PingFang SC, Microsoft YaHei, sans-serif',
        fontSize: 12,
      })
      expect(charts[1]!.props('option').series).toEqual([
        expect.objectContaining({ name: '库房入库', data: [10] }),
        expect.objectContaining({ name: '库房对外出库' }),
        expect.objectContaining({ name: '检验发货' }),
      ])
      await wrapper.setProps({ metric: 'quantity' })
      expect(charts[1]!.props('option').series).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: '库房入库', data: [100] })]),
      )
      expect(charts[0]!.props('option')).toMatchObject({
        textStyle: {
          fontSize: 12,
          fontFamily: 'HeatSink Inter, PingFang SC, Microsoft YaHei, sans-serif',
        },
      })
    } finally {
      wrapper.unmount()
    }
  })
  it('separates stock and handoff analysis charts', async () => {
    const wrapper = mount(FactoryOverviewCharts, {
      props: { data: factoryFixture(), metric: 'weight', scene: 'stock' },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      expect(wrapper.findAll('.factory-chart')).toHaveLength(2)
      expect(wrapper.text()).toContain('流水号库存排行')
      expect(wrapper.text()).toContain('材质库存排行')
      expect(wrapper.text()).not.toContain('库存停留')
      expect(wrapper.text()).not.toContain('全厂对外收发')
      await wrapper.setProps({ scene: 'handoff' })
      expect(wrapper.text()).toContain('待交接时长')
      expect(wrapper.text()).toContain('对外出库与发货')
      expect(wrapper.text()).not.toContain('流水号库存排行')
    } finally {
      wrapper.unmount()
    }
  })
  it('keeps material values and shares in sync with the selected unit and exposes corrections', async () => {
    const data = factoryFixture()
    data.material_types = [
      { key: 'finished', quantity: 1200, weight: 345.678 },
      { key: 'sludge', quantity: 0, weight: 8.5 },
      { key: 'unknown', quantity: 2, weight: 0 },
    ]
    const wrapper = mount(FactoryOverviewCharts, {
      props: { data, metric: 'weight' },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      const distribution = wrapper.getComponent(DashboardDistribution)
      const values = () =>
        distribution
          .findAll('.distribution-row')
          .map((row) => [
            row.get('.distribution-label').text(),
            row.get('strong').text().replace(/\s+/g, ' '),
          ])
      const expected = [
        ['成品', '345.678 kg'],
        ['废泥', '8.5 kg'],
        ['未填写性质', '0 kg'],
      ]
      expect(values()).toEqual(expected)
      expect(distribution.props('rows').map((row) => row.value)).toEqual([345.678, 8.5, 0])
      await wrapper.setProps({ metric: 'quantity' })
      expect(values()).toEqual([
        ['成品', '1,200 件'],
        ['废泥', '0 件'],
        ['未填写性质', '2 件'],
      ])
      expect(distribution.get('.distribution-total').text()).toContain('1,202')
      await wrapper.setProps({ metric: 'weight' })
      expect(values()).toEqual(expected)
      await wrapper.setProps({
        data: { ...data, material_types: [{ key: 'finished', quantity: 1, weight: -2 }] },
      })
      expect(distribution.get('.has-correction').text()).toContain('-2 kg')
      expect(distribution.get('.has-correction').text()).toContain('数据差异')
      expect(distribution.get('.distribution-track i').attributes('style')).toContain('width: 0%')
    } finally {
      wrapper.unmount()
    }
  })
  it('opens only a configured active team and does not treat other charts as teams', () => {
    const data = factoryFixture()
    data.teams[0]!.active = false
    data.teams[1]!.id = null
    data.teams[2]!.id = 914
    const wrapper = mount(FactoryOverviewCharts, {
      props: { data, metric: 'weight' },
      global: { stubs: { LedgerChart: true } },
    })
    try {
      const charts = wrapper.findAllComponents(LedgerChart)
      for (const dataIndex of [0, 1, 2])
        charts[0]!.vm.$emit('select', { dataIndex, seriesIndex: 0 })
      charts[1]!.vm.$emit('select', { dataIndex: 2, seriesIndex: 0 })
      expect(wrapper.emitted('team')).toEqual([[data.teams[2]]])
    } finally {
      wrapper.unmount()
    }
  })
})

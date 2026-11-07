// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import DashboardDonut from './DashboardDonut.vue'
import LedgerChart from './LedgerChart.vue'

it('keeps empty and negative data honest and selects a real slice by its business key', async () => {
  const wrapper = mount(DashboardDonut, {
    props: {
      rows: [{ key: 'complete', label: '已加工', value: 0, color: '#36a58a' }],
      unit: '件',
      label: '加工状态',
      selectable: true,
      motion: true,
    },
    global: { stubs: { LedgerChart: true } },
  })
  try {
    const chart = wrapper.getComponent(LedgerChart)
    expect(wrapper.text()).toContain('暂无数据')
    chart.vm.$emit('select', { dataIndex: 0 })
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.setProps({
      rows: [{ key: 'complete', label: '已加工', value: 12, color: '#36a58a' }],
    })
    chart.vm.$emit('select', { dataIndex: 0 })
    expect(wrapper.emitted('select')).toEqual([['complete']])
    expect(chart.props('option').series).toEqual([
      expect.objectContaining({ data: [expect.objectContaining({ value: 12 })] }),
    ])
    await wrapper.setProps({
      rows: [{ key: 'complete', label: '已加工', value: -2, color: '#36a58a' }],
    })
    expect(wrapper.text()).toContain('数据差异')
    chart.vm.$emit('select', { dataIndex: 0 })
    expect(wrapper.emitted('select')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})

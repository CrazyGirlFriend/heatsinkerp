// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import { ElTooltip } from 'element-plus'

describe('processing stock meaning', () => {
  it('keeps a compact status and accessible weight warning with quantities in its tooltip', () => {
    const wrapper = mount(ProcessingStockStatus, {
      props: {
        compact: true,
        state: 'partial',
        summary: {
          processing_registered_batch_count: 1,
          processing_registered_quantity: 12,
          max_weight_difference: 2,
        },
      },
    })
    expect(wrapper.text()).toBe('部分加工')
    expect(wrapper.find('small').exists()).toBe(false)
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toContain('差异超 1 kg')
    expect(wrapper.getComponent(ElTooltip).props('content')).toContain('12 件')
    expect(wrapper.getComponent(ElTooltip).props('content')).toContain('差异超 1 kg')
    wrapper.unmount()
  })
  it('flags a same-source cumulative difference only when the largest absolute root value exceeds one kg', async () => {
    const wrapper = mount(ProcessingStockStatus, {
      props: { state: 'partial', summary: { max_weight_difference: 1 } },
    })
    expect(wrapper.find('.processing-weight-warning').exists()).toBe(false)
    await wrapper.setProps({ summary: { max_weight_difference: 1.000001 } })
    expect(wrapper.get('.processing-weight-warning').text()).toContain('累计差异超 1 kg')
    wrapper.unmount()
  })
  it('labels twelve remaining pieces as registered processing, without calling them finished', () => {
    const wrapper = mount(ProcessingStockStatus, {
      props: {
        materialType: 'semi_finished',
        summary: {
          processing_registered_batch_count: 1,
          processing_unregistered_batch_count: 0,
          processing_registered_quantity: 12,
          processing_registered_weight: 60,
          processing_unregistered_quantity: 0,
          processing_unregistered_weight: 0,
        },
      },
    })
    expect(wrapper.text()).toContain('有加工记录 · 进度未标明')
    expect(wrapper.text()).toContain('未转出 12 件')
    expect(wrapper.text()).not.toContain('成品')
    wrapper.unmount()
  })
  it('keeps mixed source batches and waste separate', () => {
    const wrapper = mount(ProcessingStockStatus, {
      props: {
        materialType: 'semi_finished',
        summary: {
          processing_registered_batch_count: 1,
          processing_unregistered_batch_count: 1,
          processing_registered_quantity: 12,
          processing_unregistered_quantity: 1,
        },
      },
    })
    expect(wrapper.text()).toContain('部分批次有加工记录')
    wrapper.unmount()
    const scrap = mount(ProcessingStockStatus, {
      props: { materialType: 'scrap_chips', summary: {} },
    })
    expect(scrap.text()).toBe('—')
    scrap.unmount()
  })
  it.each(['waste', 'sludge', 'scrap_chips'] as const)(
    'does not show processing progress for %s',
    (materialType) => {
      const wrapper = mount(ProcessingStockStatus, {
        props: {
          materialType,
          state: 'complete',
          summary: { processing_registered_batch_count: 1, processing_unregistered_batch_count: 1 },
        },
      })
      expect(wrapper.text()).toBe('—')
      expect(wrapper.find('.el-tag').exists()).toBe(false)
      wrapper.unmount()
    },
  )
  it.each([
    ['partial', '部分加工'],
    ['complete', '本批加工完成'],
    ['unregistered', '未登记加工'],
    ['pending', '已转出 · 待签收'],
    ['cleared', '无未转出库存'],
  ] as const)('uses the actual stock state %s', (state, label) => {
    const wrapper = mount(ProcessingStockStatus, { props: { state } })
    expect(wrapper.text()).toBe(label)
    wrapper.unmount()
  })
})

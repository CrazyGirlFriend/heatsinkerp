// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProcessingStockStatus from './ProcessingStockStatus.vue'

describe('processing stock meaning', () => {
  it('labels twelve remaining pieces as registered processing, without calling them finished', () => {
    const wrapper = mount(ProcessingStockStatus, { props: { materialType: 'semi_finished', summary: {
      processing_registered_batch_count: 1, processing_unregistered_batch_count: 0,
      processing_registered_quantity: 12, processing_registered_weight: 60,
      processing_unregistered_quantity: 0, processing_unregistered_weight: 0,
    } } })
    expect(wrapper.text()).toContain('有加工记录 · 进度未标明')
    expect(wrapper.text()).toContain('未转出 12 件')
    expect(wrapper.text()).not.toContain('成品')
    wrapper.unmount()
  })
  it('keeps mixed source batches and waste separate', () => {
    const wrapper = mount(ProcessingStockStatus, { props: { materialType: 'semi_finished', summary: {
      processing_registered_batch_count: 1, processing_unregistered_batch_count: 1,
      processing_registered_quantity: 12, processing_unregistered_quantity: 1,
    } } })
    expect(wrapper.text()).toContain('部分批次有加工记录')
    wrapper.unmount()
    const scrap = mount(ProcessingStockStatus, { props: { materialType: 'scrap_chips', summary: {} } })
    expect(scrap.text()).toBe('废料另计')
    scrap.unmount()
  })
  it.each([['partial', '部分加工'], ['complete', '本批加工完成'], ['unregistered', '未登记加工'], ['pending', '已转出 · 待签收'], ['cleared', '无未转出库存']] as const)('uses the actual stock state %s', (state, label) => {
    const wrapper = mount(ProcessingStockStatus, { props: { state } })
    expect(wrapper.text()).toBe(label)
    wrapper.unmount()
  })
})

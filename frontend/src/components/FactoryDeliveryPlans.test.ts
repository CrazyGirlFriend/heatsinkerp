// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import FactoryDeliveryPlans from './FactoryDeliveryPlans.vue'
import { factoryDashboardApi } from '@/services/factoryDashboardApi'
afterEach(() => vi.restoreAllMocks())
it('shows read-only delivery results and links the original document without a separate plan editor', async () => {
  vi.spyOn(factoryDashboardApi, 'deliveries').mockResolvedValue({
    items: [
      {
        serial_no: 'SERIAL-1',
        index: 0,
        label: 'TL20260927000001',
        source_batch_no: 'TL20260927000001',
        due_date: '2026-10-01',
        quantity: 80,
        shipped: 20,
        remaining: 60,
        completed_on: null,
        status: 'pending',
        overdue_days: 0,
      },
    ],
    total: 1,
    page: 1,
    page_size: 30,
  })
  const wrapper = mount(FactoryDeliveryPlans, {
    global: {
      directives: { loading: {} },
      stubs: { ElDialog: { template: '<div><slot/></div>' }, MaterialTransferDrawer: true },
    },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('2026-10-01')
    expect(wrapper.text()).not.toContain('设置交付计划')
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'TL20260927000001')!
      .trigger('click')
    expect(wrapper.getComponent({ name: 'MaterialTransferDrawer' }).props()).toMatchObject({
      modelValue: true,
      batchNo: 'TL20260927000001',
    })
  } finally {
    wrapper.unmount()
  }
})

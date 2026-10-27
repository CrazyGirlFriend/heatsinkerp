// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
let wrapper: VueWrapper
const context = {
  source_transfer_id: 12,
  batch_no: 'TL12',
  quantity: 10,
  weight: 100,
  revision: 4,
  as_of: '2026-10-24T00:00:00Z',
  rework_of_id: 8,
  rework_task_records: [],
  items: [],
  total: 0,
  page: 1,
  page_size: 10,
} as QuantityAdjustmentContext
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
it('submits a scoped request without creating a processing record and retains the key for uncertain retries', async () => {
  const request = vi
    .spyOn(processRouteApi, 'requestRework')
    .mockRejectedValue(new Error('网络中断'))
  wrapper = mount(ReworkRouteRequest, { props: { context, inspectionId: 19 } })
  await wrapper.get('form').trigger('submit')
  expect(request).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(wrapper.text()).toContain('请填写问题描述'))
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('尺寸偏大')
  await wrapper.get('input[aria-label="返工件数"]').setValue('4')
  await wrapper.get('input[aria-label="返工重量"]').setValue('40')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      source_transfer_id: 12,
      inspection_id: 19,
      rework_of_id: 8,
      quantity: 4,
      weight: 40,
      expected_revision: 4,
      reason: '尺寸偏大',
    }),
  )
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(request.mock.calls[0]![0].idempotency_key).toBe(request.mock.calls[1]![0].idempotency_key)
  expect(wrapper.emitted('changed')).toBeUndefined()
})
it('accepts integral and fractional weights in native browser validation', async () => {
  wrapper = mount(ReworkRouteRequest, { props: { context, inspectionId: 19 } })
  const input = wrapper.get<HTMLInputElement>('input[aria-label="返工重量"]')
  for (const value of ['10', '0.000002', '12.345678']) {
    await input.setValue(value)
    expect(input.element.validity.stepMismatch).toBe(false)
  }
})

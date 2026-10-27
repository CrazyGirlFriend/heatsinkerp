// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ReworkProblemDialog from './ReworkProblemDialog.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
it('searches real batches and passes the selected revision and work records to direct submission', async () => {
  vi.spyOn(processRouteApi, 'reworkSources').mockResolvedValue({
    items: [{ id: 42, serial_no: 'S1', batch_no: 'TL42', quantity: 2, weight: 10 }],
    total: 1,
    page: 1,
    page_size: 10,
  })
  const context = {
    source_transfer_id: 42,
    serial_no: 'S1',
    batch_no: 'TL42',
    quantity: 2,
    weight: 10,
    revision: 7,
    rework_task_records: [{ rework_of_id: 11, process_step_name: '精磨' }],
  } as QuantityAdjustmentContext
  vi.spyOn(processRouteApi, 'reworkSourceContext').mockResolvedValue(context)
  wrapper = mount(ReworkProblemDialog, {
    global: {
      stubs: { AppDialog: { template: '<section><slot /></section>' }, ReworkRouteRequest: true },
    },
  })
  await flushPromises()
  await wrapper.get('input[aria-label="返工批次搜索"]').setValue(' S1 ')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(processRouteApi.reworkSources).toHaveBeenLastCalledWith('S1', 1)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择')!
    .trigger('click')
  await flushPromises()
  expect(processRouteApi.reworkSourceContext).toHaveBeenCalledWith(42)
  expect(wrapper.getComponent(ReworkRouteRequest).props('context')).toEqual(context)
  expect(wrapper.getComponent(ReworkRouteRequest).props('inspectionId')).toBeUndefined()
  wrapper.getComponent(ReworkRouteRequest).vm.$emit('changed')
  expect(wrapper.emitted('submitted')).toHaveLength(1)
})

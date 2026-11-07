// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import TeamReworkRequestDialog from './TeamReworkRequestDialog.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import AppDialog from './AppDialog.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  vi.spyOn(processRouteApi, 'reworkSources').mockResolvedValue({
    items: [{ id: 12, serial_no: 'S-001', batch_no: 'TL12', quantity: 10, weight: 100 }],
    page: 1,
    page_size: 10,
    total: 1,
  })
  vi.spyOn(processRouteApi, 'reworkSourceContext').mockResolvedValue({
    source_transfer_id: 12,
    batch_no: 'TL12',
    quantity: 10,
    weight: 100,
    revision: 2,
    rework_of_id: 9,
    rework_task_records: [{ rework_of_id: 9, process_step_name: '研磨' }],
  } as QuantityAdjustmentContext)
  wrapper = mount(TeamReworkRequestDialog, {
    global: {
      stubs: {
        AppDialog: { props: ['modelValue'], template: '<div><slot/></div>' },
      },
    },
  })
  await flushPromises()
}
it('submits the selected local batch without an inspection and closes after success', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework').mockResolvedValue(reworkRouteFixture)
  await render()
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '选择')!
    .trigger('click')
  await flushPromises()
  expect(processRouteApi.reworkSourceContext).toHaveBeenCalledWith(12)
  expect(wrapper.getComponent(ReworkRouteRequest).props('inspectionId')).toBeUndefined()
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('表面划伤')
  await wrapper.get('input[aria-label="返工件数"]').setValue('2')
  await wrapper.get('input[aria-label="返工重量"]').setValue('20')
  await wrapper.getComponent(ReworkRouteRequest).get('form').trigger('submit')
  await flushPromises()
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      source_transfer_id: 12,
      rework_of_id: 9,
      inspection_id: undefined,
      quantity: 2,
      weight: 20,
    }),
  )
  expect(wrapper.emitted('saved')).toHaveLength(1)
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
})
it('keeps the request open after a stock conflict and clears context when reloading', async () => {
  await render()
  vi.mocked(processRouteApi.reworkSourceContext).mockRejectedValue(new Error('库存已变化'))
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '选择')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('库存已变化')
  expect(wrapper.findComponent(ReworkRouteRequest).exists()).toBe(false)
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(true)
})

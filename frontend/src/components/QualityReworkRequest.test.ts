// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import QualityReworkRequest from './QualityReworkRequest.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import { qualityFeedbackApi, type QualityFeedbackDetail } from '@/services/qualityFeedbackApi'
import { processRouteApi } from '@/services/processRouteApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
import { reworkRouteFixture } from '@/testFixtures/processRoute'

const issue = {
  id: 19,
  decision_notes: '划伤，需要返工',
  notes: '',
  problems: [{ id: 1, name: '划伤' }],
} as QualityFeedbackDetail
const stock = {
  id: 12,
  batch_no: 'TL12',
  serial_no: 'S-001',
  team_name: '研磨',
  quantity: 10,
  weight: 100,
}
const context = {
  source_transfer_id: 12,
  batch_no: 'TL12',
  quantity: 10,
  weight: 100,
  revision: 9,
  rework_of_id: 8,
  rework_task_records: [],
  items: [],
  total: 0,
} as unknown as QuantityAdjustmentContext
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  vi.spyOn(qualityFeedbackApi, 'reworkStock').mockResolvedValue({ items: [stock], total: 21 })
  vi.spyOn(qualityFeedbackApi, 'reworkContext').mockResolvedValue(context)
  wrapper = mount(QualityReworkRequest, { props: { issue } })
  await flushPromises()
}
it('binds the quality issue and real lot while requiring explicit rework amounts', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework').mockResolvedValue(reworkRouteFixture)
  await render()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择')!
    .trigger('click')
  await flushPromises()
  expect(qualityFeedbackApi.reworkContext).toHaveBeenCalledWith(19, 12)
  expect(wrapper.getComponent(ReworkRouteRequest).props()).toMatchObject({
    inspectionId: 19,
    initialReason: '划伤，需要返工',
  })
  expect(wrapper.find('[aria-label="关联质量问题"]').exists()).toBe(false)
  await wrapper.get('form').trigger('submit')
  expect(request).not.toHaveBeenCalled()
  await wrapper.get('input[aria-label="返工件数"]').setValue('4')
  await wrapper.get('input[aria-label="返工重量"]').setValue('40')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      inspection_id: 19,
      source_transfer_id: 12,
      rework_of_id: 8,
      expected_revision: 9,
      quantity: 4,
      weight: 40,
    }),
  )
  expect(wrapper.text()).toContain('已提交工艺')
  expect(wrapper.emitted('changed')).toHaveLength(1)
  expect(wrapper.findComponent(ReworkRouteRequest).exists()).toBe(false)
})
it('discards unavailable stock context and pages the server-side candidate list', async () => {
  await render()
  vi.mocked(qualityFeedbackApi.reworkContext).mockRejectedValue(new Error('库存已变化'))
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('库存已变化')
  expect(wrapper.findComponent(ReworkRouteRequest).exists()).toBe(false)
  const { ElPagination } = await import('element-plus')
  wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
  await flushPromises()
  expect(qualityFeedbackApi.reworkStock).toHaveBeenLastCalledWith(19, 2)
})

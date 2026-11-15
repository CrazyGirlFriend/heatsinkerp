// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { ElOption, ElSelect } from 'element-plus'
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
  await wrapper.get('input[aria-label="问题件数"]').setValue('4')
  await wrapper.get('input[aria-label="问题重量"]').setValue('40')
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
  const input = wrapper.get<HTMLInputElement>('input[aria-label="问题重量"]')
  for (const value of ['10', '0.000002', '12.345678']) {
    await input.setValue(value)
    expect(input.element.validity.stepMismatch).toBe(false)
  }
})

it('shows complete operation details and distinguishes repeated work without internal record IDs', async () => {
  const first = {
    rework_of_id: 201,
    team_id: 3,
    team_name: '轧制',
    process_step_name: '第 4 道工序 · 精轧',
    process_step_instructions: '精轧至 2.50±0.01 mm，表面不得有压痕。\n完成后清洗并检查厚度。',
    processing_task_id: 7,
    processing_task_name: '精轧',
    purpose_id: null,
    purpose_name: null,
    processing_date: '2026-11-15',
    processor_name: '张师傅、李师傅',
    completed_quantity: 288,
    work_kind: 'initial' as const,
    rework_round: 0,
  }
  const second = {
    ...first,
    rework_of_id: 202,
    process_step_name: '第 6 道工序 · 复轧',
    process_step_instructions: '复轧至 2.40±0.01 mm，不得压伤。',
    processing_date: '2026-11-16',
    completed_quantity: 12,
    work_kind: 'rework' as const,
    rework_round: 2,
  }
  wrapper = mount(ReworkRouteRequest, {
    props: {
      context: { ...context, rework_of_id: 201, rework_task_records: [first, second] },
    },
  })
  const detail = () => wrapper.get('.work-record-detail').text()
  expect(wrapper.text()).toContain('工艺记录')
  expect(wrapper.text()).not.toContain('原加工记录')
  expect(detail()).toContain('轧制 · 第 4 道工序 · 精轧')
  expect(detail()).toContain(first.process_step_instructions)
  expect(detail()).toContain('2026-11-15 · 张师傅、李师傅 · 已加工 288 件')
  expect(detail()).toContain('正常加工')
  expect(
    wrapper
      .findAllComponents(ElOption)
      .map((option) => option.props('label'))
      .join(' '),
  ).not.toMatch(/#201|#202/)
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 202)
  await flushPromises()
  expect(detail()).toContain('第 6 道工序 · 复轧')
  expect(detail()).toContain(second.process_step_instructions)
  expect(detail()).toContain('第 2 轮返工')
  expect(detail()).toContain('2026-11-16 · 张师傅、李师傅 · 已加工 12 件')
  expect(detail()).not.toContain(first.process_step_instructions)
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { ElSelect } from 'element-plus'
import TeamReworkRequestDialog from './TeamReworkRequestDialog.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import AppDialog from './AppDialog.vue'
import AppSelect from './AppSelect.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

const sources = [
  { id: 12, serial_no: 'S-001', batch_no: 'TL12', quantity: 10, weight: 100 },
  { id: 13, serial_no: 'S-001', batch_no: 'TL13', quantity: 5, weight: 50 },
]
const context = {
  source_transfer_id: 12,
  batch_no: 'TL12',
  quantity: 10,
  weight: 100,
  revision: 2,
  rework_of_id: 9,
  rework_task_records: [{ rework_of_id: 9, process_step_name: '研磨' }],
} as QuantityAdjustmentContext
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(teamId?: number) {
  vi.spyOn(processRouteApi, 'reworkSources').mockResolvedValue({
    items: sources,
    page: 1,
    page_size: 10,
    total: 2,
  })
  vi.spyOn(processRouteApi, 'reworkSourceContext').mockResolvedValue(context)
  wrapper = mount(TeamReworkRequestDialog, {
    props: { teamId },
    global: {
      stubs: {
        AppDialog: { props: ['modelValue', 'title'], template: '<div><slot/></div>' },
      },
    },
  })
  await flushPromises()
}
async function selectBatch(id?: number) {
  wrapper.getComponent(ElSelect).vm.$emit('change', id)
  await flushPromises()
}
it('opens the complete problem form without selecting a batch or showing a separate table', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework')
  await render()
  expect(wrapper.getComponent(AppDialog).props()).toMatchObject({ title: '提交问题' })
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.find('textarea[aria-label="问题描述"]').exists()).toBe(true)
  expect(wrapper.get('input[aria-label="问题件数"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('input[aria-label="问题重量"]').attributes('disabled')).toBeDefined()
  expect(processRouteApi.reworkSourceContext).not.toHaveBeenCalled()
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('表面划伤')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.text()).toContain('请选择问题批次'))
  expect(request).not.toHaveBeenCalled()
})
it('submits the selected local batch without an inspection and closes after success', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework').mockResolvedValue(reworkRouteFixture)
  await render()
  await selectBatch(12)
  expect(processRouteApi.reworkSourceContext).toHaveBeenCalledWith(12)
  expect(wrapper.getComponent(ReworkRouteRequest).props('inspectionId')).toBeUndefined()
  expect(wrapper.text()).toContain('在库 10 件 · 100 kg')
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('表面划伤')
  await wrapper.get('input[aria-label="问题件数"]').setValue('2')
  await wrapper.get('input[aria-label="问题重量"]').setValue('20')
  await wrapper.get('form').trigger('submit')
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
it('keeps the full form and typed problem after a batch read fails, and permits retry', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework')
  await render()
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('表面划伤')
  vi.mocked(processRouteApi.reworkSourceContext).mockRejectedValueOnce(new Error('库存已变化'))
  await selectBatch(12)
  expect(wrapper.text()).toContain('库存已变化')
  expect(wrapper.findComponent(ReworkRouteRequest).exists()).toBe(true)
  expect(wrapper.get('input[aria-label="问题件数"]').attributes('disabled')).toBeDefined()
  await wrapper.get('form').trigger('submit')
  expect(request).not.toHaveBeenCalled()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '重试')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ReworkRouteRequest).props('context')).toEqual(context)
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('表面划伤')
})
it('loads further batches in the selected team without losing selection or amounts', async () => {
  await render(914)
  await selectBatch(12)
  await wrapper.get('input[aria-label="问题件数"]').setValue('2')
  const select = wrapper.getComponent(ElSelect)
  await select.get('.el-select__wrapper').trigger('click')
  const nextSource = { ...sources[1]!, id: 21, batch_no: 'TL21' }
  vi.mocked(processRouteApi.reworkSources).mockResolvedValueOnce({
    items: [sources[1]!],
    page: 1,
    page_size: 10,
    total: 11,
  })
  select.props('remoteMethod')!('TL')
  await flushPromises()
  expect(processRouteApi.reworkSources).toHaveBeenLastCalledWith('TL', 1, 914)
  expect(select.props('modelValue')).toBe(12)
  expect(wrapper.get<HTMLInputElement>('input[aria-label="问题件数"]').element.value).toBe('2')
  vi.mocked(processRouteApi.reworkSources).mockResolvedValueOnce({
    items: [nextSource],
    page: 2,
    page_size: 10,
    total: 11,
  })
  const more = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '更多批次',
  )
  expect(more).toBeDefined()
  more!.click()
  await flushPromises()
  expect(processRouteApi.reworkSources).toHaveBeenLastCalledWith('TL', 2, 914)
  await selectBatch(21)
  expect(processRouteApi.reworkSourceContext).toHaveBeenLastCalledWith(21)
})
it('discards late responses and clears amounts when switching batches with the same serial', async () => {
  await render()
  await selectBatch(12)
  await wrapper.get('input[aria-label="问题件数"]').setValue('2')
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('表面划伤')
  let resolveOld!: (value: QuantityAdjustmentContext) => void
  vi.mocked(processRouteApi.reworkSourceContext)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValueOnce({
      ...context,
      source_transfer_id: 13,
      batch_no: 'TL13',
      rework_of_id: 10,
    })
  await selectBatch(12)
  expect(wrapper.get('input[aria-label="问题件数"]').attributes('disabled')).toBeDefined()
  await selectBatch(13)
  resolveOld(context)
  await flushPromises()
  expect(wrapper.getComponent(ReworkRouteRequest).props('context')?.source_transfer_id).toBe(13)
  expect(wrapper.get<HTMLInputElement>('input[aria-label="问题件数"]').element.value).toBe('')
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('表面划伤')
  await selectBatch()
  expect(wrapper.getComponent(ReworkRouteRequest).props('context')).toBeUndefined()
})
it('shows an unavailable-record warning without hiding the problem form', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework')
  await render()
  vi.mocked(processRouteApi.reworkSourceContext).mockResolvedValue({
    ...context,
    rework_of_id: null,
    rework_task_records: [],
  })
  await selectBatch(12)
  expect(wrapper.text()).toContain('本批次暂无可反馈的工艺记录')
  expect(wrapper.find('textarea[aria-label="问题描述"]').exists()).toBe(true)
  await wrapper.get('form').trigger('submit')
  expect(request).not.toHaveBeenCalled()
})

it('requires an explicit upstream team and operation, clearing stale fields when the team changes', async () => {
  const request = vi.spyOn(processRouteApi, 'requestRework').mockResolvedValue(reworkRouteFixture)
  await render()
  const local = {
    ...context,
    rework_problem_team_id: 2,
    rework_problem_teams: [
      { id: 2, name: '轧制' },
      { id: 3, name: '线切割' },
    ],
    rework_of_id: null,
    rework_task_records: [],
  }
  const upstream = {
    ...local,
    rework_problem_team_id: 3,
    rework_task_records: [
      {
        rework_of_id: 15,
        team_id: 3,
        team_name: '线切割',
        process_step_name: '第 1 道工序 · 粗切',
        process_step_instructions: '按图粗切，留磨削余量。',
        processing_task_id: 5,
        processing_task_name: '粗切',
        purpose_id: null,
        purpose_name: null,
      },
    ],
  } satisfies QuantityAdjustmentContext
  vi.mocked(processRouteApi.reworkSourceContext)
    .mockResolvedValueOnce(local)
    .mockResolvedValueOnce(upstream)
  await selectBatch(12)
  expect(wrapper.text()).toContain('该班组暂无本批次的工艺记录')
  const select = (label: string) =>
    wrapper
      .findAllComponents(AppSelect)
      .find((s) => s.vm.$attrs['aria-label'] === label)!
      .getComponent(ElSelect)
  expect(select('疑似涉及班组').props('modelValue')).toBe(2)
  await wrapper.get('textarea[aria-label="问题描述"]').setValue('来料切口有裂纹')
  select('疑似涉及班组').vm.$emit('update:modelValue', 3)
  select('疑似涉及班组').vm.$emit('change', 3)
  await flushPromises()
  expect(processRouteApi.reworkSourceContext).toHaveBeenLastCalledWith(12, 3)
  expect(select('工艺记录').props('modelValue')).toBeNull()
  select('工艺记录').vm.$emit('update:modelValue', 15)
  await flushPromises()
  expect(wrapper.text()).toContain('按图粗切，留磨削余量。')
  await wrapper.get('input[aria-label="问题件数"]').setValue('2')
  await wrapper.get('input[aria-label="问题重量"]').setValue('20')
  vi.mocked(processRouteApi.reworkSourceContext).mockResolvedValueOnce(local)
  select('疑似涉及班组').vm.$emit('update:modelValue', 2)
  select('疑似涉及班组').vm.$emit('change', 2)
  await flushPromises()
  expect(select('工艺记录').props('modelValue')).toBeNull()
  expect(wrapper.get<HTMLInputElement>('input[aria-label="问题件数"]').element.value).toBe('')
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('来料切口有裂纹')
  await wrapper.get('form').trigger('submit')
  expect(request).not.toHaveBeenCalled()
  vi.mocked(processRouteApi.reworkSourceContext).mockResolvedValueOnce(upstream)
  select('疑似涉及班组').vm.$emit('update:modelValue', 3)
  select('疑似涉及班组').vm.$emit('change', 3)
  await flushPromises()
  select('工艺记录').vm.$emit('update:modelValue', 15)
  await flushPromises()
  await wrapper.get('input[aria-label="问题件数"]').setValue('2')
  await wrapper.get('input[aria-label="问题重量"]').setValue('20')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      source_transfer_id: 12,
      problem_team_id: 3,
      rework_of_id: 15,
      reason: '来料切口有裂纹',
    }),
  )
})

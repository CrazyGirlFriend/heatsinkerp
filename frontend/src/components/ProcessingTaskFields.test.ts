// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { ElSelect } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProcessingTaskFields from './ProcessingTaskFields.vue'
import TeamBusinessDialog from './TeamBusinessDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

const route = {
  id: 8,
  title: '研磨派工',
  version: 1,
  step_index: 1,
  sequence_no: 2,
  step_name: '粗磨',
  instructions: '厚度 2.50 ±0.05 mm\n不得叠放',
  team_id: 2,
  processing_task_id: 9,
  purpose_id: 3,
  split_here: false,
  complete: false,
  available: true,
}
const context = (): QuantityAdjustmentContext => ({
  source_transfer_id: 10,
  batch_no: 'TL001',
  quantity: 10,
  weight: 100,
  revision: 0,
  as_of: '',
  items: [],
  total: 0,
  page: 1,
  page_size: 10,
  task_required: true,
  process_route: { ...route },
})
const originals = () => [
  {
    rework_of_id: 51,
    processing_task_id: 9,
    processing_task_name: '磨削',
    purpose_id: 3,
    purpose_name: '研磨业务',
    process_route_id: 8,
    process_step_index: 1,
    process_step_name: '2 · 粗磨',
    process_step_instructions: '粗磨厚度 2.50 ±0.05 mm',
  },
  {
    rework_of_id: 52,
    processing_task_id: 9,
    processing_task_name: '磨削',
    purpose_id: 3,
    purpose_name: '研磨业务',
    process_route_id: 8,
    process_step_index: 4,
    process_step_name: '5 · 精磨',
    process_step_instructions: '精磨厚度 2.50 +0.01/-0.02 mm',
  },
]
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'processingTasks').mockResolvedValue([
    { id: 9, team_id: 2, name: '磨削', active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([
    { id: 3, team_id: 2, name: '研磨业务', active: true, version: 1 },
  ])
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(
  snapshot: QuantityAdjustmentContext,
  rework = false,
  initialId: number | null = null,
  fixed = false,
) {
  wrapper = mount(
    defineComponent({
      setup() {
        const task = ref<number | null>(null),
          purpose = ref<number | null>(null),
          original = ref(initialId)
        return () =>
          h(ProcessingTaskFields, {
            teamId: 2,
            context: snapshot,
            taskId: task.value,
            purposeId: purpose.value,
            rework,
            reworkRecordId: original.value,
            reworkRecordFixed: fixed,
            submitted: true,
            'onUpdate:taskId': (value) => {
              task.value = value
            },
            'onUpdate:purposeId': (value) => {
              purpose.value = value
            },
            'onUpdate:reworkRecordId': (value) => {
              original.value = value
            },
          })
      },
    }),
    {
      global: {
        stubs: { TeamBusinessDialog: { props: ['modelValue'], template: '<div />' } },
      },
    },
  )
  await flushPromises()
}
function select(label: string) {
  return wrapper.findAllComponents(ElSelect).find((field) => field.props('ariaLabel') === label)!
}

it('shows the published step, fixed task and complete instructions for a repeated planned task', async () => {
  await render({ ...context(), completed_task_ids: [9], allowed_task_ids: [] })
  const details = wrapper.get('[aria-label="本道加工工艺"]')
  expect(details.text()).toContain('2 · 粗磨')
  expect(details.text()).toContain('具体任务 · 磨削')
  expect(details.get('p').text()).toBe('厚度 2.50 ±0.05 mm\n不得叠放')
  expect(select('加工任务').props()).toMatchObject({ modelValue: 9, disabled: true })
  expect(select('加工对应业务').props()).toMatchObject({ modelValue: 3, disabled: true })
})

it('keeps same-task originals distinct and changes requirements with the chosen rework record', async () => {
  await render({ ...context(), rework_of_id: 51, rework_task_records: originals() }, true)
  const chooser = select('返工原加工记录')
  expect(chooser.text()).toContain('2 · 粗磨 · 磨削 · 原记录 #51')
  expect(wrapper.text()).toContain('粗磨厚度 2.50 ±0.05 mm')
  chooser.vm.$emit('update:modelValue', 52)
  await flushPromises()
  const details = wrapper.get('[aria-label="本道加工工艺"]')
  expect(details.text()).toContain('5 · 精磨')
  expect(details.text()).toContain('原加工记录 #52')
  expect(details.text()).toContain('精磨厚度 2.50 +0.01/-0.02 mm')
  expect(details.text()).not.toContain('粗磨厚度')
  expect(select('加工任务').props()).toMatchObject({ modelValue: 9, disabled: true })
  expect(teamMaterialApi.processingTasks).not.toHaveBeenCalled()
})

it('does not ask for the original again when rework was opened from an explicit processing record', async () => {
  await render({ ...context(), rework_of_id: 52, rework_task_records: originals() }, true, 51, true)
  expect(select('返工原加工记录')).toBeUndefined()
  const details = wrapper.get('[aria-label="本道加工工艺"]')
  expect(details.text()).toContain('2 · 粗磨')
  expect(details.text()).toContain('原加工记录 #51')
})

it('requires a choice for ambiguous rework and never substitutes current-route requirements for old records', async () => {
  const snapshot = context()
  snapshot.rework_task_records = originals().map((record) => ({
    ...record,
    process_step_name: null,
    process_step_instructions: null,
  }))
  await render(snapshot, true)
  expect(select('返工原加工记录').element.closest('.is-error')).not.toBeNull()
  expect(wrapper.getComponent(ProcessingTaskFields).emitted('validity')?.at(-1)).toEqual([false])
  select('返工原加工记录').vm.$emit('update:modelValue', 51)
  await flushPromises()
  const details = wrapper.get('[aria-label="本道加工工艺"]')
  expect(details.text()).toContain('原工序未登记')
  expect(details.text()).toContain('历史未登记本道工艺要求')
  expect(details.text()).not.toContain('厚度 2.50 ±0.05 mm')
  expect(wrapper.getComponent(ProcessingTaskFields).emitted('validity')?.at(-1)).toEqual([true])
})

it('blocks a route-bound rework when its requested original record is missing', async () => {
  await render({ ...context(), rework_task_records: [] }, true, 999, true)
  expect(wrapper.getComponent(ProcessingTaskFields).emitted('validity')?.at(-1)).toEqual([false])
  const details = wrapper.get('[aria-label="本道加工工艺"]')
  expect(details.classes()).toContain('processing-route-instructions--invalid')
  expect(details.text()).toContain('未找到关联的原加工记录')
  expect(details.text()).not.toContain('厚度 2.50 ±0.05 mm')
})

it('allows explicit selection when the default original is unavailable and only one eligible record remains', async () => {
  await render({ ...context(), rework_of_id: 999, rework_task_records: [originals()[0]!] }, true)
  const chooser = select('返工原加工记录')
  expect(chooser.props('modelValue')).toBeNull()
  expect(chooser.element.closest('.is-error')).not.toBeNull()
  expect(wrapper.getComponent(ProcessingTaskFields).emitted('validity')?.at(-1)).toEqual([false])
  chooser.vm.$emit('update:modelValue', 51)
  await flushPromises()
  expect(wrapper.get('[aria-label="本道加工工艺"]').text()).toContain('粗磨厚度 2.50 ±0.05 mm')
  expect(wrapper.getComponent(ProcessingTaskFields).emitted('validity')?.at(-1)).toEqual([true])
})

it('keeps task settings mounted while its visible state closes', async () => {
  vi.mocked(teamMaterialApi.processingTasks).mockResolvedValue([])
  await render(context())
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '班组设置')!
    .trigger('click')
  const settings = wrapper.getComponent(TeamBusinessDialog)
  expect(settings.props('modelValue')).toBe(true)
  settings.vm.$emit('update:modelValue', false)
  await flushPromises()
  expect(wrapper.getComponent(TeamBusinessDialog).props('modelValue')).toBe(false)
})

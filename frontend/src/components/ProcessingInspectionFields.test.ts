// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElInputNumber } from 'element-plus'
import ProcessingInspectionFields from './ProcessingInspectionFields.vue'
import AppSelect from './AppSelect.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'

vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    loaded: true,
    items: [
      { id: 2, name: '轧制', active: true },
      { id: 3, name: '研磨', active: true },
    ],
  }),
}))
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockResolvedValue([
    { id: 11, team_id: 8, name: '划伤', active: true, version: 1 },
    { id: 12, team_id: 8, name: '停用问题', active: false, version: 1 },
  ])
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(ProcessingInspectionFields, {
    props: { teamId: 8, quantity: 10, submitted: true },
  })
  await flushPromises()
  choose('检查手段', ['visual'])
  choose('检查项目', ['appearance'])
  await flushPromises()
}
function choose(label: string, value: unknown) {
  wrapper
    .findAllComponents(AppSelect)
    .find((s) => s.find(`input[aria-label="${label}"]`).exists())!
    .vm.$emit('update:modelValue', value)
}
function count(label: string, value: number) {
  wrapper
    .findAllComponents(ElInputNumber)
    .find((s) => s.find(`input[aria-label="${label}"]`).exists())!
    .vm.$emit('update:modelValue', value)
}
function latest() {
  return wrapper.emitted('change')?.at(-1)?.[0]
}

it('tracks full-inspection count, computes passes, and limits samples to completed work', async () => {
  await render()
  expect(latest()).toMatchObject({ sample_quantity: 10, failed_quantity: 0, scope: 'full' })
  await wrapper.setProps({ quantity: 6 })
  expect(wrapper.get('[aria-label="合格件数"]').text()).toBe('6 件')
  expect(latest()).toMatchObject({ sample_quantity: 6 })
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '抽检')!
    .trigger('click')
  count('检验件数', 3)
  await flushPromises()
  expect(latest()).toMatchObject({ sample_quantity: 3, scope: 'sample' })
  expect(wrapper.get('[aria-label="合格件数"]').text()).toBe('3 件')
  count('检验件数', 7)
  await flushPromises()
  expect(latest()).toMatchObject({ sample_quantity: 6 })
  await wrapper.setProps({ quantity: 0 })
  await flushPromises()
  expect(latest()).toBeNull()
})

it('requires defect details and manual involved teams, then removes stale defects when all pass', async () => {
  await render()
  count('不合格件数', 2)
  await flushPromises()
  expect(latest()).toBeNull()
  expect(wrapper.get('[aria-label="合格件数"]').text()).toBe('8 件')
  choose('不合格问题', [11])
  choose('涉及班组', [2, 3])
  await wrapper.get('textarea[aria-label="问题说明"]').setValue('两件边缘划伤')
  expect(latest()).toMatchObject({
    failed_quantity: 2,
    problem_type_ids: [11],
    involved_team_ids: [2, 3],
  })
  choose('不合格问题', [12])
  await flushPromises()
  expect(latest()).toBeNull()
  count('不合格件数', 0)
  await flushPromises()
  expect(latest()).toMatchObject({
    failed_quantity: 0,
    problem_type_ids: [],
    involved_team_ids: [],
    notes: '',
  })
  expect(wrapper.find('textarea[aria-label="问题说明"]').exists()).toBe(false)
})

it('allows a passing check when the problem catalog fails, but requires recovery for defects', async () => {
  vi.mocked(teamMaterialApi.inspectionProblems).mockRejectedValueOnce(new Error('读取失败'))
  await render()
  expect(latest()).toMatchObject({ failed_quantity: 0 })
  count('不合格件数', 1)
  await flushPromises()
  expect(latest()).toBeNull()
  expect(wrapper.text()).toContain('读取失败')
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '重试')!
    .trigger('click')
  await flushPromises()
  expect(teamMaterialApi.inspectionProblems).toHaveBeenCalledTimes(2)
  choose('不合格问题', [11])
  choose('涉及班组', [2])
  await wrapper.get('textarea[aria-label="问题说明"]').setValue('划伤')
  expect(latest()).toMatchObject({ failed_quantity: 1 })
})

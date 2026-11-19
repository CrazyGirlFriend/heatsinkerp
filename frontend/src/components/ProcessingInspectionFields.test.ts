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
      { id: 3, name: '研磨', kind: 'production', code: 'FACTORY-GRIND', active: true },
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

it('requires a repair team and conserves quantities across defect lines', async () => {
  await render()
  count('不合格件数', 5)
  await flushPromises()
  choose('问题类别', '划伤')
  choose('处理方式', 'rework')
  await flushPromises()
  expect(latest()).toBeNull()
  choose('返修班组', 3)
  count('分类件数', 3)
  await flushPromises()
  expect(latest()).toBeNull()
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '增加分类')!
    .trigger('click')
  const selects = wrapper.findAllComponents(AppSelect)
  for (const [label, value] of [
    ['问题类别', '划伤'],
    ['处理方式', 'scrap'],
  ]) {
    selects
      .filter((s) => s.find(`input[aria-label="${label}"]`).exists())
      .at(-1)!
      .vm.$emit('update:modelValue', value)
  }
  await flushPromises()
  expect(latest()).toMatchObject({
    failed_quantity: 5,
    failure_lines: [
      { category: '划伤', quantity: 3, disposition: 'rework', repair_team_id: 3 },
      { category: '划伤', quantity: 2, disposition: 'scrap' },
    ],
  })
  count('不合格件数', 0)
  await flushPromises()
  expect(latest()).toMatchObject({ failed_quantity: 0, failure_lines: [] })
})

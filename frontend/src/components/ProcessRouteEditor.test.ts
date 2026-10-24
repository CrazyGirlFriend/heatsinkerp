// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 1, code: 'FACTORY-WAREHOUSE', name: '库房', active: true },
      { id: 2, code: 'FACTORY-GRIND', name: '研磨', active: true },
    ],
    refreshTeamDirectory: async () => {},
  }),
}))
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(processRouteApi, 'options').mockImplementation(async (teamId) => ({
    tasks: teamId === 1 ? [] : [{ id: 4, team_id: teamId, name: '精磨', active: true, version: 1 }],
    purposes: [{ id: 3, team_id: teamId, name: '产品加工', active: true, version: 1 }],
  }))
  vi.spyOn(processRouteApi, 'save').mockImplementation(async (route) =>
    JSON.parse(JSON.stringify({ ...route, version: 2 })),
  )
  vi.spyOn(processRouteApi, 'publish').mockResolvedValue({
    ...routeFixture,
    state: 'published',
    version: 2,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(published = false, route = routeFixture, intake = false) {
  wrapper = mount(ProcessRouteEditor, {
    props: {
      intake,
      route: structuredClone({
        ...route,
        state: published ? ('published' as const) : ('draft' as const),
      }),
    },
    global: {
      directives: { loading: () => {} },
      stubs: {
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        ScheduleTaskEditor: true,
        WordDocumentPreview: true,
      },
    },
  })
  await flushPromises()
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
  await flushPromises()
}
it('preserves original text and saves the version before publication', async () => {
  await render()
  expect(wrapper.text()).toContain('原文待核对')
  await click('核对并发布')
  expect(processRouteApi.save).toHaveBeenCalledOnce()
  expect(processRouteApi.publish).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }))
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps[1]!.instructions).toContain(
    '2.5(+0.01/-0.02)',
  )
  expect(wrapper.text()).toContain('另建修订稿')
})
it('keeps published steps immutable and offers source/revision actions', async () => {
  await render(true)
  expect(wrapper.text()).not.toContain('删除行')
  expect(wrapper.text()).not.toContain('核对并发布')
  expect(wrapper.text()).toContain('下载 Word 原件')
})
it('retains an editable draft when publication is rejected', async () => {
  vi.mocked(processRouteApi.publish).mockRejectedValue(new Error('工序序号必须递增且不能重复'))
  await render()
  await click('核对并发布')
  expect(wrapper.text()).toContain('不能重复')
  expect(wrapper.text()).toContain('保存草稿')
})

it('marks missing publication fields in red before sending a request', async () => {
  await render()
  await wrapper.setProps({ route: routeFixture })
  const firstName = wrapper.findAll('input').find((input) => input.element.value === '首批派工')!
  await firstName.setValue('')
  await click('核对并发布')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(wrapper.find('.el-form-item.is-error').exists()).toBe(true)
})

it('previews the original file while edits leave its retained source unchanged', async () => {
  await render()
  const original = wrapper.getComponent(WordDocumentPreview)
  expect(original.props('route').id).toBe(routeFixture.id)
  expect(original.props('route').filename).toBe('工艺.docx')
  expect(wrapper.find('.route-original-row').exists()).toBe(false)
  const field = wrapper.findAll('textarea').find((item) => item.element.value.includes('2.5'))!
  await field.setValue('核对后修改的工艺要求')
  expect(original.props('route').steps[1]!.instructions).toBe('核对后修改的工艺要求')
  expect(original.props('route').source_data.original_steps![1]!.instructions).toBe(
    '厚度2.5(+0.01/-0.02)，禁止摞放',
  )
  expect(original.props('route').source_data.tables).toEqual(routeFixture.source_data.tables)
})

it('maps the original transit store to warehouse for an older imported draft', async () => {
  const route = structuredClone(routeFixture)
  route.steps[0]!.name = '中转库'
  route.steps[0]!.team_id = null
  route.source_data.original_steps![0]!.name = '中转库'
  await render(false, route)
  expect(wrapper.text()).toContain('原文“中转库” → 执行班组“库房”')
  await click('保存草稿')
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps[0]!.team_id).toBe(1)
})

it('shows the source row for the focused step without replacing the actual original file', async () => {
  await render()
  await wrapper.findAll('.route-edit-step')[1]!.trigger('focusin')
  expect(wrapper.get('.route-original-line').text()).toBe('当前工序对应 原表 1 · 第 2 行')
  expect(wrapper.getComponent(WordDocumentPreview).props('route').id).toBe(routeFixture.id)
  expect(wrapper.find('.route-original-row--active').exists()).toBe(false)
})

it('reviews intake edits locally without saving or publishing a separate route', async () => {
  await render(false, routeFixture, true)
  expect(wrapper.text()).not.toContain('保存草稿')
  const serial = wrapper.findAll('input').find((item) => item.element.value === 'S-001')!
  expect(serial.attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('工艺与入库信息将在确认入库时一起保存')
  const field = wrapper.findAll('textarea').find((item) => item.element.value.includes('2.5'))!
  await field.setValue('核对后的来料工艺要求')
  await click('确认工艺，返回入库')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(processRouteApi.publish).not.toHaveBeenCalled()
  expect(wrapper.emitted('saved')).toBeUndefined()
  const reviewed = wrapper.emitted('reviewed')![0]![0] as typeof routeFixture
  expect(reviewed).toMatchObject({ id: routeFixture.id, version: 1, state: 'draft' })
  expect(reviewed.steps[1]!.instructions).toBe('核对后的来料工艺要求')
  expect(reviewed.source_data.original_steps![1]!.instructions).toBe(
    '厚度2.5(+0.01/-0.02)，禁止摞放',
  )
  expect(routeFixture.steps[1]!.instructions).toBe('厚度2.5(+0.01/-0.02)，禁止摞放')
})

it('requires complete intake route fields before returning the reviewed draft', async () => {
  const route = structuredClone(routeFixture)
  route.steps[1]!.processing_task_id = null
  await render(false, route, true)
  await click('确认工艺，返回入库')
  expect(wrapper.emitted('reviewed')).toBeUndefined()
  expect(wrapper.find('.el-form-item.is-error').exists()).toBe(true)
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(processRouteApi.publish).not.toHaveBeenCalled()
})

it('uses the route-specific directory once for repeated visits to the same production team', async () => {
  await render(false, routeFixture, true)
  expect(processRouteApi.options).toHaveBeenCalledWith(2)
  expect(
    vi.mocked(processRouteApi.options).mock.calls.filter(([teamId]) => teamId === 2),
  ).toHaveLength(1)
  expect(wrapper.text()).not.toContain('班组业务与任务读取失败')
})

// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import ProcessRoutesPage from './ProcessRoutesPage.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { businessNoticeApi } from '@/services/businessNoticeApi'
import { routeFixture, reworkRouteFixture } from '@/testFixtures/processRoute'
const state = vi.hoisted(() => ({ admin: true }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAdmin: state.admin,
    isTeamAccount: !state.admin,
    currentUser: { id: 1, active: true, team_id: 2 },
    currentUserError: '',
  }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [{ id: 9, code: 'FACTORY-PROCESS', name: '工艺', kind: 'engineering', active: true }],
    refreshTeamDirectory: async () => {},
  }),
}))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: () => ({}) }))
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))
let wrapper: VueWrapper
beforeEach(() => {
  state.admin = true
  vi.spyOn(processRouteApi, 'list').mockResolvedValue({
    items: [
      {
        ...routeFixture,
        state: 'published',
        engineering_employee_id: 11,
        engineering_employee_name: '张工',
        modified_employee_id: 12,
        modified_employee_name: '李工',
        created_at: '2026-10-23T01:00:00Z',
        updated_at: '2026-10-24T02:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/process-routes', component: ProcessRoutesPage }],
  })
  await router.push({ path: '/process-routes', query })
  await router.isReady()
  wrapper = mount(ProcessRoutesPage, {
    global: {
      plugins: [router],
      directives: { loading: () => {} },
      stubs: {
        TeamBusinessDialog: true,
        ProcessRouteEditor: true,
        TeamReworkMessages: true,
        ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
      },
    },
  })
  await flushPromises()
}
it('keeps the common workspace shell without a full-width single tab or duplicate time columns', async () => {
  await render()
  expect(wrapper.get('.team-workspace__title').text()).toBe('工艺工作台')
  expect(wrapper.get('nav[aria-label="工艺功能"]').attributes('style')).toContain('display: none')
  expect(wrapper.findAll('thead th .cell').map((cell) => cell.text())).toEqual([
    '流水号',
    '工艺人员',
    '修改人员',
    '更新时间',
    '操作',
  ])
  expect(wrapper.text()).toContain('张工')
  expect(wrapper.text()).toContain('李工')
  expect(wrapper.text()).not.toContain('Word 原文核对')
  expect(wrapper.text()).not.toContain('首次转出前须')
  expect(wrapper.text()).not.toContain('历史工艺')
  expect(wrapper.text()).not.toContain('返回当前工艺')
})
it('searches only after submission and refreshes the applied query', async () => {
  await render()
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue(' S-001 ')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('S-001', 1, undefined, 'desc', 20, 'normal')
})
it('does not expose import or roster writes to a warehouse or production account', async () => {
  state.admin = false
  await render()
  expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  expect(wrapper.findAll('button').some((button) => button.text() === '班组设置')).toBe(false)
})
it('offers normal and rework types, opening a blank form only for normal engineering', async () => {
  await render()
  expect(wrapper.findAll('button').some((button) => button.text() === '新建工艺')).toBe(true)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '新建工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(false)
  await wrapper.get('.new-route-options button').trigger('click')
  await flushPromises()
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(true)
  expect(wrapper.find('input[type=file]').exists()).toBe(false)
})

it('opens the matching record by clicking its serial and has no workflow status column', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
  expect(wrapper.get('process-route-editor-stub').attributes('route')).toBeDefined()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
  expect(wrapper.findAll('thead th .cell').map((item) => item.text())).not.toContain('状态')
})
it('opens editing directly from its action and returns to read-only when a serial is clicked', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  const revise = vi.spyOn(processRouteApi, 'revise')
  const save = vi.spyOn(processRouteApi, 'save')
  await render()
  expect(wrapper.text()).not.toContain('查看工艺')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '修改工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(true)
  expect(revise).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  wrapper.getComponent(ProcessRouteEditor).vm.$emit('close')
  await flushPromises()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
})
it('omits editing actions for a production account while keeping serial details available', async () => {
  state.admin = false
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  expect(wrapper.text()).not.toContain('修改工艺')
  expect(wrapper.findAll('thead th .cell').map((cell) => cell.text())).not.toContain('操作')
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
})
it('opens a rework notice for a production account with viewing permission only', async () => {
  state.admin = false
  const target = vi.spyOn(businessNoticeApi, 'target').mockResolvedValue({
    href: '/process-routes?rework_notice=7',
    section: 'steps',
    step_index: 0,
    route: { ...reworkRouteFixture, state: 'published' },
  })
  await render({ business_notice: 'rework:7', notice: 'open-7' })
  expect(target).toHaveBeenCalledWith('rework', 7)
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'desc', 20, 'rework')
  const editor = wrapper.getComponent(ProcessRouteEditor)
  expect(editor.props('route')?.id).toBe(reworkRouteFixture.id)
  expect(editor.props('viewOnly')).toBe(true)
  expect(editor.props('startEditing')).toBe(false)
})
it('requests global time ordering and resets to page one on sort or size changes', async () => {
  await render()
  const { ElPagination } = await import('element-plus')
  wrapper.getComponent(ElPagination).vm.$emit('current-change', 3)
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 3, undefined, 'desc', 20, 'normal')
  wrapper
    .getComponent({ name: 'ElTable' })
    .vm.$emit('sort-change', { prop: 'updated_at', order: 'ascending' })
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'asc', 20, 'normal')
  wrapper.getComponent(ElPagination).vm.$emit('size-change', 50)
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'asc', 50, 'normal')
  expect(wrapper.find('.el-pagination').exists()).toBe(true)
  expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10, 20, 50, 100])
  expect(wrapper.getComponent(ElPagination).props('layout')).toContain('jumper')
})

it('separates pending rework with visible problems and teams, and opens manual authoring directly', async () => {
  const pending = {
    ...reworkRouteFixture,
    state: 'draft' as const,
    rework_batch_no: 'TL-REWORK-1',
    rework_quantity: 4,
    rework_weight: 40,
    rework_request: {
      ...reworkRouteFixture.rework_request!,
      inspection_id: 19,
      inspection_kind: 'patrol' as const,
      problem_names: ['尺寸超差'],
      problem_notes: '实测厚度偏大',
      problem_teams: [
        { id: 2, name: '研磨' },
        { id: 3, name: '轧制' },
      ],
      execution_team_names: [],
    },
  }
  await render()
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [pending],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(pending)
  await wrapper.get('.route-kind-switch button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'desc', 20, 'rework')
  for (const text of ['尺寸超差', '巡检', '待制定', '待指定'])
    expect(wrapper.text()).toContain(text)
  expect(wrapper.get('.route-list tbody tr td').text()).toBe(pending.serial_nos[0])
  expect(wrapper.get('.rework-problem').text()).toBe('尺寸超差')
  expect(wrapper.get('.rework-problem').attributes('title')).toBe('实测厚度偏大')
  expect(
    wrapper.findAll('[aria-label="涉及班组"] [role="listitem"]').map((item) => item.text()),
  ).toEqual(['研磨', '轧制'])
  expect(wrapper.findAll('thead th .cell').map((cell) => cell.text())).toEqual([
    '流水号',
    '问题',
    '提交班组',
    '问题来源',
    '涉及班组',
    '执行班组',
    '工艺状态',
    '工艺人员',
    '更新时间',
    '操作',
  ])
  expect(wrapper.text()).toContain('新建工艺')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '制定工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props()).toMatchObject({
    route: pending,
    startEditing: true,
  })
})

it('shows authored rework execution teams without claiming work has finished', async () => {
  await render()
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [
      {
        ...reworkRouteFixture,
        rework_request: {
          ...reworkRouteFixture.rework_request!,
          execution_team_names: ['研磨', '检验'],
        },
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  await wrapper.get('.route-kind-switch button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('已制定')
  expect(
    wrapper.findAll('[aria-label="执行班组"] [role="listitem"]').map((item) => item.text()),
  ).toEqual(['研磨', '检验'])
  expect(wrapper.text()).not.toContain('已完成')
})

it('defaults to normal engineering and clears a previous search when switching views', async () => {
  await render()
  expect(processRouteApi.list).toHaveBeenCalledWith('', 1, undefined, 'desc', 20, 'normal')
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue('S-001')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  await wrapper.get('.route-kind-switch button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'desc', 20, 'rework')
  expect((wrapper.get('input[aria-label="工艺记录搜索"]').element as HTMLInputElement).value).toBe(
    '',
  )
})

it('starts rework from pending submitted problems rather than creating an unrelated route', async () => {
  await render()
  await wrapper.get('.new-route-options button:last-child').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, 'draft', 'desc', 20, 'rework')
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(false)
  expect(wrapper.text()).toContain('待制定')
})

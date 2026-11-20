// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h, ref } from 'vue'
import {
  workspaceAppearanceKey,
  type WorkspaceAppearance,
} from '@/composables/useWorkspaceAppearance'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import { ElPagination, ElPopover } from 'element-plus'
import ProcessRoutesPage from './ProcessRoutesPage.vue'
import '@/components/ProcessRouteEditor.vue'

import DocumentViewer from '@/components/DocumentViewer.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import TableColumnFilter from '@/components/TableColumnFilter.vue'
import FilterDialog from '@/components/FilterDialog.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
const state = vi.hoisted(() => ({ admin: false, teamId: 9, active: true, authError: '' }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAdmin: state.admin,
    isTeamAccount: !state.admin,
    currentUser: {
      id: 1,
      role: state.admin ? 'ADMIN' : 'TEAM',
      active: state.active,
      team_id: state.teamId,
      team: {
        id: state.teamId,
        code: state.teamId === 9 ? 'FACTORY-PROCESS' : 'FACTORY-ROLL',
        kind: state.teamId === 9 ? 'engineering' : 'production',
        active: true,
      },
    },
    currentUserError: state.authError,
  }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 9, code: 'FACTORY-PROCESS', name: '工艺', kind: 'engineering', active: true },
      { id: 1, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true },
      { id: 3, code: 'FACTORY-GRIND', name: '研磨', kind: 'production', active: true },
      { id: 5, code: 'FACTORY-ANNEAL', name: '退火', kind: 'production', active: true },
    ],
    refreshTeamDirectory: async () => {},
  }),
}))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: () => ({}) }))
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))
let wrapper: VueWrapper
beforeEach(() => {
  state.admin = false
  state.teamId = 9
  state.active = true
  state.authError = ''
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:route-drawing')
      static revokeObjectURL = vi.fn()
    },
  )
  vi.spyOn(processRouteApi, 'drawing').mockResolvedValue(new Blob(['pdf']))
  vi.spyOn(processRouteApi, 'list').mockResolvedValue({
    items: [
      {
        ...routeFixture,
        material_name: 'Mo70Cu30',
        step_summary: [
          { sequence_no: 0, name: '库房', team_id: 1 },
          { sequence_no: 1, name: '退火', team_id: 5 },
          { sequence_no: 2, name: '研磨', team_id: 3 },
          { sequence_no: 3, name: '退火', team_id: 5 },
        ],
        drawings: [{ id: 70, filename: '加工图纸.pdf', size_bytes: 100 }],
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
  if (wrapper?.exists()) wrapper.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(
  query: Record<string, string> = {},
  appearance: WorkspaceAppearance = 'glass',
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/process-routes', component: ProcessRoutesPage }],
  })
  await router.push({ path: '/process-routes', query })
  await router.isReady()
  wrapper = mount(ProcessRoutesPage, {
    global: {
      plugins: [router],
      provide: { [workspaceAppearanceKey as symbol]: ref(appearance) },
      directives: { loading: () => {} },
      stubs: {
        TeamBusinessDialog: true,
        ProcessRouteEditor: defineComponent({
          name: 'ProcessRouteEditor',
          props: ['route', 'startEditing', 'viewOnly'],
          render() {
            return h('process-route-editor-stub', { route: this.route })
          },
        }),
        DocumentViewer: true,
        ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
      },
    },
  })
  await flushPromises()
  return router
}
async function openedEditor() {
  await vi.waitFor(
    () => expect(wrapper.findComponent({ name: 'ProcessRouteEditor' }).exists()).toBe(true),
    { timeout: 5000 },
  )
  return wrapper.getComponent({ name: 'ProcessRouteEditor' })
}
it.each(['administrator', 'engineering', 'other-team', 'inactive', 'permission-error'])(
  'opens the engineering personnel page only for an authorized %s account in the current theme',
  async (account) => {
    state.admin = account === 'administrator'
    state.teamId = account === 'other-team' ? 2 : 9
    state.active = account !== 'inactive'
    state.authError = account === 'permission-error' ? '权限读取失败' : ''
    const router = await render({ tab: 'settings' }, 'watermelon')
    const allowed = ['administrator', 'engineering'].includes(account)
    expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(allowed)
    if (allowed) {
      expect(wrapper.get('h1').text()).toBe('班组管理')
      expect(wrapper.getComponent(TeamBusinessDialog).props()).toMatchObject({
        teamId: 9,
        modelValue: true,
        inline: true,
        employeesOnly: true,
        businessOnly: true,
        processingTasks: false,
      })
      expect(wrapper.find('[aria-label="工艺记录搜索"]').exists()).toBe(false)
      expect(processRouteApi.list).not.toHaveBeenCalled()
      await router.push('/process-routes')
      await flushPromises()
      expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(false)
      expect(wrapper.find('[aria-label="工艺记录搜索"]').exists()).toBe(true)
      expect(processRouteApi.list).toHaveBeenCalled()
      await wrapper
        .get('form[role="search"]')
        .findAll('button')
        .find((button) => button.text() === '班组管理')!
        .trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({ tab: 'settings' })
      expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(true)
      await router.back()
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({})
      expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(false)
      expect(wrapper.find('[aria-label="工艺记录搜索"]').exists()).toBe(true)
    } else {
      expect(wrapper.find('[aria-label="工艺记录搜索"]').exists()).toBe(true)
      expect(wrapper.findAll('button').some((button) => button.text() === '班组管理')).toBe(false)
    }
  },
)
it('lets an administrator maintain normal routes and manage personnel', async () => {
  state.admin = true
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(routeFixture)
  await render()
  const buttons = wrapper.findAll('button')
  expect(buttons.map((button) => button.text())).toContain('班组管理')
  expect(buttons.find((button) => button.text() === '新建工艺')!.classes()).not.toContain(
    'el-button--primary',
  )
  await wrapper.get('button.route-serial').trigger('click')
  expect((await openedEditor()).props()).toMatchObject({ viewOnly: false, startEditing: false })
})

it('removes the previous twenty-row page immediately when requesting ten rows', async () => {
  const items = Array.from({ length: 23 }, (_, index) => ({ ...routeFixture, id: index + 1 }))
  const response = (size: number) => ({
    items: items.slice(0, size),
    total: items.length,
    page: 1,
    page_size: size,
    enforced_after: null,
  })
  vi.mocked(processRouteApi.list).mockResolvedValue(response(20))
  await render()
  expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(20)
  let finish!: (value: ReturnType<typeof response>) => void
  vi.mocked(processRouteApi.list).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
  await flushPromises()
  expect(wrapper.getComponent(ElPagination).props('pageSize')).toBe(10)
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    10,
    'normal',
    'all',
    undefined,
  )
  expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
  finish(response(10))
  await flushPromises()
  expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
})
it('keeps the common workspace shell without a full-width single tab or duplicate time columns', async () => {
  await render()
  expect(wrapper.get('.team-workspace__title').text()).toBe('工艺记录')
  expect(wrapper.get('nav[aria-label="工艺记录视图"]').attributes('style')).toContain('display: none')
  expect(
    wrapper
      .findAll('thead th .cell')
      .map((cell) =>
        cell.find('.table-column-filter').exists()
          ? cell.get('.table-column-filter').text()
          : cell.text(),
      ),
  ).toEqual(['流水号', '材质', '工序概要', '图纸', '工艺人员', '修改人员', '更新时间', '操作'])
  expect(wrapper.text()).toContain('张工')
  expect(wrapper.text()).toContain('李工')
  expect(wrapper.text()).not.toContain('Word 原文核对')
  expect(wrapper.text()).not.toContain('首次转出前须')
  expect(wrapper.text()).not.toContain('历史工艺')
  expect(wrapper.text()).not.toContain('返回当前工艺')
})
it('shows team initials in process order, including repeated teams', async () => {
  await render()
  expect(wrapper.text()).toContain('Mo70Cu30')
  expect(wrapper.get('.route-step-summary').attributes('aria-description')).toBe(
    '库房 → 退火 → 研磨 → 退火',
  )
  expect(wrapper.find('.route-path-more').exists()).toBe(false)
  const nodes = wrapper.findAll('.route-step-node')
  expect(nodes).toHaveLength(4)
  expect(nodes.map((node) => node.text())).toEqual(['库', '退', '研', '退'])
  expect(nodes.map((node) => node.attributes('aria-label'))).toEqual([
    '工序 0 · 库房',
    '工序 1 · 退火',
    '工序 2 · 研磨',
    '工序 3 · 退火',
  ])
  expect(processRouteApi.drawing).not.toHaveBeenCalled()
})

it('keeps the full route accessible beyond six visible nodes', async () => {
  const response = await processRouteApi.list()
  const steps = response.items[0]!.step_summary!
  response.items[0]!.step_summary = [
    ...steps,
    ...steps.map((step) => ({ ...step, sequence_no: step.sequence_no + 4 })),
  ]
  await render()
  expect(wrapper.findAll('.route-step-node')).toHaveLength(6)
  expect(wrapper.get('.route-path-more').text()).toBe('+2')
  expect(wrapper.get('.route-path-more').attributes('aria-label')).toBe(
    '另有 2 道工序，查看完整路线',
  )
  expect(wrapper.findAll('.route-path-list li').map((item) => item.text())).toEqual([
    '0库库房',
    '1退退火',
    '2研研磨',
    '3退退火',
    '4库库房',
    '5退退火',
    '6研研磨',
    '7退退火',
  ])
})

it('uses the assigned team initial for a custom operation name', async () => {
  const response = await processRouteApi.list()
  response.items[0]!.step_summary![1]!.name = '高温整平'
  await render()
  expect(wrapper.findAll('.route-step-node')[1]!.attributes('aria-label')).toContain('高温整平')
  expect(wrapper.findAll('.route-step-node')[1]!.text()).toBe('退')
})

it('keeps the overflow entry reachable in narrow windows and updates it on resize', async () => {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) =>
      query === '(max-width: 1100px)'
        ? media
        : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    ),
  )
  const response = await processRouteApi.list()
  const steps = response.items[0]!.step_summary!
  response.items[0]!.step_summary = [...steps, ...steps]
  await render()
  expect(wrapper.findAll('.route-step-node')).toHaveLength(4)
  expect(wrapper.get('.route-path-more').text()).toBe('+4')
  const listener = media.addEventListener.mock.calls[0]![1]
  media.matches = false
  listener()
  await flushPromises()
  expect(wrapper.findAll('.route-step-node')).toHaveLength(6)
  expect(wrapper.get('.route-path-more').text()).toBe('+2')
  wrapper.unmount()
  expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
})

it('loads requirements and planned quantity on hover, sharing the request across steps', async () => {
  const detail = vi.spyOn(processRouteApi, 'detail').mockResolvedValue(routeFixture)
  await render()
  expect(detail).not.toHaveBeenCalled()
  const popovers = wrapper
    .findAllComponents(ElPopover)
    .filter((popover) => popover.find('.route-step-node').exists())
  popovers[0]!.vm.$emit('before-enter')
  popovers[1]!.vm.$emit('before-enter')
  await flushPromises()
  expect(detail).toHaveBeenCalledTimes(1)
  expect(wrapper.findAll('.route-step-detail')[1]!.text()).toContain(
    '厚度2.5(+0.01/-0.02)，禁止摞放',
  )
  expect(wrapper.findAll('.route-step-quantity')[1]!.text()).toContain('100')
  popovers[2]!.vm.$emit('before-enter')
  await flushPromises()
  expect(detail).toHaveBeenCalledTimes(1)
  expect(wrapper.findComponent({ name: 'ProcessRouteEditor' }).exists()).toBe(false)
})

it('allows retrying a failed step preview', async () => {
  vi.spyOn(processRouteApi, 'detail')
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue(routeFixture)
  await render()
  const popover = wrapper
    .findAllComponents(ElPopover)
    .find((popover) => popover.find('.route-step-node').exists())!
  popover.vm.$emit('before-enter')
  await flushPromises()
  expect(wrapper.get('.route-step-detail [role="alert"]').text()).toContain('工序信息读取失败')
  await wrapper.get('.route-step-detail [role="alert"] button').trigger('click')
  await flushPromises()
  expect(wrapper.find('.route-step-detail [role="alert"]').exists()).toBe(false)
  expect(wrapper.get('.route-step-detail').text()).toContain('核对来料')
})

it('loads a drawing only when clicked and releases it when its enlarged view closes', async () => {
  await render()
  await wrapper.get('button[aria-label="查看 S-001 的图纸"]').trigger('click')
  await flushPromises()
  expect(processRouteApi.drawing).toHaveBeenCalledWith(
    routeFixture.id,
    70,
    expect.any(AbortSignal),
    true,
  )
  const viewer = wrapper.getComponent(DocumentViewer)
  expect(viewer.props()).toMatchObject({ title: '加工图纸.pdf', pdf: 'blob:route-drawing' })
  viewer.vm.$emit('close')
  await flushPromises()
  expect(wrapper.findComponent(DocumentViewer).exists()).toBe(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:route-drawing')
})

it('lists multiple drawing filenames and opens the chosen file', async () => {
  const response = await processRouteApi.list()
  response.items[0]!.drawings!.push({ id: 71, filename: '尺寸图纸.pdf', size_bytes: 120 })
  await render()
  expect(wrapper.get('.route-drawing-count').text()).toBe('2 份')
  expect(processRouteApi.drawing).not.toHaveBeenCalled()
  await wrapper.findAll('.route-drawing-files button')[1]!.trigger('click')
  await flushPromises()
  expect(processRouteApi.drawing).toHaveBeenCalledWith(
    routeFixture.id,
    71,
    expect.any(AbortSignal),
    true,
  )
  expect(wrapper.getComponent(DocumentViewer).props('title')).toBe('尺寸图纸.pdf')
})

it('keeps the list usable when a drawing fails and allows another attempt', async () => {
  vi.mocked(processRouteApi.drawing).mockRejectedValueOnce(new Error('offline'))
  await render()
  await wrapper.get('.route-drawing-count').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('图纸读取失败，请重试')
  expect(wrapper.findComponent(DocumentViewer).exists()).toBe(false)
  await wrapper.get('.route-drawing-count').trigger('click')
  await flushPromises()
  expect(wrapper.findComponent(DocumentViewer).exists()).toBe(true)
})

it('cancels an unfinished drawing request when leaving the page', async () => {
  let finish!: (blob: Blob) => void
  vi.mocked(processRouteApi.drawing).mockReturnValueOnce(
    new Promise((resolve) => (finish = resolve)),
  )
  await render()
  await wrapper.get('.route-drawing-count').trigger('click')
  const signal = vi.mocked(processRouteApi.drawing).mock.calls[0]![2]!
  wrapper.unmount()
  expect(signal.aborted).toBe(true)
  finish(new Blob(['pdf']))
  await flushPromises()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('searches only after submission and refreshes the applied query', async () => {
  await render()
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue(' S-001 ')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    'S-001',
    1,
    undefined,
    'desc',
    20,
    'normal',
    'all',
    undefined,
  )
})
it('does not expose import or roster writes to a warehouse or production account', async () => {
  state.teamId = 2
  await render()
  expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  expect(wrapper.findAll('button').some((button) => button.text() === '班组设置')).toBe(false)
})
it('opens normal engineering directly without asking for its type again', async () => {
  await render()
  expect(wrapper.findAll('button').some((button) => button.text() === '新建工艺')).toBe(true)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '新建工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.find('.new-route-options').exists()).toBe(false)
  await openedEditor()
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(true)
  expect(wrapper.find('input[type=file]').exists()).toBe(false)
})

it('opens the matching record by clicking its serial and has no workflow status column', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
  await openedEditor()
  expect(wrapper.get('process-route-editor-stub').attributes('route')).toBeDefined()
  expect((await openedEditor()).props('startEditing')).toBe(false)
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
  expect((await openedEditor()).props('startEditing')).toBe(true)
  expect(revise).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  ;(await openedEditor()).vm.$emit('close')
  await flushPromises()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect((await openedEditor()).props('startEditing')).toBe(false)
})
it('omits editing actions for a production account while keeping serial details available', async () => {
  state.teamId = 2
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  expect(wrapper.text()).not.toContain('修改工艺')
  expect(
    wrapper
      .findAll('thead th .cell')
      .map((cell) =>
        cell.find('.table-column-filter').exists()
          ? cell.get('.table-column-filter').text()
          : cell.text(),
      ),
  ).not.toContain('操作')
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect((await openedEditor()).props('startEditing')).toBe(false)
})
it('requests global time ordering and resets to page one on sort or size changes', async () => {
  await render()
  const { ElPagination } = await import('element-plus')
  wrapper.getComponent(ElPagination).vm.$emit('current-change', 3)
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    3,
    undefined,
    'desc',
    20,
    'normal',
    'all',
    undefined,
  )
  wrapper
    .findAllComponents(TableColumnFilter)
    .find((column) => column.props('label') === '更新时间')!
    .vm.$emit('sort', 'asc')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    20,
    'normal',
    'all',
    JSON.stringify({ filters: [], sort: { field: 'updated_at', direction: 'asc' } }),
  )
  wrapper.getComponent(ElPagination).vm.$emit('size-change', 50)
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    50,
    'normal',
    'all',
    JSON.stringify({ filters: [], sort: { field: 'updated_at', direction: 'asc' } }),
  )
  expect(wrapper.find('.el-pagination').exists()).toBe(true)
  expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10, 20, 50, 100])
  expect(wrapper.find('.el-pagination__sizes').exists()).toBe(true)
})

it('applies toolbar filters together across pages and resets them without changing the search', async () => {
  await render({}, 'watermelon')
  const dialog = wrapper.getComponent(FilterDialog)
  expect(wrapper.get('form[role="search"]').find('.filter-dialog-trigger').exists()).toBe(true)
  wrapper.getComponent(WorkspacePagination).vm.$emit('current-change', 3)
  await flushPromises()
  await wrapper.get('[aria-label="工艺记录搜索"]').setValue('861113')
  await dialog.get('.filter-dialog-trigger').trigger('click')
  await wrapper.get('[aria-label="材质筛选"]').setValue('Mo70Cu30')
  await wrapper.get('[aria-label="工艺人员筛选"]').setValue('张工')
  expect(wrapper.find('[aria-label="轮次最小值"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="轮次最大值"]').exists()).toBe(false)
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    3,
    undefined,
    'desc',
    20,
    'normal',
    'all',
    undefined,
  )
  dialog.vm.$emit('apply')
  await flushPromises()
  const request = vi.mocked(processRouteApi.list).mock.lastCall!
  expect(request.slice(0, 7)).toEqual(['861113', 1, undefined, 'desc', 20, 'normal', 'all'])
  expect(JSON.parse(request[7]!).filters).toEqual([
    { field: 'material_name', kind: 'text', value: 'Mo70Cu30', end: '' },
    { field: 'engineering_employee_name', kind: 'text', value: '张工', end: '' },
  ])
  expect(dialog.props()).toMatchObject({ modelValue: false, count: 2 })
  await dialog.get('.filter-dialog-trigger').trigger('click')
  expect((wrapper.get('[aria-label="材质筛选"]').element as HTMLInputElement).value).toBe(
    'Mo70Cu30',
  )
  dialog.vm.$emit('reset')
  await flushPromises()
  expect(dialog.props('count')).toBe(2)
  dialog.vm.$emit('apply')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '861113',
    1,
    undefined,
    'desc',
    20,
    'normal',
    'all',
    undefined,
  )
  expect(dialog.props('count')).toBe(0)
})

it('shares header filters with the toolbar and discards cancelled edits', async () => {
  await render({}, 'watermelon')
  wrapper
    .findAllComponents(TableColumnFilter)
    .find((column) => column.props('label') === '材质')!
    .vm.$emit('apply', 'Cu', '')
  await flushPromises()
  const dialog = wrapper.getComponent(FilterDialog)
  await dialog.get('.filter-dialog-trigger').trigger('click')
  expect((wrapper.get('[aria-label="材质筛选"]').element as HTMLInputElement).value).toBe('Cu')
  const calls = vi.mocked(processRouteApi.list).mock.calls.length
  await wrapper.get('[aria-label="材质筛选"]').setValue('Mo')
  await dialog
    .findAll('button')
    .find((button) => button.text() === '取消')!
    .trigger('click')
  expect(processRouteApi.list).toHaveBeenCalledTimes(calls)
  await dialog.get('.filter-dialog-trigger').trigger('click')
  expect((wrapper.get('[aria-label="材质筛选"]').element as HTMLInputElement).value).toBe('Cu')
})

it('restores the normal list while revalidating, without another blank loading screen', async () => {
  await render({}, 'watermelon')
  const normal = await vi.mocked(processRouteApi.list).mock.results[0]!.value
  let finish!: (value: typeof normal) => void
  vi.mocked(processRouteApi.list).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  const requests = vi.mocked(processRouteApi.list).mock.calls.length
  await wrapper.get('button[aria-label="刷新工艺记录"]').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenCalledTimes(requests + 1)
  expect(wrapper.get('.route-serial').text()).toBe('S-001')
  expect(wrapper.find('.wm-skeleton').exists()).toBe(false)
  expect(wrapper.get('.route-list').attributes('aria-busy')).toBe('true')
  expect(wrapper.getComponent(WorkspacePagination).props('total')).toBe(1)
  expect(
    wrapper
      .findAll('thead th .cell')
      .map((cell) =>
        cell.find('.table-column-filter').exists()
          ? cell.get('.table-column-filter').text()
          : cell.text(),
      ),
  ).toContain('材质')
  expect(
    wrapper
      .findAll('thead th .cell')
      .map((cell) =>
        cell.find('.table-column-filter').exists()
          ? cell.get('.table-column-filter').text()
          : cell.text(),
      ),
  ).not.toContain('问题')

  finish({ ...normal, items: [{ ...routeFixture, serial_nos: ['S-UPDATED'] }] })
  await flushPromises()
  expect(wrapper.get('.route-serial').text()).toBe('S-UPDATED')
  expect(wrapper.get('.route-list').attributes('aria-busy')).toBe('false')
})

it('keeps a cached empty view empty while revalidating instead of flashing skeletons', async () => {
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  await render({}, 'watermelon')
  vi.mocked(processRouteApi.list).mockImplementationOnce(() => new Promise(() => {}))
  await wrapper.get('button[aria-label="刷新工艺记录"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('.wm-skeleton').exists()).toBe(false)
  expect(wrapper.get('.el-table__empty-text').text()).toBe('暂无数据')
})

it('does not reuse a searched page when the search is cleared', async () => {
  await render({}, 'watermelon')
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue('S-001')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  vi.mocked(processRouteApi.list).mockImplementationOnce(() => new Promise(() => {}))
  await wrapper.get('[aria-label="工艺记录搜索"]').setValue('')
  await wrapper.get('[aria-label="工艺记录搜索"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.find('.route-serial').exists()).toBe(false)
  expect(wrapper.find('.wm-skeleton').exists()).toBe(true)
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    20,
    'normal',
    'all',
    undefined,
  )
})

it('ignores a late search response after a newer search completes', async () => {
  await render({}, 'watermelon')
  const normal = await vi.mocked(processRouteApi.list).mock.results[0]!.value
  let finish!: (value: typeof normal) => void
  vi.mocked(processRouteApi.list).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  const search = wrapper.get('[aria-label="工艺记录搜索"]')
  await search.setValue('S-OLD')
  await search.trigger('keydown', { key: 'Enter' })
  await search.setValue('S-001')
  await search.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  finish({ ...normal, items: [{ ...routeFixture, serial_nos: ['S-OLD'] }] })
  await flushPromises()
  expect(wrapper.get('.route-serial').text()).toBe('S-001')
})

it('reloads normal routes after an engineering record is saved', async () => {
  await render({}, 'watermelon')
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(routeFixture)
  await wrapper.get('.route-serial').trigger('click')
  const editor = await openedEditor()
  vi.mocked(processRouteApi.list).mockImplementationOnce(() => new Promise(() => {}))
  editor.vm.$emit('saved')
  await flushPromises()
  expect(wrapper.find('.route-serial').exists()).toBe(false)
  expect(wrapper.find('.wm-skeleton').exists()).toBe(true)
})

it('marks incomplete historical routes beside the serial without hiding their details', async () => {
  const row = {
    ...routeFixture,
    state: 'published' as const,
    missing_documents: ['工艺原件', '图纸'],
  }
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [row],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(row)
  await render()
  const warning = wrapper.get('.route-document-warning')
  expect(warning.text()).toBe('待补资料')
  expect(warning.attributes('title')).toBe('缺少：工艺原件、图纸')
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
  expect((await openedEditor()).props('route')).toMatchObject({
    id: row.id,
    missing_documents: row.missing_documents,
  })
})
it('does not flag a complete route as missing documents', async () => {
  await render()
  expect(wrapper.find('.route-document-warning').exists()).toBe(false)
})

it.each(['glass', 'watermelon'] as const)(
  'opens the normal list from a legacy rework link in %s',
  async (appearance) => {
    await render({ kind: 'rework' }, appearance)
    expect(processRouteApi.list).toHaveBeenCalledTimes(1)
    expect(processRouteApi.list).toHaveBeenCalledWith(
      '',
      1,
      undefined,
      'desc',
      20,
      'normal',
      'all',
      undefined,
    )
    expect(wrapper.get('.route-serial').text()).toBe('S-001')
    expect(wrapper.find('[aria-label="工艺类型"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('返修记录')
    expect(wrapper.text()).toContain('新建工艺')
    const dialog = wrapper.getComponent(FilterDialog)
    await dialog.get('.filter-dialog-trigger').trigger('click')
    expect(wrapper.find('[aria-label="返工范围筛选"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="班组安排筛选"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="材质筛选"]').exists()).toBe(true)
  },
)

it('places the column settings above the table', async () => {
  await render({}, 'watermelon')
  expect(wrapper.find('.table-column-settings--toolbar').exists()).toBe(true)
  expect(wrapper.find('thead .table-column-settings').exists()).toBe(false)
  expect(wrapper.find('thead .table-column-settings--toolbar').exists()).toBe(false)
})

it('shows feedback immediately and ignores a cancelled detail response', async () => {
  let finish!: (value: typeof routeFixture) => void
  vi.spyOn(processRouteApi, 'detail').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await render()
  await wrapper.get('button.route-serial').trigger('click')
  expect(wrapper.text()).toContain('正在打开工艺')
  expect(wrapper.get('button.route-serial').classes()).toContain('is-loading')
  await wrapper.get('.async-status button').trigger('click')
  finish(routeFixture)
  await flushPromises()
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('正在打开工艺')
})

it('clears the loading state when opening a detail fails', async () => {
  vi.spyOn(processRouteApi, 'detail').mockRejectedValue(new Error('工艺读取失败'))
  await render()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('工艺读取失败')
  expect(wrapper.text()).not.toContain('正在打开工艺')
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(false)
})

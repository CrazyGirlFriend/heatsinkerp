// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'
import {
  workspaceAppearanceKey,
  type WorkspaceAppearance,
} from '@/composables/useWorkspaceAppearance'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import { ElPagination, ElPopover } from 'element-plus'
import ProcessRoutesPage from './ProcessRoutesPage.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import DocumentViewer from '@/components/DocumentViewer.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import TableColumnFilter from '@/components/TableColumnFilter.vue'
import FactoryNavIcon from '@/components/FactoryNavIcon.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { businessNoticeApi } from '@/services/businessNoticeApi'
import { routeFixture, reworkRouteFixture } from '@/testFixtures/processRoute'
const state = vi.hoisted(() => ({ admin: true, teamId: 2, active: true, authError: '' }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAdmin: state.admin,
    isTeamAccount: !state.admin,
    currentUser: { id: 1, active: state.active, team_id: state.teamId },
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
  state.admin = true
  state.teamId = 2
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
        ProcessRouteEditor: true,
        DocumentViewer: true,
        FactoryNavIcon: true,
        ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
      },
    },
  })
  await flushPromises()
  return router
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
      await router.back()
      await flushPromises()
      expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(true)
    } else {
      expect(wrapper.find('[aria-label="工艺记录搜索"]').exists()).toBe(true)
    }
  },
)
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
  expect(wrapper.get('.team-workspace__title').text()).toBe('工艺')
  expect(wrapper.get('nav[aria-label="工艺视图"]').attributes('style')).toContain('display: none')
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
it('shows icon-only process nodes in order, including repeated teams', async () => {
  await render()
  expect(wrapper.text()).toContain('Mo70Cu30')
  expect(wrapper.get('.route-step-summary').attributes('aria-description')).toBe(
    '库房 → 退火 → 研磨 → 退火',
  )
  expect(wrapper.find('.route-path-more').exists()).toBe(false)
  const nodes = wrapper.findAll('.route-step-node')
  expect(nodes).toHaveLength(4)
  expect(nodes.map((node) => node.text())).toEqual(['', '', '', ''])
  expect(nodes.map((node) => node.attributes('aria-label'))).toEqual([
    '工序 0 · 库房',
    '工序 1 · 退火',
    '工序 2 · 研磨',
    '工序 3 · 退火',
  ])
  expect(
    wrapper
      .get('.route-step-summary')
      .findAllComponents(FactoryNavIcon)
      .map((icon: VueWrapper<InstanceType<typeof FactoryNavIcon>>) => icon.props('name')),
  ).toEqual(['warehouse', 'annealing', 'grinding', 'annealing'])
  expect(processRouteApi.drawing).not.toHaveBeenCalled()
})

it.each([
  { kind: 'normal', visible: 6, overflow: 2 },
  { kind: 'rework', visible: 3, overflow: 5 },
])(
  'keeps the full $kind route accessible beyond $visible visible nodes',
  async ({ kind, visible, overflow }) => {
    const response = await processRouteApi.list()
    const steps = response.items[0]!.step_summary!
    response.items[0]!.step_summary = [
      ...steps,
      ...steps.map((step) => ({ ...step, sequence_no: step.sequence_no + 4 })),
    ]
    await render({ kind })
    expect(wrapper.findAll('.route-step-node')).toHaveLength(visible)
    expect(wrapper.get('.route-path-more').text()).toBe(`+${overflow}`)
    expect(wrapper.get('.route-path-more').attributes('aria-label')).toBe(
      `另有 ${overflow} 道工序，查看完整路线`,
    )
    expect(wrapper.findAll('.route-path-list li').map((item) => item.text())).toEqual([
      '0库房',
      '1退火',
      '2研磨',
      '3退火',
      '4库房',
      '5退火',
      '6研磨',
      '7退火',
    ])
  },
)

it('uses the assigned team icon for a custom operation name', async () => {
  const response = await processRouteApi.list()
  response.items[0]!.step_summary![1]!.name = '高温整平'
  await render()
  const icons = wrapper.get('.route-step-summary').findAllComponents(FactoryNavIcon)
  expect(icons[1]!.props('name')).toBe('annealing')
  expect(wrapper.findAll('.route-step-node')[1]!.attributes('aria-label')).toContain('高温整平')
  expect(wrapper.findAll('.route-step-node')[1]!.text()).toBe('')
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
  expect(wrapper.findComponent(ProcessRouteEditor).exists()).toBe(false)
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

it('uses the global pending count across searches and refreshes it after saving', async () => {
  const response = { ...(await processRouteApi.list()), pending_rework_count: 7 }
  vi.mocked(processRouteApi.list).mockResolvedValue(response)
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  expect(wrapper.get('[aria-label="工艺类型"] .wm-segmented-count').text()).toBe('7')
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue('S-001')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.get('[aria-label="工艺类型"] .wm-segmented-count').text()).toBe('7')
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  vi.mocked(processRouteApi.list).mockResolvedValue({ ...response, pending_rework_count: 6 })
  wrapper.getComponent(ProcessRouteEditor).vm.$emit('saved')
  await flushPromises()
  expect(wrapper.get('[aria-label="工艺类型"] .wm-segmented-count').text()).toBe('6')
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
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    20,
    'rework',
    'open',
    undefined,
  )
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

it('separates pending rework with visible problems and teams, and opens manual authoring directly', async () => {
  const pending = {
    ...reworkRouteFixture,
    state: 'draft' as const,
    steps: [],
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
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    20,
    'rework',
    'open',
    undefined,
  )
  for (const text of ['尺寸超差', '巡检', '待制定', '待指定'])
    expect(wrapper.text()).toContain(text)
  expect(wrapper.get('.route-list .el-table__body tbody tr td').text()).toBe(pending.serial_nos[0])
  expect(wrapper.get('.route-list .el-table__body tbody tr td:nth-child(5)').text()).toBe('待制定')
  expect(wrapper.find('.route-step-node').exists()).toBe(false)
  expect(wrapper.get('.rework-problem').text()).toBe('尺寸超差')
  expect(wrapper.get('.rework-problem').attributes('title')).toBe('实测厚度偏大')
  expect(
    wrapper.findAll('[aria-label="涉及班组"] [role="listitem"]').map((item) => item.text()),
  ).toEqual(['研磨', '轧制'])
  expect(
    wrapper
      .findAll('thead th .cell')
      .map((cell) =>
        cell.find('.table-column-filter').exists()
          ? cell.get('.table-column-filter').text()
          : cell.text(),
      ),
  ).toEqual([
    '流水号',
    '问题',
    '工艺状态',
    '处理进度',
    '返工概要',
    '轮次',
    '提交班组',
    '问题来源',
    '涉及班组',
    '执行班组',
    '加工件数',
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
  const authored = {
    ...reworkRouteFixture,
    steps: [{ ...reworkRouteFixture.steps[0]!, team_id: 3 }],
  }
  const detail = vi.spyOn(processRouteApi, 'detail').mockResolvedValue(authored)
  await render()
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [
      {
        ...authored,
        steps: [],
        step_summary: authored.steps.map(({ sequence_no, name, team_id }) => ({
          sequence_no,
          name,
          team_id,
        })),
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
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('已制定')
  expect(
    wrapper.findAll('[aria-label="执行班组"] [role="listitem"]').map((item) => item.text()),
  ).toEqual(['研磨', '检验'])
  expect(wrapper.text()).not.toContain('已完成')
  expect(wrapper.text()).not.toContain(authored.rework_request!.batch_no)
  expect(wrapper.get('.route-step-node').text()).toBe('')
  expect(wrapper.get('.route-step-summary').findComponent(FactoryNavIcon).props('name')).toBe(
    'grinding',
  )
  expect(detail).not.toHaveBeenCalled()
  wrapper
    .findAllComponents(ElPopover)
    .find((popover) => popover.find('.route-step-node').exists())!
    .vm.$emit('before-enter')
  await flushPromises()
  expect(detail).toHaveBeenCalledWith(authored.id)
  expect(wrapper.get('.route-step-detail').text()).toContain('返工精磨至2.50±0.01mm')
  expect(wrapper.get('.route-step-quantity').text()).toContain(authored.steps[0]!.planned_quantity)
})

it('defaults to normal engineering and clears a previous search when switching views', async () => {
  await render()
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
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue('S-001')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    20,
    'rework',
    'open',
    undefined,
  )
  expect((wrapper.get('input[aria-label="工艺记录搜索"]').element as HTMLInputElement).value).toBe(
    '',
  )
})

it('restores the normal list while revalidating, without another blank loading screen', async () => {
  await render({}, 'watermelon')
  const normal = await vi.mocked(processRouteApi.list).mock.results[0]!.value
  vi.mocked(processRouteApi.list).mockResolvedValue({
    ...normal,
    items: [{ ...reworkRouteFixture, serial_nos: ['RW-001'] }],
  })
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(wrapper.get('.route-serial').text()).toBe('RW-001')

  let finish!: (value: typeof normal) => void
  vi.mocked(processRouteApi.list).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  const requests = vi.mocked(processRouteApi.list).mock.calls.length
  await wrapper.get('[aria-label="工艺类型"] button:first-child').trigger('click')
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
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  vi.mocked(processRouteApi.list).mockImplementationOnce(() => new Promise(() => {}))
  await wrapper.get('[aria-label="工艺类型"] button:first-child').trigger('click')
  await flushPromises()
  expect(wrapper.find('.wm-skeleton').exists()).toBe(false)
  expect(wrapper.get('.el-table__empty-text').text()).toBe('暂无数据')
})

it('does not reuse a searched page after switching back to the unfiltered view', async () => {
  await render({}, 'watermelon')
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue('S-001')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  vi.mocked(processRouteApi.list).mockImplementationOnce(() => new Promise(() => {}))
  await wrapper.get('[aria-label="工艺类型"] button:first-child').trigger('click')
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

it('ignores an unfinished rework response after switching back to normal', async () => {
  await render({}, 'watermelon')
  const normal = await vi.mocked(processRouteApi.list).mock.results[0]!.value
  let finish!: (value: typeof normal) => void
  vi.mocked(processRouteApi.list).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(wrapper.find('.route-serial').exists()).toBe(false)
  expect(wrapper.find('.wm-skeleton').exists()).toBe(true)
  await wrapper.get('[aria-label="工艺类型"] button:first-child').trigger('click')
  await flushPromises()
  finish({ ...normal, items: [{ ...reworkRouteFixture, serial_nos: ['RW-LATE'] }] })
  await flushPromises()
  expect(wrapper.get('.route-serial').text()).toBe('S-001')
  expect(wrapper.get('.route-list').attributes('aria-busy')).toBe('false')
})

it('invalidates cached lists when an engineering record is saved', async () => {
  await render({}, 'watermelon')
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(reworkRouteFixture)
  await wrapper.get('[aria-label="工艺类型"] button:nth-child(2)').trigger('click')
  await flushPromises()
  await wrapper.get('.route-serial').trigger('click')
  await flushPromises()
  wrapper.getComponent(ProcessRouteEditor).vm.$emit('saved')
  await flushPromises()
  wrapper.getComponent(ProcessRouteEditor).vm.$emit('close')
  vi.mocked(processRouteApi.list).mockImplementationOnce(() => new Promise(() => {}))
  await wrapper.get('[aria-label="工艺类型"] button:first-child').trigger('click')
  await flushPromises()
  expect(wrapper.find('.route-serial').exists()).toBe(false)
  expect(wrapper.find('.wm-skeleton').exists()).toBe(true)
})

it('starts rework from pending submitted problems rather than creating an unrelated route', async () => {
  await render()
  await wrapper.get('.new-route-options button:last-child').trigger('click')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    'draft',
    'desc',
    20,
    'rework',
    'open',
    undefined,
  )
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(false)
  expect(wrapper.text()).toContain('待制定')
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
  expect(wrapper.getComponent(ProcessRouteEditor).props('route')).toMatchObject({
    id: row.id,
    missing_documents: row.missing_documents,
  })
})
it('does not flag a complete route as missing documents', async () => {
  await render()
  expect(wrapper.find('.route-document-warning').exists()).toBe(false)
})

it('opens the requested process type and follows navigation between normal and rework', async () => {
  const router = await render({ kind: 'rework' })
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    undefined,
    'desc',
    20,
    'rework',
    'open',
    undefined,
  )
  expect(wrapper.get('[aria-label="工艺类型"] button[aria-pressed="true"]').text()).toBe('返工工艺')
  await router.push('/process-routes')
  await flushPromises()
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
  expect(wrapper.get('[aria-label="工艺类型"] button[aria-pressed="true"]').text()).toBe('正常工艺')
  await router.back()
  await flushPromises()
  expect(wrapper.get('[aria-label="工艺类型"] button[aria-pressed="true"]').text()).toBe('返工工艺')
  await wrapper.get('[aria-label="工艺类型"] button:first-child').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.kind).toBeUndefined()
})

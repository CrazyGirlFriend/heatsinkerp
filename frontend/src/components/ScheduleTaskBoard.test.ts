// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElInput, ElPagination, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleTaskBoard from './ScheduleTaskBoard.vue'
import ScheduleDocuments from './ScheduleDocuments.vue'
import DeliverySchedules from './DeliverySchedules.vue'
import TableExportButton from './TableExportButton.vue'
import FilterDialog from './FilterDialog.vue'
import AppNumberInput from './AppNumberInput.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
const hooks = vi.hoisted(() => ({ openDetail: vi.fn() }))
vi.mock('./VTableScheduleTimeline.vue', () => ({
  default: {
    name: 'VTableScheduleTimeline',
    props: ['tasks', 'loading', 'hasMore', 'loadingMore', 'loadError'],
    emits: ['open-node', 'open-task', 'load-more'],
    template:
      '<div class="overview-stub"><slot/><slot name="view-actions"/><slot name="load-status"/></div>',
  },
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAdmin: true,
    isDispatch: true,
    currentUserError: '',
    currentUser: { active: true },
  }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 1, name: '库房', active: true },
      { id: 2, name: '轧制', active: true },
    ],
  }),
}))
vi.mock('@/composables/useLiveRefresh', () => ({
  useLiveRefresh: () => ({ message: { value: '' }, request: vi.fn() }),
}))
const node = (id = 1): ProductionSchedule => ({
  id,
  serial_no: 'S-001',
  team_id: id,
  team_name: id === 1 ? '库房' : '轧制',
  next_team_id: id + 1,
  next_team_name: id === 1 ? '轧制' : '检验',
  external_destination: null,
  due_at: `2026-10-23T${id === 1 ? '08' : '14'}:00:00+08:00`,
  sequence_no: id,
  predecessor_id: id === 1 ? null : 1,
  target_quantity: id === 1 ? 1 : 100,
  target_weight: 10,
  completion_basis: 'quantity',
  notes: null,
  sources: [],
  version: 1,
  status: 'pending',
  execution_state: 'waiting_material',
  quality_held: false,
  cancelled_at: null,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
  dispatched_quantity: 0,
  dispatched_weight: 0,
  received_quantity: 0,
  received_weight: 0,
  remaining_quantity: id === 1 ? 1 : 100,
  remaining_weight: 10,
  completed_at: null,
})
const task: ScheduleTask = {
  id: 7,
  task_no: 'PQ00000007',
  title: '首批板料',
  serial_no: 'S-001',
  notes: null,
  version: 1,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
  final_due_at: '2026-10-23T14:00:00+08:00',
  status: 'pending',
  nodes: [node(1), node(2)],
}
let wrapper: VueWrapper
beforeEach(() => {
  hooks.openDetail.mockReset()
  vi.spyOn(productionScheduleApi, 'tasks').mockResolvedValue({
    items: [task],
    total: 1,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(productionScheduleApi, 'task').mockResolvedValue(task)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(path = '/production-schedules') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/production-schedules', component: { template: '<div/>' } }],
  })
  await router.push(path)
  wrapper = mount(ScheduleTaskBoard, {
    props: { fullscreen: false },
    slots: { 'view-actions': '<button class="fullscreen-toggle">全屏切换</button>' },
    global: {
      plugins: [router],
      directives: { loading: () => {} },
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        VTableScheduleTimeline: {
          name: 'VTableScheduleTimeline',
          props: ['tasks', 'teams', 'loading', 'hasMore', 'loadingMore', 'loadError'],
          emits: ['open-node', 'open-task', 'load-more'],
          template:
            '<div class="overview-stub"><slot/><slot name="view-actions"/><slot name="load-status"/></div>',
        },
        DeliverySchedules: {
          props: { detailOnly: Boolean },
          emits: ['changed'],
          setup: () => ({ openDetail: hooks.openDetail }),
          template: '<div/>',
        },
        ScheduleTaskEditor: true,
        ScheduleSelectionDialog: true,
      },
    },
  })
  await flushPromises()
  return router
}
async function button(label: string) {
  const target =
    label === '筛选'
      ? wrapper.get('button[aria-label="排期筛选"]')
      : wrapper.findAll('button').find((item) => item.text() === label)!
  await target.trigger('click')
  await flushPromises()
}
function select(label: string) {
  return wrapper.findAllComponents(ElSelect).find((item) => item.props('ariaLabel') === label)!
}
describe('task scheduling board', () => {
  it('pastes multiple serials without joining lines and keeps the search with filters and export', async () => {
    await render()
    const values = Array.from({ length: 30 }, (_, index) => `691236-${51 + index}`)
    const input = wrapper.get('input[aria-label="任务排期搜索"]')
    const pasted = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasted, 'clipboardData', {
      value: { getData: () => values.join('\r\n') },
    })
    input.element.dispatchEvent(pasted)
    await flushPromises()
    const query = values.join(' ')
    expect(pasted.defaultPrevented).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe(query)
    expect(Number(input.attributes('maxlength'))).toBeGreaterThan(query.length)
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(1)
    await wrapper.get('form[role="search"]').trigger('submit')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query, page: 1 }),
    )
    await button('筛选')
    expect(wrapper.findComponent(FilterDialog).exists()).toBe(true)
    expect(wrapper.find('.schedule-filter-drawer').exists()).toBe(false)
    select('交货班组筛选').vm.$emit('update:modelValue', 2)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query, team_id: 2 }),
    )
    const data = wrapper.getComponent(TableExportButton).props('source')()!
    await data.load(new AbortController().signal, () => {})
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query, team_id: 2 }),
    )
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', '')
    wrapper.getComponent(ElInput).vm.$emit('clear')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: undefined, team_id: 2 }),
    )
  })
  it('keeps ten-row pagination consistent while an older twenty-row request completes late', async () => {
    const items = Array.from({ length: 23 }, (_, index) => ({ ...task, id: index + 1 }))
    const response = (size: number) => ({
      items: items.slice(0, size),
      total: items.length,
      page: 1,
      page_size: size,
    })
    vi.mocked(productionScheduleApi.tasks).mockImplementation(async (params) =>
      response(params?.page_size || 10),
    )
    await render()
    await wrapper.setProps({ management: true })
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(20)
    let finish!: (value: ReturnType<typeof response>) => void
    vi.mocked(productionScheduleApi.tasks).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
    await flushPromises()
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
    finish(response(10))
    await flushPromises()
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)

    vi.mocked(productionScheduleApi.tasks).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
    await flushPromises()
    finish(response(20))
    await flushPromises()
    expect(wrapper.getComponent(ElPagination).props('pageSize')).toBe(10)
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
  })
  it('opens overdue work directly from the factory overview', async () => {
    await render('/production-schedules?status=overdue')
    expect(productionScheduleApi.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'overdue' }),
    )
    expect(wrapper.get('.filter-count').text()).toBe('1')
  })
  it('keeps controls inside the overview without a title bar or pagination', async () => {
    await render('/production-schedules?serial_no=S-001')
    expect(wrapper.find('.task-board__toolbar').exists()).toBe(false)
    expect(wrapper.findComponent(ElPagination).exists()).toBe(false)
    expect(wrapper.find('.overview-stub .table-export-button').exists()).toBe(true)
    expect(wrapper.find('[aria-label="排期筛选"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="刷新任务排期"]').exists()).toBe(true)
    expect(wrapper.get('.filter-count').text()).toBe('1')
  })
  it('loads one chunk at a time, appends once, and ignores a stale response after search', async () => {
    const items = Array.from({ length: 121 }, (_, i) => ({ ...task, id: i + 1 }))
    const response = (page: number, size = 50) => ({
      items: items.slice((page - 1) * size, page * size),
      total: 121,
      page,
      page_size: size,
    })
    let finish!: (value: Awaited<ReturnType<typeof productionScheduleApi.tasks>>) => void
    vi.mocked(productionScheduleApi.tasks).mockImplementation(async (params) => {
      if (params?.query) return { items: [task], total: 1, page: 1, page_size: 50 }
      if (params?.page === 2)
        return new Promise((resolve) => {
          finish = resolve
        })
      return response(params?.page || 1)
    })
    await render()
    const overview = wrapper.getComponent({ name: 'VTableScheduleTimeline' })
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(1)
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 50 }),
    )
    expect(overview.props('tasks')).toHaveLength(50)
    overview.vm.$emit('load-more')
    overview.vm.$emit('load-more')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(2)
    expect(overview.props('loadingMore')).toBe(true)
    finish(response(2))
    await flushPromises()
    expect(overview.props('tasks')).toHaveLength(100)
    expect(overview.props('loadingMore')).toBe(false)
    overview.vm.$emit('load-more')
    await flushPromises()
    expect(overview.props('tasks')).toHaveLength(121)
    expect(overview.props('hasMore')).toBe(false)
    overview.vm.$emit('load-more')
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(3)
    await wrapper.get('[aria-label="刷新任务排期"]').trigger('click')
    await flushPromises()
    expect(overview.props('tasks')).toHaveLength(50)
    overview.vm.$emit('load-more')
    await flushPromises()
    await wrapper.get('input[aria-label="任务排期搜索"]').setValue('S-001')
    await wrapper.get('form[role="search"]').trigger('submit')
    await flushPromises()
    finish(response(2))
    await flushPromises()
    expect(overview.props('tasks')).toEqual([task])
    expect(overview.props('loadingMore')).toBe(false)
  })
  it('stages a freely entered loading size, cancels edits, and caps requests at 100', async () => {
    await render()
    await button('筛选')
    const size = () => wrapper.getComponent(AppNumberInput)
    expect(size().props('modelValue')).toBe(50)
    size().vm.$emit('update:modelValue', 37)
    await button('取消')
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(1)
    await button('筛选')
    expect(size().props('modelValue')).toBe(50)
    size().vm.$emit('update:modelValue', 37)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 37 }),
    )
    await button('筛选')
    size().vm.$emit('update:modelValue', 200)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ page_size: 100 }),
    )
    await button('筛选')
    size().vm.$emit('update:modelValue', 0)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ page_size: 1 }),
    )
    await button('筛选')
    await button('重置')
    expect(size().props('modelValue')).toBe(50)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ page_size: 50 }),
    )
    expect(wrapper.findComponent(ElPagination).exists()).toBe(false)
  })
  it('keeps loaded rows on a failed continuation and retries that same chunk', async () => {
    vi.mocked(productionScheduleApi.tasks).mockResolvedValue({
      items: [task],
      total: 2,
      page: 1,
      page_size: 50,
    })
    await render()
    const overview = wrapper.getComponent({ name: 'VTableScheduleTimeline' })
    vi.mocked(productionScheduleApi.tasks).mockRejectedValueOnce(new Error('连接中断'))
    overview.vm.$emit('load-more')
    await flushPromises()
    expect(overview.props('loadError')).toBe('连接中断')
    expect(overview.props('tasks')).toEqual([task])
    vi.mocked(productionScheduleApi.tasks).mockResolvedValueOnce({
      items: [{ ...task, id: 8 }],
      total: 2,
      page: 2,
      page_size: 50,
    })
    overview.vm.$emit('load-more')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    )
    expect(overview.props('tasks')).toHaveLength(2)
    expect(overview.props('loadError')).toBe('')
  })
  it('opens the global overview by default and drills into the existing task and node details', async () => {
    await render()
    const overview = wrapper.getComponent({ name: 'VTableScheduleTimeline' })
    expect(overview.props('tasks')).toEqual([task])
    expect(wrapper.findAllComponents({ name: 'VTableScheduleTimeline' })).toHaveLength(1)
    expect(wrapper.find('[aria-label="排期视图"]').exists()).toBe(false)
    expect(wrapper.getComponent(DeliverySchedules).props('detailOnly')).toBe(true)
    overview.vm.$emit('open-node', node(2))
    await flushPromises()
    expect(hooks.openDetail).toHaveBeenCalledWith(2)
    overview.vm.$emit('open-task', task)
    await flushPromises()
    expect(productionScheduleApi.task).toHaveBeenCalledWith(7)
    expect(wrapper.findAll('.task-detail__target > strong').map((item) => item.text())).toEqual([
      '1 件',
      '100 件',
    ])
    expect(wrapper.findAll('.task-detail__target > small').map((item) => item.text())).toEqual([
      '10 kg（参考）',
      '10 kg（参考）',
    ])
    expect(wrapper.find('.task-detail__notes').exists()).toBe(false)
    const documents = wrapper.getComponent(ScheduleDocuments)
    expect(documents.find('.schedule-documents.form-workspace--documents').exists()).toBe(true)
    expect(documents.find('.form-workspace-content .task-detail__route').exists()).toBe(true)
    expect(documents.props('orderDocument')).toBeNull()
    expect(wrapper.text()).not.toContain('流水号信息')

    expect(wrapper.text()).not.toContain('101 件')
  })
  it('shares the applied filters between global progress and export data', async () => {
    await render()
    expect(wrapper.find('input[aria-label="任务排期搜索"]').exists()).toBe(true)
    await wrapper.get('input[aria-label="任务排期搜索"]').setValue('S-001')
    await wrapper.get('form[role="search"]').trigger('submit')
    await flushPromises()
    await button('筛选')
    expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(true)
    select('交货班组筛选').vm.$emit('update:modelValue', 2)
    select('任务状态筛选').vm.$emit('update:modelValue', 'overdue')
    wrapper
      .getComponent(RecordDateFilter)
      .vm.$emit('update:modelValue', { from: '2026-10-22', to: '2026-10-23' })
    await button('应用筛选')
    const filters = {
      query: 'S-001',
      team_id: 2,
      status: 'overdue',
      due_from: '2026-10-22T00:00:00+08:00',
      due_to: '2026-10-23T23:59:59+08:00',
    }
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith({
      ...filters,
      sort_order: 'asc',
      page: 1,
      page_size: 50,
    })
    expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(false)
    expect(wrapper.get('.filter-count').text()).toBe('4')
    expect(wrapper.getComponent({ name: 'VTableScheduleTimeline' }).props('tasks')).toEqual([task])
    expect(wrapper.findAllComponents({ name: 'VTableScheduleTimeline' })).toHaveLength(1)
    const data = wrapper.getComponent(TableExportButton).props('source')()!
    const exported = await data.load(new AbortController().signal, () => {})
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith({
      ...filters,
      sort_order: 'asc',
      page: 1,
      page_size: 100,
    })
    expect(exported[0]).toMatchObject({
      serial_no: 'S-001',
      route: '库房 → 轧制',
      node_targets: '1. 库房：1 件 / 10 kg（参考）；2. 轧制：100 件 / 10 kg（参考）',
    })
  })
  it('stages scope, serials and people until applied, discards cancellation, and resets all conditions', async () => {
    await render('/production-schedules?serial_no=S-001')
    await button('筛选')
    select('任务范围筛选').vm.$emit('update:modelValue', 'attention')
    await button('选择流水号')
    wrapper
      .getComponent(ScheduleSelectionDialog)
      .vm.$emit('apply', [{ value: 'S-001', label: 'S-001' }])
    await flushPromises()
    await button('选择业务人员')
    wrapper.getComponent(ScheduleSelectionDialog).vm.$emit('apply', [{ value: 3, label: '张工' }])
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(1)
    expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(true)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'S-001',
        scope: 'attention',
        serial_nos: ['S-001'],
        business_person_ids: [3],
        page: 1,
      }),
    )
    expect(wrapper.get('.filter-count').text()).toBe('4')
    await wrapper.get('button[aria-label="排期筛选"]').trigger('click')
    await flushPromises()
    await button('重置')
    await button('取消')
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(2)
    await wrapper.get('button[aria-label="排期筛选"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(ElInput).props('modelValue')).toBe('S-001')
    expect(select('任务范围筛选').props('modelValue')).toBe('attention')
    expect(wrapper.get('.schedule-filter-values').text()).toBe('S-001')
    expect(wrapper.text()).toContain('张工')
    await button('重置')
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(2)
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'S-001',
        scope: undefined,
        serial_nos: undefined,
        business_person_ids: undefined,
        page: 1,
      }),
    )
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', '')
    wrapper.getComponent(ElInput).vm.$emit('clear')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: undefined, page: 1 }),
    )
    expect(wrapper.find('.filter-count').exists()).toBe(false)
  })
  it('searches without opening filters and keeps final delivery sorting when exporting', async () => {
    vi.mocked(productionScheduleApi.tasks).mockResolvedValue({
      items: [task],
      total: 21,
      page: 1,
      page_size: 10,
    })
    await render()
    await wrapper.get('input[aria-label="任务排期搜索"]').setValue('  S-001  ')
    await wrapper.get('form[role="search"]').trigger('submit')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'S-001', sort_order: 'asc', page: 1 }),
    )
    await button('筛选')
    select('最终交期排序').vm.$emit('update:modelValue', 'desc')
    await flushPromises()
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'S-001', sort_order: 'desc', page: 1 }),
    )
    vi.mocked(productionScheduleApi.tasks).mockResolvedValue({
      items: [task],
      total: 1,
      page: 1,
      page_size: 100,
    })
    const data = wrapper.getComponent(TableExportButton).props('source')()!
    await data.load(new AbortController().signal, () => {})
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'S-001', sort_order: 'desc', page: 1, page_size: 100 }),
    )
  })
  it('sorts the dispatch table by final delivery through the server', async () => {
    await render()
    await wrapper.setProps({ management: true })
    wrapper.getComponent({ name: 'ElTable' }).vm.$emit('sort-change', {
      prop: 'final_due_at',
      order: 'descending',
    })
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_order: 'desc', page: 1 }),
    )
    wrapper.getComponent({ name: 'ElTable' }).vm.$emit('sort-change', {
      prop: 'final_due_at',
      order: 'ascending',
    })
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_order: 'asc', page: 1 }),
    )
    await button('筛选')
    expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(true)
    expect(wrapper.find('.schedule-filter-drawer').exists()).toBe(false)
    select('任务状态筛选').vm.$emit('update:modelValue', 'overdue')
    await button('应用筛选')
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'overdue', sort_order: 'asc', page: 1 }),
    )
    expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(false)
  })
  it('loads task deep links and refreshes after node or task edits', async () => {
    await render('/production-schedules?task_id=7')
    expect(productionScheduleApi.task).toHaveBeenCalledWith(7)
    await wrapper.setProps({ management: true })
    await button('修改交期')
    expect(wrapper.getComponent(ScheduleTaskEditor).props('task')).toEqual(task)
    wrapper.getComponent(ScheduleTaskEditor).vm.$emit('saved', task)
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(ScheduleTaskEditor).exists()).toBe(false)
    expect(wrapper.find('.task-detail__heading').exists()).toBe(false)
    expect(productionScheduleApi.task).toHaveBeenCalledTimes(1)
    wrapper.getComponent(DeliverySchedules).vm.$emit('changed')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(3)
  })
  it('returns to the same filtered list page after creating a task without opening its details', async () => {
    vi.mocked(productionScheduleApi.tasks).mockResolvedValue({
      items: [task],
      total: 21,
      page: 1,
      page_size: 10,
    })
    await render('/production-schedules?serial_no=S-001')
    await wrapper.setProps({ management: true })
    wrapper.getComponent({ name: 'ElTable' }).vm.$emit('sort-change', {
      prop: 'final_due_at',
      order: 'descending',
    })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    await button('新建任务排期')
    expect(wrapper.getComponent(ScheduleTaskEditor).props('task')).toBeNull()
    wrapper.getComponent(ScheduleTaskEditor).vm.$emit('saved', task)
    await flushPromises()
    expect(wrapper.findComponent(ScheduleTaskEditor).exists()).toBe(false)
    expect(wrapper.find('.task-detail__heading').exists()).toBe(false)
    expect(productionScheduleApi.task).not.toHaveBeenCalled()
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'S-001', sort_order: 'desc', page: 2, page_size: 10 }),
    )
    expect(wrapper.getComponent(ElPagination).props('currentPage')).toBe(2)
  })
  it('preserves a task switch while the saved task list refresh is still pending', async () => {
    await render('/production-schedules?task_id=7')
    await wrapper.setProps({ management: true })
    await button('修改交期')
    let finishRefresh!: (value: Awaited<ReturnType<typeof productionScheduleApi.tasks>>) => void
    vi.mocked(productionScheduleApi.tasks).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve
        }),
    )
    const nextTask = { ...task, id: 8, task_no: 'PQ00000008', title: '第二批交货' }
    vi.mocked(productionScheduleApi.task).mockImplementation(async (id) =>
      id === 8 ? nextTask : task,
    )
    wrapper.getComponent(ScheduleTaskEditor).vm.$emit('saved', task)
    await flushPromises()
    await wrapper.setProps({ management: false })
    wrapper.getComponent({ name: 'VTableScheduleTimeline' }).vm.$emit('open-task', nextTask)
    await flushPromises()
    expect(wrapper.get('.task-detail__heading').text()).toContain('第二批交货')
    finishRefresh({ items: [task, nextTask], total: 2, page: 1, page_size: 10 })
    await flushPromises()
    expect(productionScheduleApi.task).toHaveBeenLastCalledWith(8)
    expect(wrapper.get('.task-detail__heading').text()).toContain('第二批交货')
  })
})

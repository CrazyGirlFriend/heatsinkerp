// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElInput, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleTaskBoard from './ScheduleTaskBoard.vue'
import ProductionScheduleGantt from './ProductionScheduleGantt.vue'
import ProductionScheduleOverview from './ProductionScheduleOverview.vue'
import DeliverySchedules from './DeliverySchedules.vue'
import TableExportButton from './TableExportButton.vue'
import AppDrawer from './AppDrawer.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
const hooks = vi.hoisted(() => ({ openDetail: vi.fn() }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isAdmin: true, currentUserError: '', currentUser: { active: true } }),
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
    props: { fullscreen: true },
    global: {
      plugins: [router],
      directives: { loading: () => {} },
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        AppDrawer: {
          props: ['modelValue'],
          template: '<aside v-if="modelValue"><slot/><slot name="footer"/></aside>',
        },
        ProductionScheduleOverview: {
          props: ['tasks', 'teams', 'loading'],
          emits: ['open-node', 'open-task'],
          template: '<div class="overview-stub"/>',
        },
        ProductionScheduleGantt: {
          props: ['tasks', 'loading'],
          emits: ['open-node', 'open-task'],
          template: '<div class="gantt-stub"/>',
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
  await wrapper
    .findAll('button')
    .find((item) => item.text() === label)!
    .trigger('click')
  await flushPromises()
}
function select(label: string) {
  return wrapper.findAllComponents(ElSelect).find((item) => item.props('ariaLabel') === label)!
}
describe('task scheduling board', () => {
  it('opens the global overview by default and drills into the existing task and node details', async () => {
    await render()
    const overview = wrapper.getComponent(ProductionScheduleOverview)
    expect(overview.props('tasks')).toEqual([task])
    expect(wrapper.findComponent(ProductionScheduleGantt).exists()).toBe(false)
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
    expect(wrapper.text()).not.toContain('101 件')
  })
  it('shares the applied filters between global progress and export data', async () => {
    await render()
    expect(wrapper.find('input[aria-label="任务排期搜索"]').exists()).toBe(false)
    await button('筛选')
    expect(wrapper.getComponent(AppDrawer).attributes('direction')).toBe('rtl')
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', 'S-001')
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
      page: 1,
      page_size: 10,
    })
    expect(wrapper.getComponent(AppDrawer).props('modelValue')).toBe(false)
    expect(wrapper.get('.task-board__filter-count').text()).toBe('4')
    expect(wrapper.getComponent(ProductionScheduleOverview).props('tasks')).toEqual([task])
    expect(wrapper.findComponent(ProductionScheduleGantt).exists()).toBe(false)
    const data = wrapper.getComponent(TableExportButton).props('source')()!
    const exported = await data.load(new AbortController().signal, () => {})
    expect(productionScheduleApi.tasks).toHaveBeenLastCalledWith({
      ...filters,
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
    await render()
    await button('筛选')
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', 'S-001')
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
    expect(wrapper.getComponent(AppDrawer).props('modelValue')).toBe(true)
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
    expect(wrapper.get('.task-board__filter-count').text()).toBe('4')
    await wrapper.get('button[aria-label="排期筛选"]').trigger('click')
    await flushPromises()
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', 'discarded')
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
        query: undefined,
        scope: undefined,
        serial_nos: undefined,
        business_person_ids: undefined,
        page: 1,
      }),
    )
    expect(wrapper.find('.task-board__filter-count').exists()).toBe(false)
  })
  it('loads task deep links and refreshes after node or task edits', async () => {
    await render('/production-schedules?task_id=7')
    expect(productionScheduleApi.task).toHaveBeenCalledWith(7)
    await button('修改任务信息')
    expect(wrapper.getComponent(ScheduleTaskEditor).props('task')).toEqual(task)
    wrapper.getComponent(ScheduleTaskEditor).vm.$emit('saved', task)
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(2)
    wrapper.getComponent(DeliverySchedules).vm.$emit('changed')
    await flushPromises()
    expect(productionScheduleApi.tasks).toHaveBeenCalledTimes(3)
  })
  it('preserves a task switch while the saved task list refresh is still pending', async () => {
    await render('/production-schedules?task_id=7')
    await button('修改任务信息')
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
    wrapper.getComponent(ProductionScheduleOverview).vm.$emit('open-task', nextTask)
    await flushPromises()
    expect(wrapper.get('.task-detail__heading').text()).toContain('第二批交货')
    finishRefresh({ items: [task, nextTask], total: 2, page: 1, page_size: 10 })
    await flushPromises()
    expect(productionScheduleApi.task).toHaveBeenLastCalledWith(8)
    expect(wrapper.get('.task-detail__heading').text()).toContain('第二批交货')
  })
})

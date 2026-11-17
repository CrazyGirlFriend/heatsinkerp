import { formatDateTime } from '@/utils/format'
// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElInput, ElPagination, ElSelect } from 'element-plus'
import { h, reactive } from 'vue'
import DeliverySchedules from './DeliverySchedules.vue'
import AppDialog from './AppDialog.vue'
import ScheduleBatchEditor from './ScheduleBatchEditor.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
import TableExportButton from './TableExportButton.vue'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type {
  ProductionSchedule,
  ScheduleSourceOption,
  ScheduleTask,
} from '@/types/productionSchedule'

const state = vi.hoisted(() => ({
  auth: {
    isAdmin: false,
    isDispatch: false,
    isTeamAccount: true,
    currentUserError: '',
    currentUser: { active: true, team_id: 2 },
  },
  live: { message: { value: '' }, request: vi.fn() },
}))
vi.mock('@/stores/auth', async (original) => ({
  ...(await original<object>()),
  useAuthStore: () => state.auth,
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 2, name: '轧制', code: 'FACTORY-ROLL', active: true },
      { id: 3, name: '研磨', code: 'FACTORY-GRIND', active: true },
    ],
  }),
}))
vi.mock('@/composables/useLiveRefresh', () => ({
  useLiveRefresh: () => state.live,
}))
const record = (): ProductionSchedule => ({
  id: 5,
  serial_no: '805881-5',
  team_id: 2,
  team_name: '轧制',
  next_team_id: 3,
  next_team_name: '研磨',
  external_destination: null,
  due_at: '2026-10-22T08:00:00Z',
  initial_due_at: '2026-10-22T07:00:00Z',
  sequence_no: 1,
  predecessor_id: null,
  target_quantity: 100,
  target_weight: 10,
  notes: null,
  version: 2,
  status: 'overdue',
  cancelled_at: null,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
  completed_at: null,
  dispatched_quantity: 40,
  dispatched_weight: 4,
  received_quantity: 20,
  received_weight: 2,
  remaining_quantity: 60,
  remaining_weight: 6,
  sources: [{ source_transfer_id: 10, batch_no: 'TL-原板', quantity: 100, weight: 10 }],
  deliveries: [
    {
      id: 20,
      batch_no: 'TL-转出',
      schedule_batch_id: null,
      source_transfer_id: 10,
      counts_toward_delivery: false,
      quantity: 40,
      weight: 4,
      transferred_at: '2026-10-22T06:00:00Z',
      received_at: null,
      status: 'voided',
    },
  ],
  history: [],
})
const option = (id = 99): ScheduleSourceOption => ({
  source_transfer_id: id,
  batch_no: `TL-产出${id}`,
  serial_no: '805881-5',
  material_name: 'W80',
  material_type: 'semi_finished',
  quantity: 100,
  weight: 10,
  on_hand_quantity: 60,
  on_hand_weight: 6,
  received_at: '2026-10-22T05:00:00Z',
})
let wrapper: VueWrapper
beforeEach(() => {
  state.live = reactive({ message: { value: '' }, request: vi.fn() })
  state.auth = reactive({
    isAdmin: false,
    isDispatch: false,
    isTeamAccount: true,
    currentUserError: '',
    currentUser: { active: true, team_id: 2 },
  })
  vi.spyOn(productionScheduleApi, 'list').mockResolvedValue({
    items: [record()],
    total: 1,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(productionScheduleApi, 'detail').mockResolvedValue(record())
  vi.spyOn(productionScheduleApi, 'sources').mockResolvedValue({
    items: [option()],
    total: 1,
    page: 1,
    page_size: 10,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(manage = false, detail = false, withinShell = false, detailOnly = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/team-workspaces/:teamId', component: { template: '<div />' } },
      { path: '/production-schedules', component: { template: '<div />' } },
    ],
  })
  await router.push(
    manage
      ? '/production-schedules'
      : `/team-workspaces/2?tab=delivery-schedule${detail ? '&schedule_id=5' : ''}`,
  )
  const deliveryProps = { manage, teamId: manage ? undefined : 2, fullscreen: true, detailOnly }
  const options = {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        MaterialTransferDrawer: {
          props: ['modelValue', 'batchNo'],
          template:
            '<div v-if="modelValue" data-testid="batch-detail"><slot name="context"/></div>',
        },
        ScheduleBatchEditor: true,
      },
    },
  }
  wrapper = withinShell
    ? mount(TeamWorkspaceShell, {
        ...options,
        props: { title: '轧制', modelValue: 'delivery-schedule', exportable: true },
        slots: { default: () => h(DeliverySchedules, deliveryProps) },
      })
    : mount(DeliverySchedules, { ...options, props: deliveryProps })
  await flushPromises()
  return router
}
function button(text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)!
}
describe('delivery schedule workbench', () => {
  it('shows one incoming row per batch with actual quantities and moves allocations into batch details', async () => {
    const received = {
      source_transfer_id: 10,
      batch_no: 'TL-原板',
      material_name: 'W80',
      quantity: 100,
      weight: 10,
      received_at: '2026-10-22T05:00:00Z',
      status: 'received',
    }
    vi.mocked(productionScheduleApi.detail).mockResolvedValue({
      ...record(),
      sources: [{ source_transfer_id: 10, batch_no: 'TL-原板', quantity: 40, weight: 4 }],
      linked_batches: [
        received,
        {
          ...received,
          source_transfer_id: 11,
          batch_no: 'TL-后续来料',
          received_at: null,
          status: 'pending',
        },
      ],
    })
    await render(false, true)
    const headings = wrapper.findAll('h3').map((item) => item.text())
    expect(headings).toContain('来料明细')
    expect(headings).toContain('分批排期')
    expect(headings).not.toContain('关联物料')
    expect(headings).not.toContain('来料记录')
    const incoming = wrapper.get('[aria-label="来料明细"]')
    const rows = incoming.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.findAll('td').map((cell) => cell.text())).toEqual([
      'TL-原板',
      'W80',
      '100',
      '10',
      formatDateTime(received.received_at),
      '已接收',
    ])
    expect(rows[1]!.text()).toContain('待签收')
    expect(rows[1]!.findAll('td')[4]!.text()).toBe('—')
    expect(wrapper.text()).not.toContain('分配计划件数')
    await button('TL-原板').trigger('click')
    const batch = wrapper.getComponent(MaterialTransferDrawer)
    expect(batch.props('batchNo')).toBe('TL-原板')
    const allocation = wrapper.get('[data-testid="batch-detail"]')
    expect(allocation.text()).toContain('本排期计划分配')
    expect(allocation.text()).toContain('排期 #5')
    expect(allocation.findAll('.el-descriptions__content').map((cell) => cell.text())).toEqual([
      '805881-5 · 轧制 · 排期 #5',
      '40',
      '4',
    ])
    batch.vm.$emit('update:modelValue', false)
    await flushPromises()
    await button('TL-后续来料').trigger('click')
    expect(batch.props('batchNo')).toBe('TL-后续来料')
    expect(wrapper.get('[data-testid="batch-detail"]').text()).not.toContain('本排期计划分配')
  })
  it('shows received material even when no source allocation was specified', async () => {
    vi.mocked(productionScheduleApi.detail).mockResolvedValue({
      ...record(),
      sources: [],
      linked_batches: [
        {
          source_transfer_id: 10,
          batch_no: 'TL-来料',
          material_name: 'Mo70Cu30',
          quantity: 100,
          weight: 100,
          received_at: '2026-11-15T12:49:00Z',
          status: 'received',
        },
      ],
    })
    await render(false, true)
    const incoming = wrapper.get('[aria-label="来料明细"]')
    expect(incoming.findAll('tbody tr')).toHaveLength(1)
    expect(incoming.text()).toContain('TL-来料')
    expect(incoming.text()).toContain('Mo70Cu30')
    expect(incoming.text()).not.toContain('暂无')
    expect(wrapper.text()).not.toContain('暂无关联批次')
  })
  it('keeps a clear incoming empty state without displaying plan quantities as received material', async () => {
    vi.mocked(productionScheduleApi.detail).mockResolvedValue({ ...record(), linked_batches: [] })
    await render(false, true)
    const incoming = wrapper.get('[aria-label="来料明细"]')
    expect(incoming.text()).toContain('暂无来料')
    expect(incoming.findAll('tbody tr')).toHaveLength(0)
    expect(incoming.text()).not.toContain('TL-原板')
  })
  function mockTaskRoute(overrides: Partial<ProductionSchedule> = {}) {
    const first = { ...record(), task_id: 11, planning_state: 'pending' as const, ...overrides }
    const other = { ...first, id: 6, team_id: 3, team_name: '研磨', sequence_no: 2 }
    const repeated = { ...first, id: 7, sequence_no: 3, predecessor_id: 6 }
    const task: ScheduleTask = {
      id: 11,
      task_no: 'PQ00000011',
      title: '第一批交货',
      serial_no: first.serial_no,
      notes: null,
      version: 1,
      created_at: first.created_at,
      updated_at: first.updated_at,
      final_due_at: first.due_at,
      status: first.status,
      nodes: [first, other, repeated],
    }
    vi.mocked(productionScheduleApi.list).mockResolvedValue({
      items: [first],
      total: 1,
      page: 1,
      page_size: 10,
    })
    vi.mocked(productionScheduleApi.detail).mockImplementation(async (id) =>
      task.nodes.find((n) => n.id === id)!,
    )
    vi.spyOn(productionScheduleApi, 'task').mockResolvedValue(task)
    return task
  }
  it.each([true, false])(
    'reveals the exact selected occurrence whether the route loads before the dialog opens: %s',
    async (routeFirst) => {
      const task = mockTaskRoute()
      task.nodes = Array.from({ length: 8 }, (_, index) => ({
        ...task.nodes[0]!,
        id: index + 5,
        sequence_no: index + 1,
        team_id: index === 0 || index === 7 ? 2 : 3,
        team_name: index === 0 || index === 7 ? '轧制' : '研磨',
      }))
      let finishRoute!: (value: ScheduleTask) => void
      vi.mocked(productionScheduleApi.task).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRoute = resolve
          }),
      )
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (
        this: Element,
      ) {
        return this.classList.contains('schedule-task-route') ? 480 : 0
      })
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (
        this: Element,
      ) {
        return this.classList.contains('schedule-task-route') ? 1600 : 0
      })
      const originalRect = Element.prototype.getBoundingClientRect
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        if (this.classList.contains('schedule-task-route'))
          return { left: 100, width: 480 } as DOMRect
        if (this.classList.contains('schedule-task-route__node')) {
          const container = this.closest('.schedule-task-route')!
          return {
            left:
              100 +
              (Number(this.getAttribute('data-schedule-id')) - 5) * 200 -
              container.scrollLeft,
            width: 180,
          } as DOMRect
        }
        return originalRect.call(this)
      })
      await render()
      await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(12)
      const dialog = wrapper
        .findAllComponents(AppDialog)
        .find((item) => item.classes().includes('schedule-detail'))!
      if (routeFirst) {
        finishRoute(task)
        await flushPromises()
        expect(wrapper.get('.schedule-task-route').element.scrollLeft).toBe(0)
        dialog.vm.$emit('opened')
      } else {
        dialog.vm.$emit('opened')
        await flushPromises()
        expect(wrapper.find('.schedule-task-route').exists()).toBe(false)
        finishRoute(task)
      }
      await flushPromises()
      expect(wrapper.get('.schedule-task-route').element.scrollLeft).toBe(1120)
      expect(wrapper.get('[data-schedule-id="12"]').classes()).toContain('is-current')
      expect(wrapper.get('[data-schedule-id="12"] [aria-current="step"]').text()).toContain(
        '当前查看',
      )
      expect(wrapper.get('[data-schedule-id="5"]').classes()).not.toContain('is-current')
      await wrapper.get('[data-schedule-id="8"] .schedule-task-route__heading').trigger('click')
      await flushPromises()
      expect(wrapper.get('.schedule-task-route').element.scrollLeft).toBe(450)
      expect(wrapper.get('.schedule-task-route .is-current').attributes('data-schedule-id')).toBe(
        '8',
      )
      expect(wrapper.findAll('.schedule-task-route [aria-current="step"]')).toHaveLength(1)
      expect(wrapper.get('.schedule-task-route').element.scrollTop).toBe(0)
      await wrapper.get('[data-schedule-id="5"] .schedule-task-route__heading').trigger('click')
      await flushPromises()
      expect(wrapper.get('.schedule-task-route').element.scrollLeft).toBe(0)
      expect(wrapper.get('.schedule-task-route .is-current').attributes('data-schedule-id')).toBe(
        '5',
      )
    },
  )
  it('lets dispatch edit the listed occurrence using the latest schedule and refresh after saving', async () => {
    state.auth.isDispatch = true
    const task = mockTaskRoute({ planning_state: 'confirmed' })
    await render()
    const fresh = { ...task.nodes[0]!, version: 4, due_at: '2026-10-23T08:00:00Z' }
    task.nodes[0] = fresh
    await button('编辑').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.detail).toHaveBeenLastCalledWith(5)
    expect(wrapper.getComponent(ScheduleBatchEditor).props('schedule')).toEqual(fresh)
    const saved = { ...fresh, version: 5, due_at: '2026-10-24T08:00:00Z' }
    task.nodes[0] = saved
    vi.mocked(productionScheduleApi.list).mockResolvedValue({
      items: [saved],
      total: 1,
      page: 1,
      page_size: 10,
    })
    wrapper.getComponent(ScheduleBatchEditor).vm.$emit('saved', saved)
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    expect(wrapper.get('.schedule-table').text()).toContain(formatDateTime(saved.due_at))
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  it('still rejects a plan cancelled after the list was loaded', async () => {
    state.auth.isDispatch = true
    const task = mockTaskRoute()
    await render()
    task.nodes[0] = { ...task.nodes[0]!, status: 'cancelled' }
    await button('编辑').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.detail).toHaveBeenLastCalledWith(5)
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
  })
  it.each(['owning team', 'other team'])(
    'keeps plans read-only for the %s, including route details',
    async (role) => {
      mockTaskRoute(role === 'other team' ? { team_id: 3, team_name: '研磨' } : {})
      if (role === 'administrator') {
        state.auth.isTeamAccount = false
        state.auth.isAdmin = true
      }
      await render(false, true)
      expect(button('编辑')).toBeUndefined()
      expect(wrapper.find('.schedule-task-route').exists()).toBe(true)
      expect(wrapper.find('.schedule-task-route__plan').exists()).toBe(false)
      expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
      if (role === 'owning team') expect(button('转出物料')).toBeDefined()
    },
  )
  it('confirms viewing the details without saving a plan or dispatching material', async () => {
    mockTaskRoute()
    const save = vi.spyOn(productionScheduleApi, 'saveBatches')
    await render(false, true)
    expect(button('出库')).toBeUndefined()
    expect(button('转出物料').element.closest('.schedule-section-heading')).not.toBeNull()
    await button('确认').trigger('click')
    await flushPromises()
    expect(wrapper.find('.schedule-detail').exists()).toBe(false)
    expect(productionScheduleApi.sources).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.emitted('dispatch')).toBeUndefined()
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
  it('lets dispatch open the route before planning and edit the exact team occurrence', async () => {
    state.auth.isDispatch = true
    const task = mockTaskRoute()
    await render()
    expect(button('填写交期')).toBeUndefined()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    await button('明细').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    expect(wrapper.find('.schedule-detail__manage').exists()).toBe(false)
    expect(wrapper.find('[data-schedule-id="6"] .schedule-task-route__plan').exists()).toBe(false)
    expect(wrapper.get('[data-schedule-id="5"]').text()).toContain('当前查看')
    await wrapper.get('[data-schedule-id="7"] .schedule-task-route__plan').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.detail).toHaveBeenLastCalledWith(7)
    expect(wrapper.getComponent(ScheduleBatchEditor).props('schedule').id).toBe(7)
    wrapper.getComponent(ScheduleBatchEditor).vm.$emit('close')
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    expect(wrapper.get('[data-schedule-id="7"]').classes()).toContain('is-current')
    await wrapper.get('[data-schedule-id="5"] .schedule-task-route__plan').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(ScheduleBatchEditor).props('schedule').id).toBe(5)
    const saved = { ...task.nodes[0]!, planning_state: 'confirmed' as const }
    task.nodes[0] = saved
    wrapper.getComponent(ScheduleBatchEditor).vm.$emit('saved', saved)
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    expect(wrapper.get('[data-schedule-id="5"]').text()).toContain(formatDateTime(saved.due_at))
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  it.each([{ status: 'cancelled' as const }])(
    'keeps cancelled route nodes read-only: %s',
    async (overrides) => {
      state.auth.isDispatch = true
      mockTaskRoute(overrides)
      await render(false, true)
      expect(button('编辑')).toBeUndefined()
      expect(wrapper.find('.schedule-task-route__plan').exists()).toBe(false)
      expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    },
  )
  it('keeps confirmed plans editable at their node and permits dispatch to adjust other teams', async () => {
    mockTaskRoute({ planning_state: 'confirmed' })
    state.auth.isDispatch = true
    await render(true, false, false, true)
    await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(5)
    await flushPromises()
    const target = wrapper.get('[data-schedule-id="6"] .schedule-task-route__plan')
    expect(target.attributes('aria-label')).toContain('修改批次计划')
    await target.trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(ScheduleBatchEditor).props('schedule').id).toBe(6)
  })
  it('does not open a planner from a late response after the details were closed', async () => {
    state.auth.isDispatch = true
    const task = mockTaskRoute()
    await render(false, true)
    let finish!: (value: ProductionSchedule) => void
    vi.mocked(productionScheduleApi.detail).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await wrapper.get('[data-schedule-id="7"] .schedule-task-route__plan').trigger('click')
    await button('确认').trigger('click')
    finish(task.nodes[2]!)
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    expect(wrapper.find('.schedule-task-route').exists()).toBe(false)
  })
  it('closes the planner when dispatch permission is lost', async () => {
    state.auth.isDispatch = true
    mockTaskRoute()
    await render()
    await button('编辑').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(true)
    state.auth.isDispatch = false
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    state.auth.isDispatch = true
    await flushPromises()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
  })
  it('clears the previous larger page while ten-row pagination is pending', async () => {
    const items = Array.from({ length: 23 }, (_, index) => ({ ...record(), id: index + 1 }))
    const response = (size: number) => ({
      items: items.slice(0, size),
      total: items.length,
      page: 1,
      page_size: size,
    })
    vi.mocked(productionScheduleApi.list).mockImplementation(async (params) =>
      response(params?.page_size || 10),
    )
    await render()
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(20)
    let finish!: (value: ReturnType<typeof response>) => void
    vi.mocked(productionScheduleApi.list).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
    await flushPromises()
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 10 }),
    )
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
    finish(response(10))
    await flushPromises()
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
  })
  it('merges workspace and schedule sync failures into one toolbar notice and retries both', async () => {
    await render()
    const table = wrapper.get('.el-table').element
    state.live.message.value = '同步失败，当前保留上次数据'
    await wrapper.setProps({ syncMessage: '实时连接中断，当前显示上次结果，正在重连。' })
    expect(wrapper.findAll('.live-refresh-notice')).toHaveLength(1)
    expect(wrapper.find('.workspace-toolbar .live-refresh-notice').exists()).toBe(true)
    expect(wrapper.get('.live-refresh-notice').text()).toContain('实时连接中断')
    expect(wrapper.get('.el-table').element).toBe(table)
    await wrapper.get('.live-refresh-notice button').trigger('click')
    expect(state.live.request).toHaveBeenCalledOnce()
    expect(wrapper.emitted('retry-sync')).toHaveLength(1)
    await wrapper.setProps({ syncMessage: '' })
    expect(wrapper.get('.live-refresh-notice').text()).toContain('同步失败')
    state.live.message.value = ''
    await flushPromises()
    expect(wrapper.find('.live-refresh-notice').exists()).toBe(false)
  })
  it('opens a schedule directly from its business link', async () => {
    const router = await render()
    await router.push('/team-workspaces/2?tab=delivery-schedule&schedule_id=5')
    await flushPromises()
    expect(productionScheduleApi.detail).toHaveBeenCalledWith(5)
    expect(wrapper.find('.schedule-detail').exists()).toBe(true)
  })
  it('shows submitted batch changes in the audit without claiming the approved date changed', async () => {
    const proposed = {
      batch_number: 1,
      planned_start_at: '2026-11-01T00:00:00Z',
      due_at: '2026-11-03T08:00:00Z',
      target_quantity: 100,
      target_weight: null,
      upstream_batch_ids: [],
    }
    vi.mocked(productionScheduleApi.detail).mockResolvedValue({
      ...record(),
      history: [
        {
          id: 11,
          action: 'plan_submitted',
          actor: '班组长',
          occurred_at: '2026-10-30T01:00:00Z',
          before: { batches: [] },
          after: { pending_batches: [proposed], batches: [] },
        },
      ],
    })
    await render()
    await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(5)
    await flushPromises()
    const event = wrapper.find('[data-schedule-event="11"]')
    expect(event.text()).toContain('第 1 批 · 开始')
    expect(event.text()).toContain('2026-11-03 16:00')
    expect(event.text()).not.toContain('本次操作未改变计划字段')
  })
  it('reuses node details on the admin board without fetching or rendering a second list', async () => {
    state.auth.isAdmin = true
    state.auth.isTeamAccount = false
    await render(true, false, false, true)
    expect(productionScheduleApi.list).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="交货排期列表"]').exists()).toBe(false)
    expect(wrapper.findComponent(TableExportButton).exists()).toBe(false)
    await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(5)
    await flushPromises()
    expect(wrapper.text()).toContain('805881-5')
    expect(button('修改批次计划')).toBeDefined()
  })
  it('shows the full task route but never exposes another team’s outbound action', async () => {
    const current = {
      ...record(),
      task_id: 11,
      task_no: 'PQ00000011',
      task_title: '第一批交货',
      completion_basis: 'quantity' as const,
      execution_state: 'partial' as const,
    }
    const next = {
      ...current,
      id: 6,
      team_id: 3,
      team_name: '研磨',
      predecessor_id: 5,
      sequence_no: 2,
    }
    vi.mocked(productionScheduleApi.detail).mockImplementation(async (id) =>
      id === 6 ? next : current,
    )
    vi.spyOn(productionScheduleApi, 'task').mockResolvedValue({
      id: 11,
      task_no: 'PQ00000011',
      title: '第一批交货',
      serial_no: current.serial_no,
      notes: null,
      version: 1,
      created_at: current.created_at,
      updated_at: current.updated_at,
      final_due_at: next.due_at,
      status: 'overdue',
      nodes: [current, next],
    })
    await render(false, true)
    expect(wrapper.text()).toContain('第一批交货')
    expect(wrapper.text()).toContain('按件数')
    expect(wrapper.text()).toContain('部分交货')
    expect(button('转出物料')).toBeDefined()
    await wrapper.get('[aria-label="整项任务交货路线"] li:nth-child(2) button').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.detail).toHaveBeenLastCalledWith(6)
    expect(button('转出物料')).toBeUndefined()
    expect(wrapper.emitted('dispatch')).toBeUndefined()
  })
  it('keeps the refreshed task route when an earlier detail request resolves late', async () => {
    state.auth.isAdmin = true
    state.auth.isTeamAccount = false
    const current = { ...record(), task_id: 11 }
    const cancelled: ProductionSchedule = {
      ...current,
      status: 'cancelled',
      cancelled_at: '2026-10-22T08:30:00Z',
    }
    const task: ScheduleTask = {
      id: 11,
      task_no: 'PQ00000011',
      title: '第一批交货',
      serial_no: current.serial_no,
      notes: null,
      version: 1,
      created_at: current.created_at,
      updated_at: current.updated_at,
      final_due_at: current.due_at,
      status: current.status,
      nodes: [current],
    }
    let finishOld!: (value: ScheduleTask) => void
    vi.mocked(productionScheduleApi.detail).mockResolvedValue(current)
    vi.spyOn(productionScheduleApi, 'task')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          }),
      )
      .mockResolvedValueOnce({ ...task, status: 'cancelled', version: 2, nodes: [cancelled] })
    await render(true, false, false, true)
    await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(5)
    await flushPromises()
    vi.mocked(productionScheduleApi.detail).mockResolvedValue(cancelled)
    await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(5)
    await flushPromises()
    expect(wrapper.get('.schedule-task-route').text()).toContain('已取消')
    finishOld(task)
    await flushPromises()
    expect(wrapper.get('.schedule-task-route').text()).toContain('已取消')
    expect(wrapper.get('.schedule-task-route').text()).not.toContain('已逾期')
  })
  it('preserves the inventory exact serial scope until the search text is changed', async () => {
    const router = await render()
    await router.push('/team-workspaces/2?tab=delivery-schedule&serial_no=805881-5')
    await flushPromises()
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ serial_no: '805881-5', team_id: 2 }),
    )
    wrapper.findComponent(ElInput).vm.$emit('update:modelValue', '823766')
    await button('查询').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ serial_no: undefined, query: '823766' }),
    )
  })
  it('applies and clears the overdue scope when navigating from the team overview', async () => {
    const router = await render()
    await router.push('/team-workspaces/2?tab=delivery-schedule&status=overdue')
    await flushPromises()
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ team_id: 2, status: 'overdue' }),
    )
    await router.push('/team-workspaces/2?tab=delivery-schedule&status=unknown')
    await flushPromises()
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ team_id: 2 }),
    )
    expect(vi.mocked(productionScheduleApi.list).mock.lastCall?.[0]?.status).toBeUndefined()
  })
  it('lets the owning team view commitments and deliveries without changing the plan', async () => {
    await render(false, true)
    expect(productionScheduleApi.list).toHaveBeenCalledWith(expect.objectContaining({ team_id: 2 }))
    expect(wrapper.text()).toContain('原交货时间：2026-10-22 15:00')
    expect(wrapper.text()).toContain('已作废')
    expect(wrapper.text()).toContain('下序签收件数')
    expect(wrapper.text()).toContain('有效转出件数')
    expect(button('修改批次计划')).toBeUndefined()
    expect(wrapper.findComponent(ScheduleBatchEditor).exists()).toBe(false)
    expect(button('转出物料')).toBeDefined()
    expect(button('取消排期')).toBeUndefined()
    expect(button('添加下序节点')).toBeUndefined()
    expect(button('新建排期')).toBeUndefined()
  })
  it('uses the same applied filters and columns for paged exports, including hour-zone boundaries', async () => {
    state.auth.isAdmin = true
    state.auth.isTeamAccount = false
    await render(true)
    expect(wrapper.findAllComponents(TableExportButton)).toHaveLength(1)
    wrapper.findComponent(ElInput).vm.$emit('update:modelValue', 'TL-产出')
    await button('筛选').trigger('click')
    await flushPromises()
    const selects = wrapper.findAllComponents(ElSelect)
    selects[0]!.vm.$emit('update:modelValue', 3)
    selects[1]!.vm.$emit('update:modelValue', 'overdue')
    wrapper
      .getComponent(RecordDateFilter)
      .vm.$emit('update:modelValue', { from: '2026-10-22', to: '2026-10-23' })
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    const expected = {
      query: 'TL-产出',
      team_id: 3,
      status: 'overdue',
      due_from: '2026-10-22T00:00:00+08:00',
      due_to: '2026-10-23T23:59:59+08:00',
    }
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith(expect.objectContaining(expected))
    wrapper.findComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    const rows = await source.load(new AbortController().signal, () => {})
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith({
      ...expected,
      page: 1,
      page_size: 100,
    })
    expect(rows[0]).toMatchObject({
      dispatched_quantity: 40,
      received_quantity: 20,
      remaining_quantity: 60,
    })
    expect(button('新建排期')).toBeUndefined()
  })
  it('keeps one workspace export in normal and fullscreen views with the current team filters', async () => {
    await render(false, false, true)
    expect(wrapper.findAll('button').filter((item) => item.text() === '导出')).toHaveLength(1)
    expect(wrapper.findComponent(TableExportButton).exists()).toBe(false)
    wrapper.findComponent(ElInput).vm.$emit('update:modelValue', '805881-5')
    await button('筛选').trigger('click')
    await flushPromises()
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'overdue')
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', {
      from: '2026-10-22',
      to: '2026-10-23',
    })
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    await wrapper.get('.team-workspace__export').trigger('click')
    expect(wrapper.emitted('export')).toHaveLength(1)
    const source = wrapper.getComponent(DeliverySchedules).vm.exportSource()
    await source.load(new AbortController().signal, () => {})
    expect(productionScheduleApi.list).toHaveBeenLastCalledWith({
      query: '805881-5',
      team_id: 2,
      status: 'overdue',
      due_from: '2026-10-22T00:00:00+08:00',
      due_to: '2026-10-23T23:59:59+08:00',
      page: 1,
      page_size: 100,
    })
    await wrapper.get('.team-workspace__fullscreen').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('button').filter((item) => item.text() === '导出')).toHaveLength(1)
    expect(button('退出全屏')).toBeDefined()
    expect(wrapper.getComponent(ElInput).props('modelValue')).toBe('805881-5')
  })
  it('opens the only available processed batch directly instead of reusing a consumed input batch', async () => {
    await render(false, true)
    await button('转出物料').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.sources).toHaveBeenCalledWith(
      expect.objectContaining({ schedule_id: 5, team_id: 2, serial_no: '805881-5' }),
    )
    expect(wrapper.emitted('dispatch')?.[0]?.[1]).toBe(99)
  })
  it('requires a deliberate batch choice when several current batches match', async () => {
    vi.mocked(productionScheduleApi.sources).mockResolvedValue({
      items: [option(99), option(100)],
      total: 2,
      page: 1,
      page_size: 10,
    })
    await render(false, true)
    await button('转出物料').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('dispatch')).toBeUndefined()
    const row = wrapper.findAll('tbody tr').find((item) => item.text().includes('TL-产出100'))!
    await row.get('button').trigger('click')
    expect(wrapper.emitted('dispatch')?.[0]?.[1]).toBe(100)
  })
})

it('shows the team delivery column control above the list', async () => {
  await render()
  const control = button('显示列')
  expect(control).toBeDefined()
  expect(control.element.closest('table')).toBeNull()
  expect(wrapper.get('.schedule-table').find('th .table-column-settings').exists()).toBe(false)
})

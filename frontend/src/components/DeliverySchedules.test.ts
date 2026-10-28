// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElInput, ElPagination, ElSelect } from 'element-plus'
import { h, reactive } from 'vue'
import DeliverySchedules from './DeliverySchedules.vue'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
import TableExportButton from './TableExportButton.vue'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import ProductionScheduleEditor from './ProductionScheduleEditor.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type {
  ProductionSchedule,
  ScheduleSourceOption,
  ScheduleTask,
} from '@/types/productionSchedule'

const state = vi.hoisted(() => ({
  auth: {
    isAdmin: false,
    isTeamAccount: true,
    currentUserError: '',
    currentUser: { active: true, team_id: 2 },
  },
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
  useLiveRefresh: () => ({ message: { value: '' }, request: vi.fn() }),
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
  state.auth = reactive({
    isAdmin: false,
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
    global: {
      plugins: [router],
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        MaterialTransferDrawer: true,
        ProductionScheduleEditor: true,
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
    expect(button('安排批次')).toBeDefined()
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
    expect(button('出库')).toBeDefined()
    await wrapper.get('[aria-label="整项任务交货路线"] li:nth-child(2) button').trigger('click')
    await flushPromises()
    expect(productionScheduleApi.detail).toHaveBeenLastCalledWith(6)
    expect(button('出库')).toBeUndefined()
    expect(wrapper.emitted('dispatch')).toBeUndefined()
  })
  it('keeps the refreshed task route when an earlier request resolves after cancelling its node', async () => {
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
    vi.spyOn(productionScheduleApi, 'cancel').mockResolvedValue(cancelled)
    await render(true, false, false, true)
    await (wrapper.vm as unknown as { openDetail: (id: number) => Promise<void> }).openDetail(5)
    await flushPromises()
    await button('取消排期').trigger('click')
    await button('确认取消').trigger('click')
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
  it('lets the owning team adjust commitments without cancelling or changing the route', async () => {
    await render(false, true)
    expect(productionScheduleApi.list).toHaveBeenCalledWith(expect.objectContaining({ team_id: 2 }))
    expect(wrapper.text()).toContain('原交货时间：2026-10-22 15:00')
    expect(wrapper.text()).toContain('已作废')
    expect(wrapper.text()).toContain('下序签收件数')
    expect(wrapper.text()).toContain('已转出件数')
    expect(button('安排批次')).toBeDefined()
    expect(button('取消排期')).toBeUndefined()
    expect(button('添加下序节点')).toBeUndefined()
    expect(button('新建排期')).toBeUndefined()
    expect(wrapper.findComponent(ProductionScheduleEditor).exists()).toBe(false)
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
    expect(button('新建排期')).toBeDefined()
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
    await button('全屏查看').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('button').filter((item) => item.text() === '导出')).toHaveLength(1)
    expect(button('退出全屏')).toBeDefined()
    expect(wrapper.getComponent(ElInput).props('modelValue')).toBe('805881-5')
  })
  it('opens the only available processed batch directly instead of reusing a consumed input batch', async () => {
    await render(false, true)
    await button('出库').trigger('click')
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
    await button('出库').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('dispatch')).toBeUndefined()
    const row = wrapper.findAll('tbody tr').find((item) => item.text().includes('TL-产出100'))!
    await row.get('button').trigger('click')
    expect(wrapper.emitted('dispatch')?.[0]?.[1]).toBe(100)
  })
})

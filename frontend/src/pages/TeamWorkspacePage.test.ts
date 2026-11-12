// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h, reactive, Transition } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FilterDialog from '@/components/FilterDialog.vue'
import { ElCheckbox, ElSelect } from 'element-plus'
import WorkspaceTools from '@/components/WorkspaceTools.vue'
import TeamWorkspacePage from './TeamWorkspacePage.vue'
import { appPinia } from '@/stores/access'
import { useSidebarStore } from '@/stores/sidebar'
import TeamInventory from '@/components/TeamInventory.vue'
import TeamProcessingRecords from '@/components/TeamProcessingRecords.vue'
import DeliverySchedules from '@/components/DeliverySchedules.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import type { ProcessingRecord } from '@/types/materialProcessing'
import ProcessingBatchPicker from '@/components/ProcessingBatchPicker.vue'
import QuantityAdjustmentDialog from '@/components/QuantityAdjustmentDialog.vue'
import TeamMaterialOverviewPanel from '@/components/TeamMaterialOverview.vue'
import TeamSerialHistory from '@/components/TeamSerialHistory.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialReceiptScanner from '@/components/MaterialReceiptScanner.vue'
import ReceiptPersonInput from '@/components/ReceiptPersonInput.vue'
import MaterialBatchPrintDialog from '@/components/MaterialBatchPrintDialog.vue'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import { ElPagination } from 'element-plus'
import { warehouseFixture } from '@/testFixtures/teamInventory'
import { showToast } from '@/stores/toast'
import { teamWorkspaceProfiles } from '@/config/teamWorkspaces'
import MaterialStockActionDialog from '@/components/MaterialStockActionDialog.vue'
import StockSourcePicker from '@/components/StockSourcePicker.vue'
import TeamReworkRequestDialog from '@/components/TeamReworkRequestDialog.vue'
import WarehouseReceiptDialog from '@/components/WarehouseReceiptDialog.vue'
import SerialReallocationDialog from '@/components/SerialReallocationDialog.vue'
import WarehouseManagement from '@/components/WarehouseManagement.vue'
import TableExportDialog from '@/components/TableExportDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import * as inventoryStream from '@/services/inventoryStream'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'
const receivingPerson = { id: 1, team_id: 914, name: '王师傅', active: true, version: 1 }
const state = vi.hoisted(() => ({
  auth: {
    isAdmin: false,
    isTeamAccount: true,
    currentUser: { id: 41, team_id: 914, active: true },
    currentUserError: '',
    refreshCurrentUser: vi.fn(),
  },
  directory: {
    items: [
      { id: 914, code: 'FACTORY-ROLL', name: '扎板', kind: 'production', active: true },
      { id: 900, code: 'FACTORY-QC', name: '检验', kind: 'production', active: true },
      { id: 901, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true },
    ],
    loaded: true,
    loading: false,
    error: '',
    refreshTeamDirectory: vi.fn(),
  },
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => state.auth,
  currentUser: {
    get value() {
      return state.auth.currentUser
    },
  },
}))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => state.directory }))
vi.mock('@/services/qualityFeedbackApi', () => ({
  qualityFeedbackApi: {
    records: vi.fn().mockResolvedValue({ items: [], total: 0, pending_count: 0 }),
  },
}))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const source = (id = 10): StockBatch =>
  ({
    transfer: normalizeMaterialTransfer({
      id,
      batch_no: `TL${id}`,
      serial_no: `SERIAL${id}`,
      source_team: { id: 1, name: '库房' },
      next_team: { id: 914, name: '轧制' },
      status: 'received',
      locked: true,
    }),
    available_quantity: 9,
    available_weight: 0.005,
    reserved_quantity: 1,
    reserved_weight: 0,
  }) as StockBatch
const summary: TeamMaterialOverview = {
  team_id: 914,
  totals: {
    available_quantity: 309,
    available_weight: 30.95,
    reserved_quantity: 10,
    reserved_weight: 1,
    in_transit_quantity: 10,
    in_transit_weight: 1,
    received_quantity: 330,
    received_weight: 33,
    dispatched_quantity: 10,
    dispatched_weight: 1,
    lost_quantity: 1,
    lost_weight: 0.05,
    on_hand_quantity: 309,
    on_hand_weight: 30.95,
  },
  materials: [],
  pending_incoming: { quantity: 130, weight: 13, count: 1 },
  legacy_received_count: 2,
}
let wrapper: VueWrapper
let subscription: inventoryStream.InventorySubscription<inventoryStream.InventoryChange>,
  stopStream: ReturnType<typeof vi.fn>
beforeEach(() => {
  const navigation = useSidebarStore(appPinia)
  navigation.workspaceQueries = {}
  navigation.workspaceModules = {}
  navigation.workspaceCounts = {}
  vi.spyOn(productionScheduleApi, 'inventory').mockResolvedValue({ groups: [], sources: [] })
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([receivingPerson])
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  stopStream = vi.fn()
  vi.spyOn(inventoryStream, 'subscribeInventoryChanges').mockImplementation((callbacks) => {
    subscription = callbacks
    return stopStream
  })
  state.auth = reactive({
    isAdmin: false,
    isTeamAccount: true,
    currentUser: { id: 41, team_id: 914, active: true },
    currentUserError: '',
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  })
  state.directory = reactive({ ...state.directory, loaded: true, loading: false, error: '' })
  vi.spyOn(teamMaterialApi, 'overview').mockImplementation(async () => ({ ...summary }))
  vi.spyOn(teamMaterialApi, 'teamInventory').mockResolvedValue({
    items: [],
    total: 45,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'processingTasks').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
    items: [source(), source(11)],
    total: 2,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'dispatches').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'receipts').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'reallocations').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'losses').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(materialTransferApi, 'list').mockResolvedValue({
    items: [normalizeMaterialTransfer({ ...source().transfer, status: 'pending', locked: false })],
    total: 1,
    page: 1,
    page_size: 10,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function render(path = '/team-workspaces/914', animate = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/team-workspaces/:teamId', component: TeamWorkspacePage },
      { path: '/transfer-batches', component: { template: '<div/>' } },
    ],
  })
  await router.push(path)
  const page = animate
    ? { setup: () => () => h(Transition, { name: 'page-shift' }, () => h(TeamWorkspacePage)) }
    : TeamWorkspacePage
  wrapper = mount(page, {
    global: {
      plugins: [router],
      stubs: {
        ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
        transition: !animate,
        StockSourcePicker: true,
        TeamReworkRequestDialog: true,
        DeliverySchedules: true,
        TeamAnalyticsCharts: true,
        TeamDashboard: true,
        SerialMaterialDrawer: true,
        LedgerChart: true,
        MaterialDispatchDrawer: true,
        BarcodeCard: true,
        MaterialTransferDrawer: true,
        MaterialStockActionDialog: true,
        SerialReallocationDialog: true,
        WarehouseReceiptDialog: true,
        WarehouseManagement: {
          props: ['canManage'],
          components: { WorkspaceTools },
          template: '<div><WorkspaceTools /></div>',
        },
      },
    },
  })
  await flushPromises()
  return router
}
describe('team workspace material ledger', () => {
  it('opens the shared team dashboard and carries its selected state into inventory', async () => {
    const router = await render('/team-workspaces/914?tab=dashboard')
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(914, true)
    const dashboard = wrapper.findComponent({ name: 'TeamDashboard' })
    expect(dashboard.props()).toMatchObject({ teamId: 914, processing: true })
    dashboard.vm.$emit('navigate', {
      tab: 'stock',
      availability: 'current',
      processing_state: 'partial',
    })
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      tab: 'stock',
      availability: 'current',
      processing_state: 'partial',
    })
    expect(dashboard.exists()).toBe(false)
  })
  it.each(['warehouse', 'administrator', 'foreign-qc', 'inactive-qc'])(
    'does not expose rework submission for %s',
    async (account) => {
      let teamId = 914
      if (account === 'warehouse') teamId = state.auth.currentUser.team_id = 901
      if (account === 'administrator') {
        state.auth.isTeamAccount = false
        state.auth.isAdmin = true
      }
      if (account === 'foreign-qc') teamId = 900
      if (account === 'inactive-qc') {
        teamId = state.auth.currentUser.team_id = 900
        state.auth.currentUser.active = false
      }
      await render(`/team-workspaces/${teamId}`)
      expect(wrapper.text()).not.toContain('提交返工问题')
    },
  )
  it('opens direct rework submission for the stock-holding production team', async () => {
    const router = await render('/team-workspaces/914')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '提交返工问题')!
      .trigger('click')
    expect(wrapper.findComponent(TeamReworkRequestDialog).exists()).toBe(true)
    expect(router.currentRoute.value.query.tab).not.toBe('quality-feedback')
    await router.push('/team-workspaces/900')
    await flushPromises()
    expect(wrapper.findComponent(TeamReworkRequestDialog).exists()).toBe(false)
  })
  it('takes the QC leader to quality issues instead of an unlinked stock request', async () => {
    state.auth.currentUser.team_id = 900
    const router = await render('/team-workspaces/900')
    const submit = wrapper.findAll('button').find((button) => button.text() === '提交返工问题')
    expect(submit).toBeDefined()
    await submit!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('quality-feedback')
    expect(wrapper.find('.rework-request').exists()).toBe(false)
  })

  it.each(['own-team', 'administrator', 'other-team', 'inactive', 'permission-error'])(
    'scopes the standalone settings page for %s',
    async (account) => {
      if (account === 'administrator') {
        state.auth.isTeamAccount = false
        state.auth.isAdmin = true
      }
      if (account === 'other-team') state.auth.currentUser.team_id = 901
      if (account === 'inactive') state.auth.currentUser.active = false
      if (account === 'permission-error') state.auth.currentUserError = '权限失效'
      await render('/team-workspaces/914?tab=settings')
      const allowed = ['own-team', 'administrator'].includes(account)
      expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(allowed)
      expect(wrapper.find('.team-settings-page').exists()).toBe(allowed)
      expect(wrapper.findComponent(TeamInventory).exists()).toBe(!allowed)
      expect(wrapper.find('[aria-label="班组设置"]').exists()).toBe(false)
      if (allowed) {
        expect(wrapper.getComponent(TeamBusinessDialog).props('inline')).toBe(true)
        expect(wrapper.text()).toContain('人员管理')
        expect(wrapper.text()).toContain('加工任务')
        expect(wrapper.get('[role=tab][aria-selected=true]').text()).toBe('人员管理')
        await wrapper.get('#tab-tasks').trigger('click')
        await flushPromises()
        expect(wrapper.get('[role=tab][aria-selected=true]').text()).toBe('加工任务')
        expect(wrapper.find('[aria-label="新增任务名称"]').exists()).toBe(true)
        expect(wrapper.find('.team-settings-page .el-dialog').exists()).toBe(false)
        await wrapper.get('#tab-production').trigger('click')
        await flushPromises()
        expect(wrapper.getComponent(TeamProcessingRecords).props('management')).toBe(true)
        expect(wrapper.getComponent(TeamProcessingRecords).props('teamCode')).toBe('FACTORY-ROLL')
      }
    },
  )

  it('shares sync problems with delivery schedules instead of rendering a second banner', async () => {
    vi.useFakeTimers()
    await render('/team-workspaces/914?tab=delivery-schedule')
    subscription.onState('reconnecting')
    await flushPromises()
    const schedules = wrapper.getComponent(DeliverySchedules)
    expect(schedules.props('syncMessage')).toContain('实时连接中断')
    expect(wrapper.find('.team-material-content > .live-refresh-notice').exists()).toBe(false)
    const previous = vi.mocked(teamMaterialApi.overview).mock.calls.length
    schedules.vm.$emit('retry-sync')
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(teamMaterialApi.overview).toHaveBeenCalledTimes(previous + 1)
    subscription.onState('live')
    await flushPromises()
    expect(schedules.props('syncMessage')).toBe('')
  })
  it('keeps the chosen schedule and current batch when opening dispatch from the schedule tab', async () => {
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [source(99)],
      total: 1,
      page: 1,
      page_size: 1,
    })
    await render('/team-workspaces/914?tab=delivery-schedule')
    const schedule = {
      id: 5,
      team_id: 914,
      serial_no: '805881-5',
      next_team_id: 900,
      external_destination: null,
    } as ProductionSchedule
    wrapper.getComponent(DeliverySchedules).vm.$emit('dispatch', schedule, 99)
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(914, {
      source_ids: '99',
      availability: 'dispatchable',
      page: 1,
      page_size: 1,
    })
    expect(wrapper.getComponent(MaterialStockActionDialog).props('initialSchedule')).toMatchObject({
      id: 5,
      next_team_id: 900,
    })
    expect(wrapper.getComponent(MaterialStockActionDialog).props('sources')[0].transfer.id).toBe(99)
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
  })
  it.each([
    ['FACTORY-ROLL', '轧制', true],
    ['FACTORY-ROLL', '轧制', false],
    ['FACTORY-WIRE', '线切割', true],
    ['FACTORY-WIRE', '线切割', false],
    ['FACTORY-ENGRAVE', '雕刻', true],
    ['FACTORY-ENGRAVE', '雕刻', false],
  ] as const)(
    'scopes processing registration to %s (%s) with write permission=%s',
    async (code, name, canWrite) => {
      const previous = state.directory.items
      try {
        state.directory.items = [{ id: 914, code, name, kind: 'production', active: true }]
        state.auth.isTeamAccount = canWrite
        state.auth.isAdmin = !canWrite
        vi.spyOn(teamMaterialApi, 'processingRecords').mockResolvedValue({
          items: [],
          total: 0,
          page: 1,
          page_size: 10,
        })
        vi.spyOn(teamMaterialApi, 'processingSources').mockResolvedValue({
          items: [source()],
          total: 1,
          page: 1,
          page_size: 10,
        })
        vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
          source_transfer_id: 10,
          batch_no: 'TL10',
          serial_no: 'YS-007',
          material_type: 'semi_finished',
          quantity: 1,
          weight: 100,
          revision: 0,
          as_of: '2026-10-09T00:00:00Z',
          items: [],
          total: 0,
          page: 1,
          page_size: 10,
        })
        const router = await render('/team-workspaces/914?tab=stock')
        expect(wrapper.getComponent(TeamInventory).props('processing')).toBe(true)
        expect(wrapper.find('.inventory-process').exists()).toBe(canWrite)
        if (canWrite) {
          await wrapper.get('.inventory-process').trigger('click')
          await flushPromises()
          expect(wrapper.getComponent(ProcessingBatchPicker).props()).toMatchObject({
            teamId: 914,
            groupId: undefined,
          })
          wrapper.getComponent(ProcessingBatchPicker).vm.$emit('close')
          await flushPromises()
        }
        wrapper.getComponent(TeamInventory).vm.$emit('process', 10)
        await flushPromises()
        expect(wrapper.findComponent(ProcessingBatchPicker).exists()).toBe(false)
        if (canWrite) {
          expect(teamMaterialApi.processingSources).toHaveBeenLastCalledWith(914, {
            group_id: 10,
            page: 1,
            page_size: 2,
          })
          const dialog = wrapper
            .findAllComponents(QuantityAdjustmentDialog)
            .find((component) => component.props('modelValue'))!
          expect(dialog.props()).toMatchObject({
            modelValue: true,
            processing: true,
            sourceId: 10,
            canWrite: true,
          })
          vi.mocked(teamMaterialApi.overview).mockClear()
          dialog.vm.$emit('saved', { id: 1 })
          await flushPromises()
          expect(teamMaterialApi.overview).toHaveBeenCalledWith(914)
        }
        await router.push('/team-workspaces/914?tab=processing')
        await flushPromises()
        expect(wrapper.getComponent(TeamProcessingRecords).props()).toMatchObject({
          teamId: 914,
          canWrite,
        })
        expect(wrapper.getComponent(QuantityAdjustmentDialog).props('modelValue')).toBe(false)
        await wrapper.get('.team-workspace__fullscreen').trigger('click')
        await flushPromises()
        expect(wrapper.getComponent(TeamProcessingRecords).props('fullscreen')).toBe(true)
        state.directory.items = [
          { id: 914, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true },
        ]
        await router.push('/team-workspaces/914?tab=processing')
        await flushPromises()
        expect(wrapper.findComponent(TeamProcessingRecords).exists()).toBe(false)
        expect(wrapper.getComponent(TeamInventory).props('processing')).toBe(false)
        expect(wrapper.find('.inventory-process').exists()).toBe(false)
      } finally {
        state.directory.items = previous
      }
    },
  )
  describe('processing row shortcuts', () => {
    const sources = (items = [source(42)], total = items.length) => ({
      items,
      total,
      page: 1,
      page_size: 2,
    })
    const rowButton = () =>
      wrapper
        .findAll('.inventory-row-actions button')
        .find((button) => button.text() === '加工登记')!
    const activeDialog = () =>
      wrapper
        .findAllComponents(QuantityAdjustmentDialog)
        .find((dialog) => dialog.props('modelValue'))
    beforeEach(() => {
      vi.mocked(teamMaterialApi.teamInventory).mockResolvedValue({
        items: [warehouseFixture({ group_id: 10 })],
        total: 1,
        page: 1,
        page_size: 10,
      })
      vi.spyOn(teamMaterialApi, 'processingSources').mockResolvedValue(sources())
      vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
        source_transfer_id: 42,
        batch_no: 'TL42',
        quantity: 1,
        weight: 100,
        revision: 0,
        as_of: '2026-10-12T00:00:00Z',
        items: [],
        total: 0,
        page: 1,
        page_size: 10,
      })
    })
    it.each([
      'FACTORY-ROLL',
      'FACTORY-WIRE',
      'FACTORY-ENGRAVE',
      'FACTORY-ANNEAL',
      'FACTORY-GRIND',
      'FACTORY-PLATE',
      'FACTORY-QC',
    ])('opens the sole eligible batch directly from the fullscreen %s stock row', async (code) => {
      const previous = state.directory.items
      try {
        state.directory.items = [
          { id: 914, code, name: '加工班组', kind: 'production', active: true },
        ]
        await render('/team-workspaces/914?tab=stock')
        await wrapper.get('.team-workspace__fullscreen').trigger('click')
        await rowButton().trigger('click')
        await flushPromises()
        expect(wrapper.findComponent(ProcessingBatchPicker).exists()).toBe(false)
        expect(activeDialog()?.props('sourceId')).toBe(42)
        expect(teamMaterialApi.quantityContext).toHaveBeenCalledWith(914, 42, 1)
      } finally {
        state.directory.items = previous
      }
    })
    it('keeps multiple eligible batches scoped to the clicked row and opens the chosen one', async () => {
      vi.mocked(teamMaterialApi.processingSources).mockResolvedValue(
        sources([source(42), source(43)]),
      )
      await render('/team-workspaces/914?tab=stock')
      await rowButton().trigger('click')
      await flushPromises()
      const picker = wrapper.getComponent(ProcessingBatchPicker)
      expect(picker.props('groupId')).toBe(10)
      expect(activeDialog()).toBeUndefined()
      picker.vm.$emit('selected', 42)
      await flushPromises()
      expect(activeDialog()?.props('sourceId')).toBe(42)
      expect(wrapper.findComponent(ProcessingBatchPicker).exists()).toBe(false)
    })
    it('does not open an empty second picker when the batch is no longer eligible', async () => {
      vi.mocked(teamMaterialApi.processingSources).mockResolvedValue(sources([]))
      await render('/team-workspaces/914?tab=stock')
      await rowButton().trigger('click')
      await flushPromises()
      expect(wrapper.findComponent(ProcessingBatchPicker).exists()).toBe(false)
      expect(activeDialog()).toBeUndefined()
      expect(showToast).toHaveBeenCalledWith(
        '该物料暂无可登记加工的在库批次，请刷新库存后重试',
        'info',
      )
    })
    it('prevents repeat entry while resolving a source and recovers from a failed lookup', async () => {
      let reject!: (reason: Error) => void
      vi.mocked(teamMaterialApi.processingSources).mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail
        }),
      )
      await render('/team-workspaces/914?tab=stock')
      await rowButton().trigger('click')
      wrapper.getComponent(TeamInventory).vm.$emit('process', 10)
      await flushPromises()
      expect(teamMaterialApi.processingSources).toHaveBeenCalledTimes(1)
      expect(rowButton().classes()).toContain('is-loading')
      expect(wrapper.get('.inventory-process').attributes('disabled')).toBeDefined()
      reject(new Error('网络中断'))
      await flushPromises()
      expect(showToast).toHaveBeenCalledWith('网络中断', 'error')
      expect(rowButton().attributes('disabled')).toBeUndefined()
      await rowButton().trigger('click')
      await flushPromises()
      expect(activeDialog()?.props('sourceId')).toBe(42)
    })
    it.each(['team', 'account', 'permission', 'tab', 'unmount'])(
      'ignores late batch selection after changing %s',
      async (change) => {
        let finish!: (value: ReturnType<typeof sources>) => void
        vi.mocked(teamMaterialApi.processingSources).mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          }),
        )
        const router = await render('/team-workspaces/914?tab=stock')
        await rowButton().trigger('click')
        if (change === 'team') await router.push('/team-workspaces/901?tab=stock')
        if (change === 'tab') await router.push('/team-workspaces/914?tab=outgoing')
        if (change === 'account') state.auth.currentUser.id = 99
        if (change === 'permission') state.auth.currentUserError = '权限刷新失败'
        if (change === 'unmount') wrapper.unmount()
        await flushPromises()
        finish(sources())
        await flushPromises()
        expect(teamMaterialApi.quantityContext).not.toHaveBeenCalled()
        expect(wrapper.findComponent(ProcessingBatchPicker).exists()).toBe(false)
      },
    )
  })
  describe('dispatch from processing records', () => {
    const record = {
      id: 7,
      source_transfer_id: 10,
      outputs: [
        { id: 41, role: 'remaining' },
        { id: 42, role: 'produced', quantity: 20, weight: 10 },
        { id: 43, role: 'scrap' },
      ],
    } as ProcessingRecord
    const result = (items = [source(42)]) => ({
      items,
      total: items.length,
      page: 1,
      page_size: 100,
    })
    const dispatch = (row = record) =>
      wrapper.getComponent(TeamProcessingRecords).vm.$emit('dispatch', row)
    beforeEach(() => {
      vi.spyOn(teamMaterialApi, 'processingRecords').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 10,
      })
      vi.mocked(teamMaterialApi.stock).mockResolvedValue(result())
    })
    it('opens the existing dispatch form with only this record’s produced stock and fresh balances', async () => {
      const router = await render('/team-workspaces/914?tab=processing&query=SERIAL42')
      dispatch()
      await flushPromises()
      expect(teamMaterialApi.stock).toHaveBeenCalledWith(914, {
        source_ids: '42',
        availability: 'available',
        page_size: 100,
      })
      const dialog = wrapper.getComponent(MaterialStockActionDialog)
      expect(dialog.props()).toMatchObject({
        modelValue: true,
        mode: 'dispatch',
        sources: [source(42)],
      })
      expect(router.currentRoute.value.query).toEqual({ tab: 'processing', query: 'SERIAL42' })
      expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
      const reads = vi.mocked(teamMaterialApi.processingRecords).mock.calls.length
      dialog.vm.$emit('saved', { items: [] })
      await flushPromises()
      await vi.waitFor(() =>
        expect(vi.mocked(teamMaterialApi.processingRecords).mock.calls.length).toBeGreaterThan(
          reads,
        ),
      )
    })
    it('supports historical registrations without output lots and uses their current balance', async () => {
      vi.mocked(teamMaterialApi.stock).mockResolvedValue(result([source(10)]))
      await render('/team-workspaces/914?tab=processing')
      dispatch({ ...record, outputs: [] })
      await flushPromises()
      expect(teamMaterialApi.stock).toHaveBeenCalledWith(
        914,
        expect.objectContaining({ source_ids: '10' }),
      )
      expect(wrapper.getComponent(MaterialStockActionDialog).props('sources')).toEqual([source(10)])
    })
    it('dispatches from production registration within team management', async () => {
      await render('/team-workspaces/914?tab=settings&management_tab=production')
      dispatch()
      await flushPromises()
      expect(wrapper.getComponent(MaterialStockActionDialog).props()).toMatchObject({
        modelValue: true,
        mode: 'dispatch',
        sources: [source(42)],
      })
    })
    it.each(['exhausted', 'quality-hold', 'rework', 'unprocessed'])(
      'does not open dispatch for %s stock',
      async (condition) => {
        const item = source(42)
        if (condition === 'exhausted') item.available_quantity = item.available_weight = 0
        if (condition === 'quality-hold') item.inspection_hold_id = 3
        if (condition === 'rework') item.transfer.rework_pending = true
        if (condition === 'unprocessed') item.processing_state = 'unregistered'
        vi.mocked(teamMaterialApi.stock).mockResolvedValue(result([item]))
        await render('/team-workspaces/914?tab=processing')
        dispatch()
        await flushPromises()
        expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'info')
      },
    )
    it('prevents duplicate lookups and allows retry after a lookup fails', async () => {
      let reject!: (error: Error) => void
      vi.mocked(teamMaterialApi.stock).mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail
        }),
      )
      await render('/team-workspaces/914?tab=processing')
      dispatch()
      dispatch()
      await flushPromises()
      expect(teamMaterialApi.stock).toHaveBeenCalledTimes(1)
      expect(wrapper.getComponent(TeamProcessingRecords).props('dispatchingRecordId')).toBe(7)
      reject(new Error('网络中断'))
      await flushPromises()
      expect(
        wrapper.getComponent(TeamProcessingRecords).props('dispatchingRecordId'),
      ).toBeUndefined()
      dispatch()
      await flushPromises()
      expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
    })
    it.each(['tab', 'account', 'permission'])(
      'ignores the pending dispatch lookup after changing %s',
      async (change) => {
        let finish!: (value: ReturnType<typeof result>) => void
        vi.mocked(teamMaterialApi.stock).mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve
          }),
        )
        const router = await render('/team-workspaces/914?tab=processing')
        dispatch()
        if (change === 'tab') await router.push('/team-workspaces/914?tab=outgoing')
        if (change === 'account') state.auth.currentUser.id = 99
        if (change === 'permission') state.auth.currentUserError = '权限刷新失败'
        await flushPromises()
        finish(result())
        await flushPromises()
        expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
      },
    )
  })
  it.each(['pending', 'receipts', 'outgoing', 'reallocations', 'losses'])(
    'exports %s with the same filters and team scope, closing on navigation',
    async (tab) => {
      const router = await render(
        `/team-workspaces/901?tab=${tab}&query=000A&date_from=2026-09-01&date_to=2026-09-30&urgent_only=true&material_type=finished&receipt_source=internal&entry_kind=transfer&status=received&next_team_id=900`,
      )
      await wrapper.get('.team-workspace__export').trigger('click')
      await flushPromises()
      const data = wrapper.getComponent(TableExportDialog).props('source')!
      expect(data.title).toContain(
        tab === 'pending'
          ? '来料待签收'
          : tab === 'receipts'
            ? '入库记录'
            : tab === 'outgoing'
              ? '出库记录'
              : tab === 'reallocations'
                ? '转投记录'
                : '丢失记录',
      )
      const method =
        tab === 'pending'
          ? materialTransferApi.list
          : tab === 'receipts'
            ? teamMaterialApi.receipts
            : tab === 'outgoing'
              ? teamMaterialApi.dispatches
              : tab === 'reallocations'
                ? teamMaterialApi.reallocations
                : teamMaterialApi.losses
      vi.mocked(method).mockClear()
      await data.load(new AbortController().signal, vi.fn())
      const filters = {
        query: '000A',
        date_from: '2026-09-01',
        date_to: '2026-09-30',
        urgent_only: true,
        page: 1,
        page_size: 100,
      }
      if (tab === 'pending')
        expect(method).toHaveBeenCalledWith(
          expect.objectContaining({
            ...filters,
            team_id: 901,
            direction: 'incoming',
            status: 'pending',
          }),
        )
      else
        expect(method).toHaveBeenCalledWith(
          901,
          expect.objectContaining({
            ...filters,
            ...(tab === 'receipts'
              ? { material_type: 'finished', receipt_source: 'internal' }
              : tab === 'outgoing'
                ? {
                    material_type: 'finished',
                    entry_kind: 'transfer',
                    status: 'received',
                    next_team_id: '900',
                  }
                : tab === 'reallocations'
                  ? { material_type: 'finished' }
                  : {}),
          }),
        )
      await router.push('/team-workspaces/914?tab=stock')
      await flushPromises()
      expect(wrapper.getComponent(TableExportDialog).props('source')).toBeNull()
    },
  )
  it.each([true, false])(
    'retains permissions and filters in fullscreen for team account=%s',
    async (teamAccount) => {
      state.auth.isTeamAccount = teamAccount
      state.auth.isAdmin = !teamAccount
      const router = await render('/team-workspaces/914?tab=stock&page=2&material_name=材料1')
      const inventory = wrapper.getComponent(TeamInventory).element
      const calls = vi.mocked(teamMaterialApi.overview).mock.calls.length
      await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      expect(wrapper.getComponent(TeamInventory).props()).toMatchObject({
        fullscreen: true,
        canWrite: teamAccount,
      })
      expect(wrapper.getComponent(TeamInventory).element).toBe(inventory)
      expect(router.currentRoute.value.query).toEqual({
        tab: 'stock',
        page: '2',
        material_name: '材料1',
      })
      expect(teamMaterialApi.overview).toHaveBeenCalledTimes(calls)
      await router.push('/team-workspaces/914?tab=material-types')
      await flushPromises()
      expect(wrapper.getComponent(TeamInventory).props('fullscreen')).toBe(true)
      await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      expect(wrapper.getComponent(TeamInventory).props('fullscreen')).toBe(false)
    },
  )
  it.each([true, false])(
    'shows searchable reallocation records and details in fullscreen for administrator=%s',
    async (admin) => {
      state.auth.isAdmin = admin
      state.auth.isTeamAccount = !admin
      const row = normalizeMaterialTransfer({
        id: 30,
        entry_kind: 'serial_reallocation',
        source_serial_no: '000A',
        serial_no: '000B',
        source_transfer_batch_no: 'TL001',
        batch_no: 'TL002',
        quantity: 12,
        weight: 1.5,
        notes: null,
        transferred_by: '库房班组长',
        transferred_at: '2026-10-09T08:00:00Z',
      })
      vi.mocked(teamMaterialApi.reallocations).mockResolvedValue({
        items: [row],
        total: 21,
        page: 1,
        page_size: 10,
      })
      const router = await render(
        '/team-workspaces/901?tab=reallocations&query=000A&material_type=semi_finished',
      )
      expect(teamMaterialApi.reallocations).toHaveBeenCalledWith(
        901,
        expect.objectContaining({ query: '000A', material_type: 'semi_finished' }),
      )
      expect(wrapper.get('h1').text()).toBe('转投记录')
      const table = wrapper.get('.team-table')
      expect(table.text()).toContain('000A')
      expect(table.text()).toContain('000B')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'TL001')!
        .trigger('click')
      await flushPromises()
      expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({
        modelValue: true,
        batchNo: 'TL001',
      })
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '查看详情')!
        .trigger('click')
      await flushPromises()
      expect(wrapper.getComponent(MaterialTransferDrawer).props('transfer')).toMatchObject({
        id: 30,
        serial_no: '000B',
      })
      expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(false)
      expect(wrapper.find('input[aria-label="转投记录搜索"]').exists()).toBe(true)
      wrapper.getComponent(WorkspacePagination).vm.$emit('current-change', 2)
      await flushPromises()
      expect(router.currentRoute.value.query).toMatchObject({
        tab: 'reallocations',
        query: '000A',
        page: '2',
        material_type: 'semi_finished',
      })
      await router.push('/team-workspaces/914?tab=reallocations')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('转投记录')
      expect(teamMaterialApi.reallocations).toHaveBeenCalledWith(914, expect.any(Object))
    },
  )
  it('opens reallocation only for own-team stock and refreshes inventory after saving', async () => {
    const previous = state.directory.items
    try {
      state.directory.items = [
        { id: 914, code: 'FACTORY-PLATE', name: '电镀', kind: 'production', active: true },
      ]
      const router = await render('/team-workspaces/914?tab=stock&query=000A')
      expect(wrapper.getComponent(TeamInventory).props('canReallocate')).toBe(true)
      wrapper.getComponent(TeamInventory).vm.$emit('reallocate', source())
      await flushPromises()
      const dialog = wrapper.getComponent(SerialReallocationDialog)
      expect(dialog.props()).toMatchObject({ modelValue: true, teamId: 914, source: source() })
      vi.mocked(teamMaterialApi.overview).mockClear()
      dialog.vm.$emit(
        'saved',
        normalizeMaterialTransfer({ serial_no: '000B', source_serial_no: 'SERIAL10' }),
      )
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({})
      expect(teamMaterialApi.overview).toHaveBeenCalled()
      expect(wrapper.findComponent(SerialReallocationDialog).exists()).toBe(false)
      expect(wrapper.findComponent(MaterialBatchPrintDialog).props('modelValue')).toBe(false)
      state.auth.isAdmin = true
      state.auth.isTeamAccount = false
      await flushPromises()
      expect(wrapper.getComponent(TeamInventory).props('canReallocate')).toBe(false)
      wrapper.getComponent(TeamInventory).vm.$emit('reallocate', source())
      await flushPromises()
      expect(wrapper.findComponent(SerialReallocationDialog).exists()).toBe(false)
    } finally {
      state.directory.items = previous
    }
  })
  it.each(teamWorkspaceProfiles)(
    'uses actual remaining stock and keeps pending outbound separate for $name',
    async (profile) => {
      const previous = state.directory.items
      state.directory.items = [
        {
          id: 914,
          code: profile.code,
          name: profile.name,
          active: true,
          kind: profile.code === 'FACTORY-WAREHOUSE' ? 'warehouse' : 'production',
        },
      ]
      vi.mocked(teamMaterialApi.teamInventory).mockResolvedValue({
        items: [
          warehouseFixture({
            owned_quantity: 100,
            owned_weight: 10,
            on_hand_quantity: 70,
            on_hand_weight: 7,
            available_quantity: 70,
            available_weight: 7,
            in_transit_quantity: 30,
            in_transit_weight: 3,
          }),
        ],
        total: 1,
        page: 1,
        page_size: 10,
      })
      try {
        await render('/team-workspaces/914?tab=stock')
        expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
          914,
          expect.objectContaining({ availability: 'current' }),
        )
        expect(
          wrapper
            .get('.warehouse-table')
            .findAll('.inventory-balance')
            .map((cell) => cell.text()),
        ).toEqual(['70'])
        expect(
          wrapper
            .get('.inventory-row-actions')
            .findAll('button')
            .some((button) => button.text() === '出库'),
        ).toBe(true)
        expect(wrapper.get('.inventory-row-actions').text()).toContain('在途转出')
      } finally {
        state.directory.items = previous
      }
    },
  )
  it.each(['pending', 'receipts', 'outgoing', 'losses'])(
    'keeps %s record fields in separate single-line cells and preserves batch details',
    async (tab) => {
      const transfer = normalizeMaterialTransfer({
        ...source().transfer,
        serial_no: '00001234',
        material_name: '铜钼 CuMo70',
        material_type: 'semi_finished',
        purpose_name: '去毛刺',
        quantity: 30,
        weight: 1.234,
        transferred_by: '张师傅',
        transferred_at: '2026-09-27T12:30:00',
        received_by: '李师傅',
        received_at: '2026-09-27T13:30:00',
      })
      const result = { items: [transfer], total: 1, page: 1, page_size: 10 }
      vi.mocked(materialTransferApi.list).mockResolvedValue(result)
      vi.mocked(teamMaterialApi.receipts).mockResolvedValue(result)
      vi.mocked(teamMaterialApi.dispatches).mockResolvedValue(result)
      vi.mocked(teamMaterialApi.losses).mockResolvedValue({
        ...result,
        items: [
          {
            id: 1,
            loss_no: 'LS00001',
            source_transfer_id: Number(transfer.id),
            batch_no: transfer.batch_no,
            serial_no: transfer.serial_no,
            material_name: transfer.material_name ?? null,
            quantity: 30,
            weight: 1.234,
            reason: '搬运时遗失，已核查现场',
            created_by: '张师傅',
            created_at: transfer.transferred_at,
            team_id: 914,
          },
        ],
      })
      await render(`/team-workspaces/${tab === 'receipts' ? 901 : 914}?tab=${tab}`)
      const table = wrapper.get('.team-table')
      const headings = table.findAll('thead th').map((cell) => cell.text())
      expect(table.classes()).toContain('single-line-table')
      expect(headings).toContain('流水号')
      expect(headings).toContain('材质')
      expect(headings).toContain(tab === 'losses' ? '来源批次号' : '批次号')
      expect(headings).not.toContain('批次 / 流水号')
      expect(table.find('.cell-secondary').exists()).toBe(false)
      const cells = table.findAll('.el-table__body tr').at(0)!.findAll('td')
      expect(cells[headings.indexOf('流水号')]!.text()).toBe('00001234')
      expect(cells[headings.indexOf('材质')]!.text()).toBe('铜钼 CuMo70')
      expect(cells[headings.indexOf('件数')]!.text()).toBe('30')
      expect(cells[headings.indexOf('重量 (kg)')]!.text()).toBe('1.234')
      expect(headings).not.toContain('数量 / 重量')
      expect(headings).not.toContain('类型 / 业务')
      if (tab !== 'losses') {
        expect(cells[headings.indexOf('物料类型')]!.text()).toBe('半成品')
        expect(cells[headings.indexOf('接收任务')]!.text()).toBe('去毛刺')
        if (tab === 'outgoing')
          expect(headings.indexOf('接收任务')).toBe(headings.indexOf('下序 / 去向') + 1)
      }
      const instance = wrapper.getComponent({ name: 'ElTable' }).element
      if (tab === 'receipts')
        expect(wrapper.find('.team-workspace__fullscreen').exists()).toBe(false)
      else await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      expect(wrapper.getComponent({ name: 'ElTable' }).props()).toMatchObject({
        height: '100%',
        flexible: true,
      })
      expect(wrapper.getComponent({ name: 'ElTable' }).element).toBe(instance)
      if (tab === 'pending' && wrapper.findComponent(MaterialReceiptScanner).exists())
        expect(wrapper.getComponent(MaterialReceiptScanner).props('paused')).toBe(true)
      if (tab !== 'receipts') await wrapper.get('.team-workspace__fullscreen').trigger('click')
      await flushPromises()
      expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBe('100%')
      if (tab === 'pending' && wrapper.findComponent(MaterialReceiptScanner).exists())
        expect(wrapper.getComponent(MaterialReceiptScanner).props('paused')).toBe(false)
      expect(table.find('.barcode-card').exists()).toBe(false)
      await table.get('.batch-link').trigger('click')
      await flushPromises()
      expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({
        modelValue: true,
        batchNo: 'TL10',
        allowPrint: tab !== 'pending',
        receiptOnly: tab === 'pending',
      })
      expect(wrapper.find('.team-list-layout--detail, .team-workspace--docked').exists()).toBe(
        false,
      )
      expect(wrapper.getComponent(MaterialTransferDrawer).attributes('docked')).toBeUndefined()
      if (tab === 'outgoing') {
        wrapper.getComponent({ name: 'ElTable' }).vm.$emit('selection-change', [transfer])
        await flushPromises()
        await wrapper
          .findAll('button')
          .find((button) => button.text().startsWith('合并打印'))!
          .trigger('click')
        await flushPromises()
        expect(wrapper.getComponent(MaterialBatchPrintDialog).props()).toMatchObject({
          modelValue: true,
          items: [transfer],
        })
      }
    },
  )
  it('supports the real page transition without a fragment-root animation warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await render('/team-workspaces/914', true)
    expect(wrapper.find('.team-workspace').exists()).toBe(true)
    expect(warn.mock.calls.flat().join(' ')).not.toContain('non-element root node')
  })
  it('shares actual pending counts with navigation without extra requests', async () => {
    const router = await render()
    expect(useSidebarStore(appPinia).workspaceCounts['914']?.pending).toBe(1)
    expect(teamMaterialApi.overview).toHaveBeenCalledOnce()
    await router.push('/team-workspaces/nope')
    await flushPromises()
    expect(wrapper.find('.team-workspace__pending').exists()).toBe(false)
  })
  it('switches sections inside the page and restores inventory filters on browser back', async () => {
    const router = await render('/team-workspaces/914?query=铜&page=2&page_size=20')
    const navigation = () => wrapper.get('nav[aria-label$="视图"]')
    await navigation().get('[aria-current=page]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ query: '铜', page: '2', page_size: '20' })
    await router.push('/team-workspaces/914?tab=pending')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/914?tab=pending')
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ team_id: 914, direction: 'incoming', status: 'pending', page: 1 }),
    )
    expect(navigation().get('[aria-current=page]').text()).toBe('来料待签收1')
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(false)
    await router.back()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ query: '铜', page: '2', page_size: '20' })
    expect(navigation().get('[aria-current=page]').text()).toBe('库存明细')
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(true)
  })
  it('restores inventory filters when switching back from loss records', async () => {
    const router = await render('/team-workspaces/914?query=铜&page=2&page_size=20')
    const switchView = async (label: string) => {
      await wrapper
        .findAll('nav[aria-label$="视图"] button')
        .find((button) => button.text() === label)!
        .trigger('click')
      await flushPromises()
    }
    await switchView('丢失记录')
    expect(router.currentRoute.value.query.tab).toBe('losses')
    await switchView('库存明细')
    expect(router.currentRoute.value.query).toEqual({ query: '铜', page: '2', page_size: '20' })
  })
  it('refreshes the in-page pending count through existing push updates', async () => {
    vi.useFakeTimers()
    await render()
    vi.mocked(teamMaterialApi.overview).mockResolvedValue({
      ...summary,
      pending_incoming: { ...summary.pending_incoming, count: 5 },
    })
    subscription.onData({ changed: true, team_ids: [914] })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(useSidebarStore(appPinia).workspaceCounts['914']?.pending).toBe(5)
    expect(wrapper.get('nav[aria-label$="视图"] [aria-current=page]').text()).toBe('库存明细')
  })
  it.each(['sludge', 'unknown'])(
    'redirects retired type inventory with the %s filter intact',
    async (type) => {
      const router = await render(
        `/team-workspaces/914?tab=material-types&material_type=${type}&page=2`,
      )
      expect(wrapper.get('h1').text()).toBe('库存明细')
      expect(wrapper.findComponent(TeamMaterialOverviewPanel).exists()).toBe(false)
      expect(router.currentRoute.value.query).toMatchObject({
        tab: 'stock',
        material_type: type,
        page: '2',
      })
      expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
        914,
        expect.objectContaining({ material_type: type, page: 2 }),
      )
    },
  )
  it('redirects the retired material summary to inventory and retains its filters', async () => {
    const router = await render('/team-workspaces/914?tab=materials&material_name=铜钼&page=2')
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.findComponent(TeamMaterialOverviewPanel).exists()).toBe(false)
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(true)
    expect(router.currentRoute.value.query.material_name).toBe('铜钼')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ material_name: '铜钼', page: 2 }),
    )
  })
  it('ignores unrelated teams and only reloads identity/directory when those actually change', async () => {
    vi.useFakeTimers()
    const router = await render('/team-workspaces/914?tab=stock&query=AL&page=2')
    vi.mocked(teamMaterialApi.overview).mockClear()
    vi.mocked(teamMaterialApi.teamInventory).mockClear()
    state.auth.refreshCurrentUser.mockClear()
    state.directory.refreshTeamDirectory.mockClear()
    subscription.onData({ changed: true, team_ids: [900, 901] })
    subscription.onData({ changed: true, team_ids: [], accounts_changed: true })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(teamMaterialApi.overview).not.toHaveBeenCalled()
    expect(teamMaterialApi.teamInventory).not.toHaveBeenCalled()
    subscription.onData({ changed: true, team_ids: [914, 901] })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(teamMaterialApi.overview).toHaveBeenCalledOnce()
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledOnce()
    expect(state.auth.refreshCurrentUser).not.toHaveBeenCalled()
    expect(state.directory.refreshTeamDirectory).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query).toMatchObject({ query: 'AL', page: '2' })
    subscription.onData({ changed: true, team_ids: [], current_user_changed: true })
    subscription.onData({ changed: true, team_ids: [], directory_changed: true })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(state.auth.refreshCurrentUser).toHaveBeenCalledOnce()
    expect(state.directory.refreshTeamDirectory).toHaveBeenCalledOnce()
  })
  it('redirects the old serial tab while retaining filters and provides only one inventory tab', async () => {
    const router = await render(
      '/team-workspaces/914?tab=serials&query=AL&date_from=2026-09-12&urgent_only=true&page=2&page_size=20#detail',
    )
    expect(router.currentRoute.value.query).toEqual({
      tab: 'stock',
      query: 'AL',
      date_from: '2026-09-12',
      urgent_only: 'true',
      page: '2',
      page_size: '20',
    })
    expect(router.currentRoute.value.hash).toBe('#detail')
    expect(wrapper.find('[role=tablist]').exists()).toBe(false)
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.text()).not.toContain('流水号台账')
    expect(teamMaterialApi.stock).not.toHaveBeenCalled()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({
        availability: 'current',
        query: 'AL',
        date_from: '2026-09-12',
        urgent_only: true,
        page: 2,
        page_size: 20,
      }),
    )
  })
  it('coalesces pushed changes, preserves filters and drafts, and closes its stream', async () => {
    vi.useFakeTimers()
    const router = await render('/team-workspaces/914?tab=stock&query=AL&page=2&page_size=20')
    await wrapper.get('input[aria-label="库存明细搜索"]').setValue('还未查询')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建出库')!
      .trigger('click')
    await flushPromises()
    const before = vi.mocked(teamMaterialApi.teamInventory).mock.calls.length
    for (let index = 0; index < 12; index++) subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledTimes(before + 1)
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ query: 'AL', page: 2, page_size: 20 }),
    )
    expect(router.currentRoute.value.query.page).toBe('2')
    expect(
      (wrapper.get('input[aria-label="库存明细搜索"]').element as HTMLInputElement).value,
    ).toBe('还未查询')
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(true)
    subscription.onState('reconnecting')
    await flushPromises()
    expect(wrapper.text()).toContain('实时连接中断')
    const count = vi.mocked(teamMaterialApi.teamInventory).mock.calls.length
    wrapper.unmount()
    subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(stopStream).toHaveBeenCalledOnce()
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledTimes(count)
  })
  it('keeps the last table on a pushed read failure and reconnects after becoming visible', async () => {
    vi.useFakeTimers()
    await render('/team-workspaces/914?tab=stock')
    const table = wrapper.get('.el-table').element
    vi.mocked(teamMaterialApi.teamInventory).mockRejectedValueOnce(new Error('offline'))
    subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.text()).toContain('保留上次结果')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stopStream).toHaveBeenCalledOnce()
    const count = vi.mocked(teamMaterialApi.teamInventory).mock.calls.length
    subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledTimes(count)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(inventoryStream.subscribeInventoryChanges).toHaveBeenCalledTimes(2)
  })
  it('starts dispatch from the ledger without changing its route and shows the saved group', async () => {
    const router = await render('/team-workspaces/914?tab=stock&query=AL&page=2')
    const path = router.currentRoute.value.fullPath
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建出库')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(StockSourcePicker).props('teamId')).toBe(914)
    wrapper.getComponent(StockSourcePicker).vm.$emit('selected', [source(), source(11)])
    await flushPromises()
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
    expect(wrapper.getComponent(MaterialStockActionDialog).props()).toMatchObject({
      modelValue: true,
      teamId: 914,
      mode: 'dispatch',
      sources: [source(), source(11)],
    })
    expect(router.currentRoute.value.fullPath).toBe(path)
    wrapper.getComponent(MaterialStockActionDialog).vm.$emit('saved', dispatchFixture())
    await flushPromises()
    expect(wrapper.getComponent(MaterialBatchPrintDialog).props()).toMatchObject({
      modelValue: true,
      items: dispatchFixture().items,
    })
  })
  it('opens this team’s pending outbound records from the empty stock picker', async () => {
    const router = await render('/team-workspaces/914?tab=stock&query=AL&page=2')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建出库')!
      .trigger('click')
    await flushPromises()
    wrapper.getComponent(StockSourcePicker).vm.$emit('outbound')
    await flushPromises()
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
    expect(router.currentRoute.value.query).toEqual({ tab: 'outgoing', status: 'pending' })
    expect(teamMaterialApi.dispatches).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ status: 'pending', page: 1 }),
    )
  })
  it('closes the picker on navigation and ignores a late permission refresh after cancellation', async () => {
    const router = await render()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建出库')!
      .trigger('click')
    await flushPromises()
    await router.push('/team-workspaces/914?tab=outgoing')
    await flushPromises()
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建出库')!
      .trigger('click')
    await flushPromises()
    let finish!: () => void
    state.auth.refreshCurrentUser.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    wrapper.getComponent(StockSourcePicker).vm.$emit('selected', [source()])
    await flushPromises()
    wrapper.getComponent(StockSourcePicker).vm.$emit('close')
    await flushPromises()
    finish()
    await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
  })
  it('defaults to ten records and keeps selectable page sizes in a bounded table', async () => {
    vi.mocked(teamMaterialApi.teamInventory).mockResolvedValue({
      items: Array.from({ length: 10 }, (_, index) =>
        warehouseFixture({ group_id: index + 1, serial_no: `SERIAL-${index}` }),
      ),
      total: 45,
      page: 1,
      page_size: 10,
    })
    await render('/team-workspaces/914?tab=stock')
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    const pagination = wrapper.getComponent(ElPagination)
    expect(pagination.props('pageSizes')).toEqual([10, 20, 50, 100])
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBe('100%')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ page_size: 10 }),
    )
    pagination.vm.$emit('size-change', 20)
    await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ page: 1, page_size: 20 }),
    )
    expect(wrapper.vm.$route.query.page_size).toBe('20')
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
    await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ page: 1, page_size: 10 }),
    )
    expect(wrapper.vm.$route.query.page_size).toBe('10')
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 100)
    await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ page: 1, page_size: 100 }),
    )
  })
  it('provides separate analysis, serial and material pages with authoritative balances', async () => {
    const router = await render()
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.findAll('[role=tab]')).toHaveLength(0)
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(914)
    expect(wrapper.find('.team-workspace__heading').exists()).toBe(true)
    expect(wrapper.find('.workspace-balance-strip').exists()).toBe(false)
    expect(wrapper.get('h1').classes()).toContain('sr-only')
    expect(wrapper.get('nav[aria-label$="视图"] [aria-current=page]').text()).toBe('库存明细')
    expect(wrapper.get('.workspace-toolbar .workspace-actions').text()).toContain('新建出库')
    expect(wrapper.text()).toContain('2 张历史已接收单')
    expect(wrapper.find('a[href*="next_team_id=914"]').exists()).toBe(true)
    expect(materialTransferApi.list).not.toHaveBeenCalled()
    expect(wrapper.findComponent(TeamSerialHistory).exists()).toBe(false)
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(true)
    await router.push('/team-workspaces/914?tab=history')
    await flushPromises()
    expect(wrapper.findComponent(TeamSerialHistory).exists()).toBe(true)
    expect(wrapper.text()).toContain('本班组收发')
    expect(wrapper.text()).not.toContain('内部在途')
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(false)
    await router.push('/team-workspaces/914')
    await flushPromises()
    expect(wrapper.findComponent(TeamSerialHistory).exists()).toBe(false)
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(true)
    vi.mocked(teamMaterialApi.overview).mockClear()
    wrapper.getComponent(TeamInventory).vm.$emit('changed')
    await flushPromises()
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(914)
  })
  it.each([
    ['serials', ['新建入库', '新建出库', '扫码入库']],
    ['stock', ['新建入库', '新建出库', '扫码入库']],
    ['outgoing', ['新建出库']],
    ['pending', []],
    ['receipts', ['新建入库']],
    ['losses', ['登记丢失']],
    ['reallocations', ['新建转投']],
    ['materials', ['新建入库', '新建出库', '扫码入库']],
    ['material-types', ['新建入库', '新建出库', '扫码入库']],
    ['overview', []],
    ['history', []],
  ] as const)('shows only relevant actions on warehouse %s', async (tab, labels) => {
    state.auth.currentUser.team_id = 901
    await render(`/team-workspaces/901?tab=${tab}`)
    expect(wrapper.findAll('.workspace-actions button').map((button) => button.text())).toEqual(
      labels,
    )
    if (tab === 'pending')
      expect(wrapper.get('.incoming-scan .scanner-inline').text()).toContain('入库')
    expect(wrapper.findAll('.workspace-actions')).toHaveLength(labels.length ? 1 : 0)
    expect(wrapper.find('.workspace-data-toolbar [aria-label="班组设置"]').exists()).toBe(false)
    await wrapper.get('nav[aria-label$="视图"] button').trigger('click')
    await flushPromises()
    const choices = Array.from(document.querySelectorAll('[role=menuitemradio]')).map(
      (item) => item.textContent,
    )
    if (['outgoing', 'pending', 'receipts', 'reallocations', 'overview', 'history'].includes(tab)) {
      expect(choices).toHaveLength(5)
      expect(choices).toContain('转投记录')
    } else expect(choices).toEqual(['库存明细', '丢失记录'])
    expect(choices).not.toContain('类型库存')
  })
  it.each(['losses', 'reallocations'] as const)(
    'opens %s from its toolbar and refreshes records after saving',
    async (tab) => {
      state.auth.currentUser.team_id = 901
      const router = await render(`/team-workspaces/901?tab=${tab}&query=TL`)
      const label = tab === 'losses' ? '登记丢失' : '新建转投'
      await wrapper
        .findAll('button')
        .find((button) => button.text() === label)!
        .trigger('click')
      await flushPromises()
      expect(wrapper.getComponent(StockSourcePicker).props()).toMatchObject({
        teamId: 901,
        mode: tab === 'losses' ? 'loss' : 'reallocate',
      })
      const batch = {
        ...source(),
        transfer: {
          ...source().transfer,
          next_team: { id: 901, name: '库房', code: 'FACTORY-WAREHOUSE' },
        },
      }
      wrapper.getComponent(StockSourcePicker).vm.$emit('selected', [batch])
      await flushPromises()
      expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
      if (tab === 'losses') {
        const dialog = wrapper.getComponent(MaterialStockActionDialog)
        expect(dialog.props()).toMatchObject({
          modelValue: true,
          mode: 'loss',
          teamId: 901,
          sources: [batch],
        })
        vi.mocked(teamMaterialApi.losses).mockClear()
        dialog.vm.$emit('saved', { loss_no: 'LS-NEW' })
        await flushPromises()
        expect(teamMaterialApi.losses).toHaveBeenCalledWith(
          901,
          expect.objectContaining({ query: 'TL' }),
        )
      } else {
        const dialog = wrapper.getComponent(SerialReallocationDialog)
        expect(dialog.props()).toMatchObject({ modelValue: true, teamId: 901, source: batch })
        vi.mocked(teamMaterialApi.reallocations).mockClear()
        dialog.vm.$emit('saved', { source_serial_no: '691236-50', serial_no: '691236-51' })
        await flushPromises()
        expect(teamMaterialApi.reallocations).toHaveBeenCalledWith(
          901,
          expect.objectContaining({ query: 'TL' }),
        )
      }
      expect(router.currentRoute.value.query).toEqual({ tab, query: 'TL' })
    },
  )
  it.each(['losses', 'reallocations'] as const)(
    'rechecks permissions before opening the %s picker',
    async (tab) => {
      state.auth.currentUser.team_id = 901
      await render(`/team-workspaces/901?tab=${tab}`)
      state.auth.refreshCurrentUser.mockImplementationOnce(async () => {
        state.auth.currentUser.team_id = 914
      })
      await wrapper.get('.workspace-actions button').trigger('click')
      await flushPromises()
      expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
      expect(wrapper.find('.workspace-actions').exists()).toBe(false)
    },
  )
  it.each(['administrator', 'other-team', 'inactive'])(
    'does not expose creation for %s accounts',
    async (kind) => {
      if (kind === 'administrator') {
        state.auth.isTeamAccount = false
        state.auth.isAdmin = true
      }
      if (kind === 'other-team') state.auth.currentUser.team_id = 900
      if (kind === 'inactive') state.auth.currentUser.active = false
      await render()
      expect(wrapper.findAll('button').some((button) => button.text() === '新建出库')).toBe(false)
      expect(wrapper.text()).not.toContain('仅查看')
      expect(wrapper.find('[aria-label="班组设置"]').exists()).toBe(false)
      expect(wrapper.find('.workspace-toolbar [aria-label="刷新工作台"]').exists()).toBe(true)
      expect(wrapper.getComponent(TeamInventory).props('canWrite')).toBe(false)
      wrapper.getComponent(TeamInventory).vm.$emit('action', 'loss', [source()])
      await flushPromises()
      expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
    },
  )
  it('separates scanning and creation from record filters without removing date or urgency filters', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      items: [
        normalizeMaterialTransfer({
          ...source().transfer,
          status: 'pending',
          purpose_id: 31,
          purpose_name: '去毛刺',
        }),
      ],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render('/team-workspaces/914?tab=pending')
    expect(wrapper.get('.team-table').text()).toContain('去毛刺')
    expect(wrapper.find('[aria-label="班组设置"]').exists()).toBe(false)
    const toolbar = wrapper.get('.workspace-toolbar')
    expect(toolbar.find('input[aria-label="物料搜索"]').exists()).toBe(true)
    expect(toolbar.find('input[aria-label="扫描转料批次号"]').exists()).toBe(false)
    expect(wrapper.find('.incoming-scan input[aria-label="扫描转料批次号"]').exists()).toBe(true)
    expect(toolbar.find('.workspace-actions').exists()).toBe(false)
    expect(toolbar.findAll('button').filter((button) => button.text() === '查询')).toHaveLength(1)
    expect(toolbar.find('.record-date-trigger').exists()).toBe(false)
    const filters = wrapper.getComponent(FilterDialog)
    filters.vm.$emit('open')
    filters.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(
      wrapper.findAllComponents(ElCheckbox).some((item) => item.text().includes('仅看加急')),
    ).toBe(true)
    filters.vm.$emit('cancel')
    filters.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.find('.scanner-bar').exists()).toBe(false)
    expect(wrapper.find('.scanner-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('扫码后核对整批明细')
    await toolbar.get('input[aria-label="物料搜索"]').setValue('去毛刺')
    await toolbar.get('input[aria-label="物料搜索"]').trigger('keyup.enter')
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: '去毛刺', status: 'pending' }),
    )
  })
  it('removes one applied record filter while retaining search, dates and the other filters', async () => {
    const router = await render(
      '/team-workspaces/914?tab=outgoing&query=YS-007&material_type=semi_finished&status=pending&date_from=2026-09-01&page=2',
    )
    const filters = wrapper.getComponent(FilterDialog)
    filters.vm.$emit('open')
    filters.vm.$emit('update:modelValue', true)
    await flushPromises()
    const select = filters
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="物料类型筛选"]').exists())!
    select.vm.$emit('update:modelValue', '')
    filters.vm.$emit('apply')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      tab: 'outgoing',
      query: 'YS-007',
      status: 'pending',
      date_from: '2026-09-01',
    })
    expect(router.currentRoute.value.query.material_type).toBeUndefined()
    expect(router.currentRoute.value.query.page).toBeUndefined()
    expect(teamMaterialApi.dispatches).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({
        query: 'YS-007',
        status: 'pending',
        material_type: undefined,
        page: 1,
      }),
    )
  })
  it('resets record filters without leaving the current team or section', async () => {
    const router = await render(
      '/team-workspaces/914?tab=outgoing&query=YS-007&material_type=semi_finished&status=pending&urgent_only=true&date_from=2026-09-01&page=2',
    )
    wrapper.getComponent(FilterDialog).vm.$emit('reset')
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/914?tab=outgoing')
    expect(wrapper.find('.list-active-filters').exists()).toBe(false)
    expect((wrapper.get('input[aria-label="物料搜索"]').element as HTMLInputElement).value).toBe('')
    expect(teamMaterialApi.dispatches).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({
        query: undefined,
        material_type: undefined,
        status: undefined,
        urgent_only: undefined,
        date_from: undefined,
        page: 1,
      }),
    )
  })
  it('scopes pending incoming records and rejects a scanned transfer addressed to another team', async () => {
    await render('/team-workspaces/914?tab=pending')
    expect(materialTransferApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ team_id: 914, direction: 'incoming', status: 'pending' }),
    )
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(
      normalizeMaterialTransfer({ ...source().transfer, next_team: { id: 900, name: '检验' } }),
    )
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', receivingPerson)
    await flushPromises()
    await wrapper.get('input[aria-label="扫描转料批次号"]').setValue('TL10')
    await wrapper.get('input[aria-label="扫描转料批次号"]').trigger('keyup.enter')
    await flushPromises()
    expect(wrapper.text()).toContain('接收班组与当前工作台不符')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
  })
  it('accepts batch actions from serial detail and preserves the dialog on an unchanged focus refresh', async () => {
    await render(
      '/team-workspaces/914?tab=stock&query=AL&material_type=sludge&availability=all&page=2',
    )
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledWith(
      914,
      expect.objectContaining({
        query: 'AL',
        material_type: 'sludge',
        availability: 'all',
        page: 2,
        page_size: 10,
      }),
    )
    expect(wrapper.getComponent(TeamInventory).props('canWrite')).toBe(true)
    wrapper.getComponent(TeamInventory).vm.$emit('action', 'dispatch', [source(), source(11)])
    await flushPromises()
    expect(
      wrapper
        .getComponent(MaterialStockActionDialog)
        .props('sources')
        .map((item: StockBatch) => item.transfer.id),
    ).toEqual([10, 11])
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
    state.directory.loading = true
    await flushPromises()
    state.directory.items = [...state.directory.items]
    state.directory.loading = false
    await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
    state.auth.currentUser.team_id = 900
    await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
    expect(wrapper.text()).not.toContain('批量出库')
  })
  it('discards stale balances and stock when the route changes to another team', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof teamMaterialApi.teamInventory>>) => void
    vi.mocked(teamMaterialApi.teamInventory).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    const router = await render('/team-workspaces/914?tab=stock')
    await router.push('/team-workspaces/900?tab=stock')
    await flushPromises()
    resolveOld({
      items: [warehouseFixture({ serial_no: 'SERIAL-STALE' })],
      total: 900,
      page: 1,
      page_size: 10,
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('SERIAL-STALE')
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.get('.team-workspace').attributes('aria-label')).toBe('检验工作台')
    expect(wrapper.find('.team-table input[type=checkbox]').exists()).toBe(false)
  })
  it('opens a combined print after creation but requires each batch barcode for direct receiving', async () => {
    await render('/team-workspaces/914?tab=stock')
    wrapper.getComponent(MaterialStockActionDialog).vm.$emit('saved', dispatchFixture())
    await flushPromises()
    expect(wrapper.getComponent(MaterialBatchPrintDialog).props()).toMatchObject({
      modelValue: true,
      items: dispatchFixture().items,
    })
    wrapper.unmount()
    await render('/team-workspaces/914?tab=pending')
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', receivingPerson)
    await flushPromises()
    await wrapper.get('input[aria-label="扫描转料批次号"]').setValue('CK-GROUP')
    await wrapper.get('input[aria-label="扫描转料批次号"]').trigger('keyup.enter')
    await flushPromises()
    expect(wrapper.text()).toContain('请扫描每批物料的独立条码')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
  })
  it.each([
    ['/team-workspaces/914?tab=history', 914],
    ['/team-workspaces/901?tab=warehouse', 901],
    ['/team-workspaces/914', 914],
    ['/team-workspaces/914?tab=stock&query=OLD&material_type=sludge&page=2', 914],
  ])(
    'returns to refreshed inventory without printing after own-stock entry from %s',
    async (path, id) => {
      state.auth.currentUser.team_id = Number(id)
      vi.spyOn(teamMaterialApi, 'openingState').mockResolvedValue({
        enabled: true,
        completed: false,
        has_stock_history: false,
        can_submit: true,
        items: [],
      })
      const router = await render(String(path))
      await router.push(`/team-workspaces/${id}?tab=settings`)
      await flushPromises()
      const inventoryCalls = vi.mocked(teamMaterialApi.teamInventory).mock.calls.length
      vi.mocked(teamMaterialApi.teamInventory).mockResolvedValue({
        items: [warehouseFixture({ serial_no: 'OPENING-001' })],
        total: 1,
        page: 1,
        page_size: 10,
      })
      wrapper.getComponent(TeamBusinessDialog).vm.$emit('stocked', [source().transfer])
      await flushPromises()
      expect(router.currentRoute.value.fullPath).toBe(`/team-workspaces/${id}`)
      expect(wrapper.findComponent(TeamBusinessDialog).exists()).toBe(false)
      expect(wrapper.getComponent(MaterialBatchPrintDialog).props('modelValue')).toBe(false)
      expect(vi.mocked(teamMaterialApi.teamInventory).mock.calls.length).toBeGreaterThan(
        inventoryCalls,
      )
      expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(Number(id), {
        availability: 'current',
        page: 1,
        page_size: 10,
      })
      expect(wrapper.text()).toContain('OPENING-001')
    },
  )
  it('shares the page receiver with receipt review and blocks the row action until selected', async () => {
    const router = await render('/team-workspaces/914?tab=pending')
    const review = () => wrapper.findAll('button').find((button) => button.text() === '核对接收')!
    expect(review().attributes('disabled')).toBeDefined()
    await review().trigger('click')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
    await wrapper.get('.team-table .batch-link').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props('receiptReceiver')).toBeNull()
    wrapper.getComponent(MaterialTransferDrawer).vm.$emit('update:modelValue', false)
    await flushPromises()
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', receivingPerson)
    await flushPromises()
    expect(review().attributes('disabled')).toBeUndefined()
    await review().trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      receiptReceiver: receivingPerson,
    })
    await router.push('/team-workspaces/914?tab=pending&query=YS')
    await flushPromises()
    expect(wrapper.getComponent(MaterialReceiptScanner).props('receiver')).toEqual(receivingPerson)
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', null)
    await flushPromises()
    expect(review().attributes('disabled')).toBeDefined()
  })

  it.each(['account', 'team', 'permission'])(
    'clears the shared receiver on %s changes even when the scanner is unmounted',
    async (change) => {
      const router = await render('/team-workspaces/914?tab=pending')
      wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', receivingPerson)
      await flushPromises()
      await router.push('/team-workspaces/914?tab=outgoing')
      await flushPromises()
      if (change === 'account') state.auth.currentUser.id = 42
      if (change === 'team') await router.push('/team-workspaces/900?tab=outgoing')
      if (change === 'permission') state.auth.currentUserError = '权限失效'
      await flushPromises()
      state.auth.currentUserError = ''
      await router.push('/team-workspaces/914?tab=pending')
      await flushPromises()
      expect(wrapper.getComponent(MaterialReceiptScanner).props('receiver')).toBeNull()
      expect(
        wrapper
          .findAll('button')
          .find((button) => button.text() === '核对接收')!
          .attributes('disabled'),
      ).toBeDefined()
    },
  )

  it('opens each pending batch independently even when historically printed together', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      items: [{ ...source().transfer, status: 'pending', dispatch_no: 'CK-PENDING' }],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render('/team-workspaces/914?tab=pending')
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', receivingPerson)
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '核对接收')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      batchNo: source().transfer.batch_no,
      allowPrint: false,
      receiptOnly: true,
    })
  })
  it('scans directly into stock and refreshes the pending list without opening details', async () => {
    const transfer = normalizeMaterialTransfer({
      ...source().transfer,
      source_team: { id: 900, name: '检验' },
      status: 'pending',
      locked: false,
      version: 1,
      allowed_actions: ['confirm'],
    })
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(transfer)
    vi.spyOn(materialTransferApi, 'confirm').mockResolvedValue({
      ...transfer,
      status: 'received',
      locked: true,
    })
    vi.mocked(teamMaterialApi.dispatches).mockResolvedValue({
      items: [transfer],
      total: 1,
      page: 1,
      page_size: 10,
    })
    const router = await render('/team-workspaces/914?tab=pending')
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', receivingPerson)
    await flushPromises()
    await wrapper.get('input[aria-label="扫描转料批次号"]').setValue(transfer.batch_no)
    await wrapper.get('input[aria-label="扫描转料批次号"]').trigger('keyup.enter')
    await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
    expect(materialTransferApi.confirm).toHaveBeenCalledWith(transfer.batch_no, {
      received_employee_id: receivingPerson.id,
      expected_version: 1,
      idempotency_key: expect.any(String),
    })
    expect(wrapper.text()).toContain('已入库')
    expect(materialTransferApi.list).toHaveBeenCalledTimes(2)
    state.auth.currentUser.team_id = 900
    await router.push('/team-workspaces/900?tab=outgoing')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看详情')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      batchNo: transfer.batch_no,
      allowPrint: true,
      receiptOnly: false,
    })
  })
  it('opens the receiving scanner from stock and restricts it to the current team account', async () => {
    await render('/team-workspaces/914?tab=stock')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '扫码入库')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(MaterialReceiptScanner).props('teamId')).toBe(914)
    state.auth.isTeamAccount = false
    state.auth.isAdmin = true
    await flushPromises()
    expect(wrapper.findComponent(MaterialReceiptScanner).exists()).toBe(false)
  })
  it('does not issue global requests for invalid or absent team ids', async () => {
    await render('/team-workspaces/nope?tab=pending')
    expect(materialTransferApi.list).not.toHaveBeenCalled()
    expect(teamMaterialApi.overview).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('无效的班组编号')
  })
})

describe('warehouse intake workspace', () => {
  it('revalidates selected warehouse batches in one exact query before opening bulk dispatch', async () => {
    state.auth.currentUser.team_id = 901
    await render('/team-workspaces/901?tab=warehouse')
    wrapper.getComponent(WarehouseManagement).vm.$emit('batchDispatch', [11, 10, 11])
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(901, {
      source_ids: '11,10',
      availability: 'dispatchable',
      page_size: 100,
    })
    expect(
      wrapper
        .getComponent(MaterialStockActionDialog)
        .props('sources')
        .map((item: StockBatch) => item.transfer.id),
    ).toEqual([11, 10])
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
  })
  it('does not silently omit an exhausted warehouse batch from bulk dispatch', async () => {
    state.auth.currentUser.team_id = 901
    vi.mocked(teamMaterialApi.stock).mockResolvedValueOnce({
      items: [source(10)],
      total: 1,
      page: 1,
      page_size: 100,
    })
    await render('/team-workspaces/901?tab=warehouse')
    wrapper.getComponent(WarehouseManagement).vm.$emit('batchDispatch', [10, 11])
    await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
  })
  it.each(['warehouse', 'administrator'])(
    'places warehouse management in the warehouse workspace for %s',
    async (kind) => {
      state.auth.currentUser.team_id = kind === 'warehouse' ? 901 : 914
      state.auth.isAdmin = kind === 'administrator'
      state.auth.isTeamAccount = kind === 'warehouse'
      const router = await render('/team-workspaces/901')
      await router.push('/team-workspaces/901?tab=warehouse')
      await flushPromises()
      expect(router.currentRoute.value.query.tab).toBe('warehouse')
      expect(wrapper.getComponent(WarehouseManagement).props('canManage')).toBe(true)
      await router.push('/team-workspaces/914?tab=warehouse')
      await flushPromises()
      expect(wrapper.findComponent(WarehouseManagement).exists()).toBe(false)
      expect(wrapper.get('nav[aria-label$="视图"]').text()).not.toContain('仓库管理')
    },
  )
  it('does not expose warehouse management to another team even through a direct tab URL', async () => {
    await render('/team-workspaces/901?tab=warehouse')
    expect(wrapper.findComponent(WarehouseManagement).exists()).toBe(false)
    expect(wrapper.get('nav[aria-label$="视图"]').text()).not.toContain('仓库管理')
    expect(wrapper.findComponent(TeamInventory).exists()).toBe(true)
  })
  it('filters external batches and opens only the selected batch', async () => {
    state.auth.currentUser.team_id = 901
    const line = normalizeMaterialTransfer({
      id: 77,
      batch_no: 'TL-EXTERNAL',
      entry_kind: 'warehouse_outbound',
      external_destination: '外部客户',
      source_team: { id: 901, name: '库房' },
      next_team: null,
      status: 'pending',
      allowed_actions: ['confirm_outbound'],
    })
    vi.mocked(teamMaterialApi.dispatches).mockResolvedValue({
      items: [line],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render(
      '/team-workspaces/901?tab=outgoing&entry_kind=warehouse_outbound&status=pending&query=客户&next_team_id=900&material_type=scrap_chips',
    )
    expect(teamMaterialApi.dispatches).toHaveBeenCalledWith(
      901,
      expect.objectContaining({
        entry_kind: 'warehouse_outbound',
        status: 'pending',
        query: '客户',
        material_type: 'scrap_chips',
        next_team_id: undefined,
      }),
    )
    expect(wrapper.text()).toContain('待出库')
    expect(wrapper.text()).toContain('外部客户')
    expect(wrapper.findAll('button').filter((button) => button.text() === '核对出库')).toHaveLength(
      0,
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看详情')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      batchNo: 'TL-EXTERNAL',
    })
    expect(wrapper.find('[aria-label="接收班组筛选"]').exists()).toBe(false)
  })
  it('provides an intake entry only on the official warehouse and refreshes overview, stock and receipts after saving', async () => {
    state.auth.currentUser.team_id = 901
    await render('/team-workspaces/901')
    expect(wrapper.findAll('[role=tab]')).toHaveLength(0)
    expect(wrapper.getComponent(TeamInventory).props('warehouse')).toBe(true)
    expect(wrapper.find('button[aria-label="库房统计"]').exists()).toBe(false)
    const button = wrapper.findAll('button').find((button) => button.text() === '新建入库')!
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(WarehouseReceiptDialog).props('modelValue')).toBe(true)
    vi.mocked(teamMaterialApi.overview).mockClear()
    vi.mocked(teamMaterialApi.teamInventory).mockClear()
    vi.mocked(teamMaterialApi.receipts).mockClear()
    wrapper.getComponent(WarehouseReceiptDialog).vm.$emit(
      'saved',
      normalizeMaterialTransfer({
        entry_kind: 'warehouse_receipt',
        batch_no: 'TL-NEW',
        next_team: { id: 901, name: '库房' },
      }),
    )
    await flushPromises()
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(901)
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledWith(901, expect.any(Object))
    expect(teamMaterialApi.receipts).toHaveBeenCalledWith(901, expect.any(Object))
  })
  it('keeps warehouse intake records searchable and read-only for other teams', async () => {
    vi.mocked(teamMaterialApi.receipts).mockResolvedValue({
      items: [
        normalizeMaterialTransfer({
          id: 51,
          batch_no: 'TL-ROOT',
          serial_no: 'QA-IN',
          material_name: '铜钼',
          notes: '到货',
          source_team: null,
          next_team: { id: 901, name: '库房', kind: 'warehouse' },
          entry_kind: 'warehouse_receipt',
          status: 'received',
        }),
      ],
      total: 1,
      page: 2,
      page_size: 10,
    })
    await render(
      '/team-workspaces/901?tab=receipts&query=QA&material_type=sludge&page=2&page_size=10',
    )
    expect(teamMaterialApi.receipts).toHaveBeenCalledWith(901, {
      query: 'QA',
      material_type: 'sludge',
      page: 2,
      page_size: 10,
    })
    expect(wrapper.text()).toContain('已入库')
    expect(wrapper.findAll('button').some((button) => button.text() === '手工入库')).toBe(false)
    expect(wrapper.find('.team-table input[type=checkbox]').exists()).toBe(false)
  })
  it.each(teamWorkspaceProfiles)(
    'shows received batches for $name without enabling workshop manual intake',
    async (profile) => {
      const previous = state.directory.items
      const warehouse = profile.code === 'FACTORY-WAREHOUSE'
      state.directory.items = [
        {
          id: 914,
          code: profile.code,
          name: profile.name,
          active: true,
          kind: warehouse ? 'warehouse' : 'production',
        },
      ]
      vi.mocked(teamMaterialApi.receipts).mockResolvedValue({
        items: [source().transfer],
        total: 1,
        page: 1,
        page_size: 10,
      })
      try {
        await render('/team-workspaces/914?tab=receipts')
        expect(teamMaterialApi.receipts).toHaveBeenCalledWith(
          914,
          expect.objectContaining({ page: 1, page_size: 10 }),
        )
        expect(wrapper.get('nav[aria-label$="视图"] [aria-current=page]').text()).toBe('入库记录')
        expect(wrapper.get('.team-table').text()).toContain('TL10')
        const headings = wrapper
          .get('.team-table')
          .findAll('thead th')
          .map((cell) => cell.text())
        expect(headings).toContain('入库时间')
        expect(headings.includes('仓位')).toBe(warehouse)
        expect(headings.includes('来源类别')).toBe(warehouse)
        expect(wrapper.findAll('button').some((button) => button.text() === '新建入库')).toBe(
          warehouse,
        )
      } finally {
        state.directory.items = previous
      }
    },
  )
  it('moves a confirmed incoming batch into receipts and refreshes new receipts without losing filters', async () => {
    vi.useFakeTimers()
    const router = await render('/team-workspaces/914?tab=pending')
    const received = normalizeMaterialTransfer({
      ...source().transfer,
      received_at: '2026-09-27T12:00:00Z',
      received_by: '签收人',
    })
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    vi.mocked(teamMaterialApi.overview).mockResolvedValue({
      ...summary,
      pending_incoming: { quantity: 0, weight: 0, count: 0 },
    })
    vi.mocked(teamMaterialApi.receipts).mockResolvedValue({
      items: [received],
      total: 1,
      page: 1,
      page_size: 10,
    })
    wrapper.getComponent(MaterialTransferDrawer).vm.$emit('changed')
    await flushPromises()
    expect(wrapper.text()).toContain('暂无来料待签收')
    expect(wrapper.find('.team-workspace__pending').exists()).toBe(false)
    await wrapper
      .get('nav[aria-label$="视图"]')
      .findAll('button')
      .find((button) => button.text() === '入库记录')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.get('.team-table').text()).toContain(received.batch_no)
    await router.replace('/team-workspaces/914?tab=receipts&query=SERIAL')
    await flushPromises()
    const newer = normalizeMaterialTransfer({
      ...received,
      id: 99,
      batch_no: 'TL-NEW',
      received_at: '2026-09-28T12:00:00Z',
    })
    vi.mocked(teamMaterialApi.receipts).mockResolvedValue({
      items: [newer, received],
      total: 2,
      page: 1,
      page_size: 10,
    })
    subscription.onData({ changed: true, team_ids: [914] })
    await vi.advanceTimersByTimeAsync(110)
    await flushPromises()
    expect(wrapper.findAll('.team-table .batch-link').map((button) => button.text())).toEqual([
      'TL-NEW',
      received.batch_no,
    ])
    expect(router.currentRoute.value.query).toEqual({ tab: 'receipts', query: 'SERIAL' })
    expect(teamMaterialApi.receipts).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ query: 'SERIAL' }),
    )
  })
  it('discards a late receipt list after switching from warehouse to another team', async () => {
    let finish!: (value: Awaited<ReturnType<typeof teamMaterialApi.receipts>>) => void
    vi.mocked(teamMaterialApi.receipts).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const router = await render('/team-workspaces/901?tab=receipts')
    await router.push('/team-workspaces/900')
    await flushPromises()
    finish({
      items: [normalizeMaterialTransfer({ batch_no: 'TL-STALE', entry_kind: 'warehouse_receipt' })],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('TL-STALE')
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.get('.team-workspace').attributes('aria-label')).toBe('检验工作台')
  })
})

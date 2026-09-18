// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeamWorkspacePage from './TeamWorkspacePage.vue'
import TeamSerialOverview from '@/components/TeamSerialOverview.vue'
import WarehouseInventory from '@/components/WarehouseInventory.vue'
import TeamMaterialAnalysis from '@/components/TeamMaterialAnalysis.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import MaterialBatchPrintDialog from '@/components/MaterialBatchPrintDialog.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import { ElPagination } from 'element-plus'
import { analyticsFixture, serialFixture } from '@/testFixtures/materialAnalytics'
import MaterialStockActionDialog from '@/components/MaterialStockActionDialog.vue'
import StockSourcePicker from '@/components/StockSourcePicker.vue'
import WarehouseReceiptDialog from '@/components/WarehouseReceiptDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import * as inventoryStream from '@/services/inventoryStream'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch, TeamMaterialOverview } from '@/types/teamMaterials'
const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, currentUser: { id: 41, team_id: 914, active: true }, currentUserError: '', refreshCurrentUser: vi.fn() }, directory: { items: [{ id: 914, code: 'FACTORY-ROLL', name: '扎板', active: true }, { id: 900, code: 'FACTORY-QC', name: '检验', active: true }, { id: 901, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true }], loaded: true, loading: false, error: '', refreshTeamDirectory: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => state.directory }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const source = (id = 10): StockBatch => ({ transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: `SERIAL${id}`, source_team: { id: 1, name: '库房' }, next_team: { id: 914, name: '轧制' }, status: 'received', locked: true }), available_quantity: 9, available_weight: 0.005, reserved_quantity: 1, reserved_weight: 0 } as StockBatch)
const summary: TeamMaterialOverview = { team_id: 914, totals: { available_quantity: 309, available_weight: 30.95, reserved_quantity: 10, reserved_weight: 1, in_transit_quantity: 10, in_transit_weight: 1, received_quantity: 330, received_weight: 33, dispatched_quantity: 10, dispatched_weight: 1, lost_quantity: 1, lost_weight: 0.05, on_hand_quantity: 309, on_hand_weight: 30.95 }, materials: [], pending_incoming: { quantity: 130, weight: 13, count: 1 }, legacy_received_count: 2 }
let wrapper: VueWrapper
let subscription: inventoryStream.InventorySubscription<{ changed: boolean }>, stopStream: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  stopStream = vi.fn()
  vi.spyOn(inventoryStream, 'subscribeInventoryChanges').mockImplementation(callbacks => { subscription = callbacks; return stopStream })
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 41, team_id: 914, active: true }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  state.directory = reactive({ ...state.directory, loaded: true, loading: false, error: '' })
  vi.spyOn(teamMaterialApi, 'overview').mockImplementation(async () => ({ ...summary }))
  vi.spyOn(teamMaterialApi, 'analytics').mockResolvedValue(analyticsFixture())
  vi.spyOn(teamMaterialApi, 'serials').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'warehouseInventory').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({ items: [source(), source(11)], total: 2, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'dispatches').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'receipts').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'losses').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  vi.spyOn(materialTransferApi, 'list').mockResolvedValue({ items: [normalizeMaterialTransfer({ ...source().transfer, status: 'pending', locked: false })], total: 1, page: 1, page_size: 10 })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render(path = '/team-workspaces/914') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/team-workspaces/:teamId', component: TeamWorkspacePage }, { path: '/transfer-batches', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(TeamWorkspacePage, { global: { plugins: [router], stubs: { StockSourcePicker: true, TeamAnalyticsCharts: true, SerialMaterialDrawer: true, LedgerChart: true, MaterialDispatchDrawer: true, BarcodeCard: true, MaterialTransferDrawer: true, MaterialStockActionDialog: true, WarehouseReceiptDialog: true } } })
  await flushPromises()
  return router
}
describe('team workspace material ledger', () => {
  it('redirects the old serial tab while retaining filters and provides only one inventory tab', async () => {
    const router = await render('/team-workspaces/914?tab=serials&query=AL&date_from=2026-09-12&urgent_only=true&page=2&page_size=20#detail')
    expect(router.currentRoute.value.query).toEqual({ tab: 'stock', query: 'AL', date_from: '2026-09-12', urgent_only: 'true', page: '2', page_size: '20' })
    expect(router.currentRoute.value.hash).toBe('#detail')
    expect(wrapper.findAll('[role=tab]').filter(item => item.text() === '库存明细')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('流水号台账')
    expect(teamMaterialApi.stock).not.toHaveBeenCalled()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ availability: 'available', query: 'AL', date_from: '2026-09-12', urgent_only: true, page: 2, page_size: 20 }))
  })
  it('coalesces pushed changes, preserves filters and drafts, and closes its stream', async () => {
    vi.useFakeTimers()
    const router = await render('/team-workspaces/914?tab=stock&query=AL&page=2&page_size=20')
    await wrapper.get('input[aria-label="库存明细搜索"]').setValue('还未查询')
    await wrapper.findAll('button').find(button => button.text() === '新建出库')!.trigger('click'); await flushPromises()
    const before = vi.mocked(teamMaterialApi.serials).mock.calls.length
    for (let index = 0; index < 12; index++) subscription.onData({ changed: true })
    await vi.advanceTimersByTimeAsync(110); await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenCalledTimes(before + 1)
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ query: 'AL', page: 2, page_size: 20 }))
    expect(router.currentRoute.value.query.page).toBe('2')
    expect((wrapper.get('input[aria-label="库存明细搜索"]').element as HTMLInputElement).value).toBe('还未查询')
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(true)
    subscription.onState('reconnecting'); await flushPromises()
    expect(wrapper.text()).toContain('实时连接中断')
    const count = vi.mocked(teamMaterialApi.serials).mock.calls.length
    wrapper.unmount(); subscription.onData({ changed: true }); await vi.advanceTimersByTimeAsync(1000)
    expect(stopStream).toHaveBeenCalledOnce()
    expect(teamMaterialApi.serials).toHaveBeenCalledTimes(count)
  })
  it('keeps the last table on a pushed read failure and reconnects after becoming visible', async () => {
    vi.useFakeTimers()
    await render('/team-workspaces/914?tab=stock')
    const table = wrapper.get('.el-table').element
    vi.mocked(teamMaterialApi.serials).mockRejectedValueOnce(new Error('offline'))
    subscription.onData({ changed: true }); await vi.advanceTimersByTimeAsync(110); await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.text()).toContain('保留上次结果')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'))
    expect(stopStream).toHaveBeenCalledOnce()
    const count = vi.mocked(teamMaterialApi.serials).mock.calls.length
    subscription.onData({ changed: true }); await vi.advanceTimersByTimeAsync(1000)
    expect(teamMaterialApi.serials).toHaveBeenCalledTimes(count)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'))
    expect(inventoryStream.subscribeInventoryChanges).toHaveBeenCalledTimes(2)
  })
  it('starts dispatch from the ledger without changing its route and shows the saved group', async () => {
    const router = await render('/team-workspaces/914?tab=stock&query=AL&page=2')
    const path = router.currentRoute.value.fullPath
    await wrapper.findAll('button').find(button => button.text() === '新建出库')!.trigger('click'); await flushPromises()
    expect(wrapper.getComponent(StockSourcePicker).props('teamId')).toBe(914)
    wrapper.getComponent(StockSourcePicker).vm.$emit('selected', [source(), source(11)]); await flushPromises()
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
    expect(wrapper.getComponent(MaterialStockActionDialog).props()).toMatchObject({ modelValue: true, teamId: 914, mode: 'dispatch', sources: [source(), source(11)] })
    expect(router.currentRoute.value.fullPath).toBe(path)
    wrapper.getComponent(MaterialStockActionDialog).vm.$emit('saved', dispatchFixture()); await flushPromises()
    expect(wrapper.getComponent(MaterialBatchPrintDialog).props()).toMatchObject({ modelValue: true, items: dispatchFixture().items })
  })
  it('closes the picker on navigation and ignores a late permission refresh after cancellation', async () => {
    const router = await render()
    await wrapper.findAll('button').find(button => button.text() === '新建出库')!.trigger('click'); await flushPromises()
    await router.push('/team-workspaces/914?tab=outgoing'); await flushPromises()
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '新建出库')!.trigger('click'); await flushPromises()
    let finish!: () => void
    state.auth.refreshCurrentUser.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    wrapper.getComponent(StockSourcePicker).vm.$emit('selected', [source()]); await flushPromises()
    wrapper.getComponent(StockSourcePicker).vm.$emit('close'); await flushPromises()
    finish(); await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
  })
  it('defaults to ten records and keeps selectable page sizes without a fixed table height', async () => {
    vi.mocked(teamMaterialApi.serials).mockResolvedValue({ items: Array.from({ length: 10 }, (_, index) => serialFixture(`SERIAL-${index}`)), total: 45, page: 1, page_size: 10 })
    await render('/team-workspaces/914?tab=stock')
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    const pagination = wrapper.getComponent(ElPagination)
    expect(pagination.props('pageSizes')).toEqual([10, 20, 50, 100])
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page_size: 10 }))
    pagination.vm.$emit('size-change', 20)
    await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page: 1, page_size: 20 }))
    expect(wrapper.vm.$route.query.page_size).toBe('20')
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
    await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page: 1, page_size: 10 }))
    expect(wrapper.vm.$route.query.page_size).toBe('10')
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 100)
    await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page: 1, page_size: 100 }))
  })
  it('provides separate analysis, serial and material pages with authoritative balances', async () => {
    await render()
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.findAll('[role=tab]')).toHaveLength(6)
    expect(wrapper.text()).toContain('材质归类')
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(914)
    expect(wrapper.find('.team-workspace__heading').exists()).toBe(false)
    expect(wrapper.find('.workspace-balance-strip').exists()).toBe(false)
    expect(wrapper.get('h1').classes()).toContain('sr-only')
    expect(wrapper.get('.team-workspace__navigation').text()).toContain('新建出库')
    expect(wrapper.get('.serial-toolbar').find('.workspace-actions').exists()).toBe(false)
    expect(wrapper.text()).toContain('2 张历史已接收单')
    expect(wrapper.find('a[href*="next_team_id=914"]').exists()).toBe(true)
    expect(materialTransferApi.list).not.toHaveBeenCalled()
    expect(wrapper.findComponent(TeamMaterialAnalysis).exists()).toBe(false)
    expect(wrapper.findComponent(TeamSerialOverview).exists()).toBe(true)
    await wrapper.get('#workspace-tab-overview').trigger('click'); await flushPromises()
    expect(wrapper.findComponent(TeamMaterialAnalysis).exists()).toBe(true)
    expect(wrapper.text()).toContain('309')
    expect(wrapper.text()).toContain('30.95')
    expect(wrapper.text()).toContain('内部在途')
    expect(wrapper.findComponent(TeamSerialOverview).exists()).toBe(false)
    await wrapper.get('#workspace-tab-stock').trigger('click'); await flushPromises()
    expect(wrapper.findComponent(TeamMaterialAnalysis).exists()).toBe(false)
    expect(wrapper.findComponent(TeamSerialOverview).exists()).toBe(true)
    vi.mocked(teamMaterialApi.overview).mockClear()
    wrapper.getComponent(TeamSerialOverview).vm.$emit('changed'); await flushPromises()
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(914)
  })
  it.each(['serials', 'stock', 'outgoing', 'pending', 'receipts', 'losses', 'materials', 'overview'])('keeps workspace actions beside navigation for %s without duplicating query controls', async tab => {
    state.auth.currentUser.team_id = 901
    await render(`/team-workspaces/901?tab=${tab}`)
    const actions = wrapper.get('.team-workspace__navigation .workspace-actions')
    expect(actions.text()).toContain('新建入库')
    expect(actions.text()).toContain('新建出库')
    if (tab === 'pending') {
      expect(actions.text()).not.toContain('扫码查询')
      expect(wrapper.get('.list-toolbar .scanner-inline').text()).toContain('查看来料')
    } else expect(actions.text()).not.toContain('扫码查询')
    expect(wrapper.findAll('.workspace-actions')).toHaveLength(1)
    expect(wrapper.find('.team-workspace__heading').exists()).toBe(false)
  })
  it.each(['administrator', 'other-team', 'inactive'])('does not expose creation for %s accounts', async kind => {
    if (kind === 'administrator') state.auth.isTeamAccount = false
    if (kind === 'other-team') state.auth.currentUser.team_id = 900
    if (kind === 'inactive') state.auth.currentUser.active = false
    await render()
    expect(wrapper.findAll('button').some(button => button.text() === '新建出库')).toBe(false)
    expect(wrapper.text()).toContain('仅查看')
    expect(wrapper.getComponent(TeamSerialOverview).props('canWrite')).toBe(false)
    wrapper.getComponent(TeamSerialOverview).vm.$emit('action', 'loss', [source()]); await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
  })
  it('places search and scanning in one toolbar without removing date or urgency filters', async () => {
    await render('/team-workspaces/914?tab=pending')
    const toolbar = wrapper.get('.list-toolbar--pending')
    expect(toolbar.find('input[aria-label="物料搜索"]').exists()).toBe(true)
    expect(toolbar.find('input[aria-label="扫描转料批次号"]').exists()).toBe(true)
    expect(toolbar.findAll('button').filter(button => button.text() === '查询')).toHaveLength(1)
    expect(toolbar.find('.record-date-trigger').exists()).toBe(true)
    expect(toolbar.text()).toContain('仅看加急')
    expect(wrapper.find('.scanner-bar').exists()).toBe(false)
    expect(wrapper.find('.scanner-error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('扫码后核对整批明细')
    await toolbar.get('input[aria-label="物料搜索"]').setValue('AL')
    await toolbar.get('input[aria-label="物料搜索"]').trigger('keyup.enter'); await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'AL', status: 'pending' }))
  })
  it('scopes pending incoming records and rejects a scanned transfer addressed to another team', async () => {
    await render('/team-workspaces/914?tab=pending')
    expect(materialTransferApi.list).toHaveBeenCalledWith(expect.objectContaining({ team_id: 914, direction: 'incoming', status: 'pending' }))
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(normalizeMaterialTransfer({ ...source().transfer, next_team: { id: 900, name: '检验' } }))
    await wrapper.get('input[aria-label="扫描转料批次号"]').setValue('TL10')
    await wrapper.get('input[aria-label="扫描转料批次号"]').trigger('keyup.enter'); await flushPromises()
    expect(wrapper.text()).toContain('接收班组与当前工作台不符')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
  })
  it('accepts batch actions from serial detail and preserves the dialog on an unchanged focus refresh', async () => {
    await render('/team-workspaces/914?tab=stock&query=AL&material_type=sludge&availability=all&page=2')
    expect(teamMaterialApi.serials).toHaveBeenCalledWith(914, expect.objectContaining({ query: 'AL', material_type: 'sludge', availability: 'all', page: 2, page_size: 10 }))
    expect(wrapper.getComponent(TeamSerialOverview).props('canWrite')).toBe(true)
    wrapper.getComponent(TeamSerialOverview).vm.$emit('action', 'dispatch', [source(), source(11)]); await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('sources').map((item: StockBatch) => item.transfer.id)).toEqual([10, 11])
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
    state.directory.loading = true; await flushPromises(); state.directory.items = [...state.directory.items]; state.directory.loading = false; await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(true)
    state.auth.currentUser.team_id = 900; await flushPromises()
    expect(wrapper.getComponent(MaterialStockActionDialog).props('modelValue')).toBe(false)
    expect(wrapper.text()).not.toContain('批量出库')
  })
  it('discards stale balances and stock when the route changes to another team', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof teamMaterialApi.serials>>) => void
    vi.mocked(teamMaterialApi.serials).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
    const router = await render('/team-workspaces/914?tab=stock')
    await router.push('/team-workspaces/900?tab=stock'); await flushPromises()
    resolveOld({ items: [serialFixture('SERIAL-STALE')], total: 900, page: 1, page_size: 10 }); await flushPromises()
    expect(wrapper.text()).not.toContain('SERIAL-STALE')
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.get('.team-workspace').attributes('aria-label')).toBe('检验工作台')
    expect(wrapper.find('.team-table input[type=checkbox]').exists()).toBe(false)
  })
  it('opens a combined print after creation and keeps historical CK lookup compatible', async () => {
    await render('/team-workspaces/914?tab=stock')
    wrapper.getComponent(MaterialStockActionDialog).vm.$emit('saved', dispatchFixture())
    await flushPromises()
    expect(wrapper.getComponent(MaterialBatchPrintDialog).props()).toMatchObject({ modelValue: true, items: dispatchFixture().items })
    wrapper.unmount()
    await render('/team-workspaces/914?tab=pending')
    vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture(25, 'transfer', { next_team: { id: 914, code: 'FACTORY-ROLL', name: '轧制' } }))
    await wrapper.get('input[aria-label="扫描转料批次号"]').setValue('CK-GROUP')
    await wrapper.get('input[aria-label="扫描转料批次号"]').trigger('keyup.enter'); await flushPromises()
    expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP')
    expect(wrapper.getComponent(MaterialDispatchDrawer).props('modelValue')).toBe(true)
  })
  it('opens each pending batch independently even when historically printed together', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({ items: [{ ...source().transfer, status: 'pending', dispatch_no: 'CK-PENDING' }], total: 1, page: 1, page_size: 10 })
    await render('/team-workspaces/914?tab=pending')
    await wrapper.findAll('button').find(button => button.text() === '核对接收')!.trigger('click'); await flushPromises()
    expect(wrapper.getComponent(MaterialDispatchDrawer).props('modelValue')).toBe(false)
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, batchNo: source().transfer.batch_no })
  })
  it('does not issue global requests for invalid or absent team ids', async () => {
    await render('/team-workspaces/nope?tab=pending')
    expect(materialTransferApi.list).not.toHaveBeenCalled()
    expect(teamMaterialApi.overview).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('无效的班组编号')
  })
})


describe('warehouse intake workspace', () => {
  it('filters external batches and opens only the selected batch', async () => {
    state.auth.currentUser.team_id = 901
    const line = normalizeMaterialTransfer({ id: 77, batch_no: 'TL-EXTERNAL', entry_kind: 'warehouse_outbound', external_destination: '外部客户', source_team: { id: 901, name: '库房' }, next_team: null, status: 'pending', allowed_actions: ['confirm_outbound'] })
    vi.mocked(teamMaterialApi.dispatches).mockResolvedValue({ items: [line], total: 1, page: 1, page_size: 10 })
    await render('/team-workspaces/901?tab=outgoing&entry_kind=warehouse_outbound&status=pending&query=客户&next_team_id=900&material_type=scrap_chips')
    expect(teamMaterialApi.dispatches).toHaveBeenCalledWith(901, expect.objectContaining({ entry_kind: 'warehouse_outbound', status: 'pending', query: '客户', material_type: 'scrap_chips', next_team_id: undefined }))
    expect(wrapper.text()).toContain('待出库确认'); expect(wrapper.text()).toContain('外部客户')
    expect(wrapper.findAll('button').filter(button => button.text() === '核对出库')).toHaveLength(0)
    await wrapper.findAll('button').find(button => button.text() === '查看详情')!.trigger('click'); await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, batchNo: 'TL-EXTERNAL' })
    expect(wrapper.find('[aria-label="接收班组筛选"]').exists()).toBe(false)
  })
  it('provides an intake entry only on the official warehouse and refreshes overview, stock and receipts after saving', async () => {
    state.auth.currentUser.team_id = 901
    await render('/team-workspaces/901')
    expect(wrapper.findAll('[role=tab]')).toHaveLength(5)
    expect(wrapper.findComponent(WarehouseInventory).exists()).toBe(true)
    expect(wrapper.findComponent(TeamSerialOverview).exists()).toBe(false)
    expect(wrapper.get('button[aria-label="库房统计"]').text()).toContain('统计')
    const button = wrapper.findAll('button').find(button => button.text() === '新建入库')!
    expect(button.exists()).toBe(true)
    await button.trigger('click'); await flushPromises()
    expect(wrapper.getComponent(WarehouseReceiptDialog).props('modelValue')).toBe(true)
    vi.mocked(teamMaterialApi.overview).mockClear(); vi.mocked(teamMaterialApi.warehouseInventory).mockClear(); vi.mocked(teamMaterialApi.receipts).mockClear()
    wrapper.getComponent(WarehouseReceiptDialog).vm.$emit('saved', normalizeMaterialTransfer({ entry_kind: 'warehouse_receipt', batch_no: 'TL-NEW', next_team: { id: 901, name: '库房' } }))
    await flushPromises()
    expect(teamMaterialApi.overview).toHaveBeenCalledWith(901)
    expect(teamMaterialApi.warehouseInventory).toHaveBeenCalledWith(901, expect.any(Object))
    expect(teamMaterialApi.receipts).toHaveBeenCalledWith(901, expect.any(Object))
  })
  it('keeps warehouse intake records searchable and read-only for other teams', async () => {
    vi.mocked(teamMaterialApi.receipts).mockResolvedValue({ items: [normalizeMaterialTransfer({ id: 51, batch_no: 'TL-ROOT', serial_no: 'QA-IN', material_name: '铜钼', notes: '到货', source_team: null, next_team: { id: 901, name: '库房', kind: 'warehouse' }, entry_kind: 'warehouse_receipt', status: 'received' })], total: 1, page: 2, page_size: 10 })
    await render('/team-workspaces/901?tab=receipts&query=QA&material_type=sludge&page=2&page_size=10')
    expect(teamMaterialApi.receipts).toHaveBeenCalledWith(901, { query: 'QA', material_type: 'sludge', page: 2, page_size: 10 })
    expect(wrapper.text()).toContain('已入库')
    expect(wrapper.findAll('button').some(button => button.text() === '手工入库')).toBe(false)
    expect(wrapper.find('.team-table input[type=checkbox]').exists()).toBe(false)
  })
  it('ignores warehouse-only tabs on the other seven workspaces', async () => {
    await render('/team-workspaces/914?tab=receipts')
    expect(wrapper.findAll('[role=tab]')).toHaveLength(6)
    expect(teamMaterialApi.receipts).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').some(button => button.text() === '手工入库')).toBe(false)
  })
  it('discards a late receipt list after switching from warehouse to another team', async () => {
    let finish!: (value: Awaited<ReturnType<typeof teamMaterialApi.receipts>>) => void
    vi.mocked(teamMaterialApi.receipts).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const router = await render('/team-workspaces/901?tab=receipts')
    await router.push('/team-workspaces/900'); await flushPromises()
    finish({ items: [normalizeMaterialTransfer({ batch_no: 'TL-STALE', entry_kind: 'warehouse_receipt' })], total: 1, page: 1, page_size: 10 }); await flushPromises()
    expect(wrapper.text()).not.toContain('TL-STALE')
    expect(wrapper.get('h1').text()).toBe('库存明细')
    expect(wrapper.get('.team-workspace').attributes('aria-label')).toBe('检验工作台')
  })
})

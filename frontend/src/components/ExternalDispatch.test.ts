// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber, ElMessageBox, ElRadioGroup } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialStockActionDialog from './MaterialStockActionDialog.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from './MaterialDispatchDrawer.vue'
import BarcodeCard from './BarcodeCard.vue'
import MaterialTransferFormDialog from './MaterialTransferFormDialog.vue'
import { MaterialTransferApiError, materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import { canConfirmMaterialTransfer, materialTransferStatusLabel, type ExternalEntryKind, type MaterialTransfer } from '@/types/materialTransfer'
import type { MaterialDispatch, StockBatch } from '@/types/teamMaterials'

const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, isAdmin: false, currentUser: { id: 41, team_id: 1, active: true }, currentUserError: '', refreshCurrentUser: vi.fn() }, directory: { items: [{ id: 1, name: '库房', code: 'FACTORY-WAREHOUSE', kind: 'warehouse', active: true }, { id: 8, name: '检验', code: 'FACTORY-QC', kind: 'production', active: true }, { id: 2, name: '轧制', code: 'FACTORY-ROLL', kind: 'production', active: true }], loaded: true, error: '', refreshTeamDirectory: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => state.directory }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const dialogStub = { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' }
const record = (kind: ExternalEntryKind = 'warehouse_outbound', extra: Record<string, unknown> = {}) => normalizeMaterialTransfer({ id: 20, batch_no: 'TL-EXTERNAL', serial_no: 'QA-EXTERNAL', material_name: '铜钼', material_type: 'semi_finished', source_team: { id: kind === 'warehouse_outbound' ? 1 : 8, name: kind === 'warehouse_outbound' ? '库房' : '检验' }, next_team: null, next_team_id: null, entry_kind: kind, external_destination: '外部收货单位', quantity: 10, weight: 1.005, status: 'pending', locked: false, version: 4, allowed_actions: ['edit', 'void', 'confirm_outbound'], source_transfer_id: 3, source_transfer_batch_no: 'TL-ROOT', dispatch_no: null, ...extra })
const source = (id = 3): StockBatch => ({ transfer: normalizeMaterialTransfer({ id, batch_no: `TL-ROOT-${id}`, serial_no: 'QA-EXTERNAL', material_name: '铜钼', material_type: 'semi_finished', source_team: null, next_team: { id: state.auth.currentUser.team_id, name: '本班组' }, quantity: 20, weight: 2, status: 'received', stock_tracked: true }), available_quantity: 20, available_weight: 2 } as StockBatch)
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({ isTeamAccount: true, isAdmin: false, currentUser: { id: 41, team_id: 1, active: true }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  state.directory = reactive({ ...state.directory, items: [{ id: 1, name: '库房', code: 'FACTORY-WAREHOUSE', kind: 'warehouse', active: true }, { id: 8, name: '检验', code: 'FACTORY-QC', kind: 'production', active: true }, { id: 2, name: '轧制', code: 'FACTORY-ROLL', kind: 'production', active: true }], error: '', refreshTeamDirectory: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(teamMaterialApi, 'createDispatch').mockResolvedValue({ dispatch_no: 'CK-EXTERNAL', entry_kind: 'warehouse_outbound', line_count: 2, items: [record()] } as MaterialDispatch)
  vi.spyOn(teamMaterialApi, 'refreshSource').mockImplementation(async (_id, row) => ({ ...row, available_quantity: 5, available_weight: 0.5 }))
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(record())
  vi.spyOn(materialTransferApi, 'confirmOutbound').mockResolvedValue(record('warehouse_outbound', { status: 'dispatched', locked: true, allowed_actions: [], dispatched_by: '库管', dispatched_at: '2026-09-07T01:00:00Z' }))
  vi.spyOn(materialTransferApi, 'confirm').mockResolvedValue(record())
  vi.spyOn(materialTransferApi, 'update').mockResolvedValue(record())
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function stockDialog() {
  wrapper = mount(MaterialStockActionDialog, { props: { modelValue: true, teamId: state.auth.currentUser.team_id, mode: 'dispatch', sources: [source(), source(4)] }, global: { stubs: { ElDialog: dialogStub } } }); await flushPromises()
}
async function mode(kind: ExternalEntryKind) { wrapper.getComponent(ElRadioGroup).vm.$emit('update:modelValue', kind); await flushPromises() }
async function submit() { await wrapper.get('form').trigger('submit'); await flushPromises() }
async function drawer(kind: ExternalEntryKind = 'warehouse_outbound', extra: Record<string, unknown> = {}) {
  vi.mocked(materialTransferApi.get).mockResolvedValue(record(kind, extra))
  wrapper = mount(MaterialTransferDrawer, { props: { modelValue: true, batchNo: 'TL-EXTERNAL' }, global: { stubs: { MaterialTransferDetailFrame: dialogStub, MaterialTransferFormDialog: true, MaterialDispatchDrawer: true, MaterialTransferPrintSheet: true, BarcodeCard: true, RouterLink: true } } }); await flushPromises()
}
async function confirm(label = '确认出库') { await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click'); await flushPromises() }

describe('external dispatch creation', () => {
  it.each([['warehouse_outbound', 1, '出库'], ['inspection_shipment', 8, '发货']] as const)('creates separate %s lines without a destination team', async (kind, teamId, verb) => {
    state.auth.currentUser.team_id = teamId
    await stockDialog(); await mode(kind); await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写外部去向')
    await wrapper.get(`input[aria-label="${verb}去向"]`).setValue('  客户收货仓  ')
    await submit()
    const [id, body] = vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]!
    expect(id).toBe(teamId); expect(body).toMatchObject({ entry_kind: kind, external_destination: '客户收货仓', lines: [{ source_transfer_id: 3 }, { source_transfer_id: 4 }] })
    expect(body).not.toHaveProperty('next_team_id')
    expect(wrapper.text()).toContain(`创建后需本班组确认${verb}`)
    expect(wrapper.find('[aria-label="出库接收班组"]').exists()).toBe(false)
  })
  it('keeps ordinary production teams on internal transfers', async () => {
    state.auth.currentUser.team_id = 2; await stockDialog()
    expect(wrapper.findComponent(ElRadioGroup).exists()).toBe(false)
    expect(wrapper.find('[aria-label="出库接收班组"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="出库去向"]').exists()).toBe(false)
  })
  it('preserves the external destination and draft on 409 and checks refreshed availability before another write', async () => {
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValueOnce(new TeamMaterialApiError('余额不足', 409))
    await stockDialog(); await mode('warehouse_outbound'); await wrapper.get('input[aria-label="出库去向"]').setValue('外部仓库'); await submit()
    expect(teamMaterialApi.refreshSource).toHaveBeenCalledTimes(2)
    expect((wrapper.get('input[aria-label="出库去向"]').element as HTMLInputElement).value).toBe('外部仓库')
    expect(wrapper.getComponent(ElRadioGroup).props('modelValue')).toBe('warehouse_outbound')
    await submit(); expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(1)
    wrapper.findAllComponents(ElInputNumber).forEach(input => input.vm.$emit('update:modelValue', 0))
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 1); wrapper.findAllComponents(ElInputNumber)[2]!.vm.$emit('update:modelValue', 1)
    await submit(); expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(2)
  })
  it('reuses an uncertain create request and makes no write after account rebinding', async () => {
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValue(new TeamMaterialApiError('网络错误'))
    await stockDialog(); await mode('warehouse_outbound'); await wrapper.get('input[aria-label="出库去向"]').setValue('外部仓库'); await submit(); await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].idempotency_key).toBe(vi.mocked(teamMaterialApi.createDispatch).mock.calls[1]![1].idempotency_key)
    state.auth.refreshCurrentUser.mockImplementation(async () => { state.auth.currentUser.team_id = 2 })
    await submit(); expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(2)
  })
})

describe('external document confirmation', () => {
  it('routes a linked historical TL to its CK for barcode, confirmation and printing', async () => {
    await drawer('warehouse_outbound', { dispatch_no: 'CK-EXTERNAL' })
    expect(wrapper.getComponent(BarcodeCard).props('value')).toBe('CK-EXTERNAL')
    expect(wrapper.findAll('button').some(button => button.text() === '确认出库')).toBe(false)
    await confirm('核对 / 打印整批')
    expect(wrapper.getComponent(MaterialDispatchDrawer).props()).toMatchObject({ modelValue: true, dispatchNo: 'CK-EXTERNAL' })
    expect(materialTransferApi.confirmOutbound).not.toHaveBeenCalled()
  })
  it.each([['warehouse_outbound', 1, '出库'], ['inspection_shipment', 8, '发货']] as const)('reviews and confirms %s through the dedicated endpoint', async (kind, teamId, verb) => {
    state.auth.currentUser.team_id = teamId
    vi.mocked(materialTransferApi.confirmOutbound).mockResolvedValue(record(kind, { status: 'dispatched', locked: true, allowed_actions: [], dispatched_by: '本班组确认人', dispatched_at: '2026-09-07T01:00:00Z' }))
    await drawer(kind)
    expect(wrapper.text()).toContain(`待${verb}确认`)
    expect(wrapper.findAll('button').some(button => button.text() === '确认接收')).toBe(false)
    await confirm(`确认${verb}`)
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('外部收货单位'), `确认${verb}`, expect.any(Object))
    expect(materialTransferApi.confirmOutbound).toHaveBeenCalledWith('TL-EXTERNAL', { expected_version: 4, idempotency_key: expect.any(String) })
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain(`已${verb}`); expect(wrapper.text()).toContain('本班组确认人')
    expect(wrapper.findAll('button').some(button => ['编辑', '作废', `确认${verb}`].includes(button.text()))).toBe(false)
  })
  it('requires a fresh review after conflict and sends the newly reviewed version', async () => {
    await drawer()
    vi.mocked(materialTransferApi.confirmOutbound).mockRejectedValueOnce(new MaterialTransferApiError('单据更新', 409))
    vi.mocked(materialTransferApi.get).mockResolvedValue(record('warehouse_outbound', { version: 5, quantity: 12 }))
    await confirm()
    expect(wrapper.text()).toContain('请重新核对最新内容后确认出库')
    expect(materialTransferApi.confirmOutbound).toHaveBeenCalledTimes(1)
    await confirm()
    expect(vi.mocked(materialTransferApi.confirmOutbound).mock.calls[1]![1].expected_version).toBe(5)
  })
  it('keeps the confirmation key after an uncertain response and a same-version refresh', async () => {
    await drawer(); vi.mocked(materialTransferApi.confirmOutbound).mockRejectedValueOnce(new MaterialTransferApiError('网络失败'))
    await confirm(); await confirm()
    const calls = vi.mocked(materialTransferApi.confirmOutbound).mock.calls
    expect(calls[0]![1].idempotency_key).toBe(calls[1]![1].idempotency_key)
  })
  it('ignores a late confirmation when a different account takes over the same team', async () => {
    let finish!: (value: MaterialTransfer) => void
    await drawer(); vi.mocked(materialTransferApi.confirmOutbound).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await confirm(); state.auth.currentUser.id = 99; await flushPromises()
    finish(record('warehouse_outbound', { status: 'dispatched' })); await flushPromises()
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
  it('does not offer confirmation to admins or a different source team', async () => {
    state.auth.isTeamAccount = false; state.auth.isAdmin = true
    await drawer()
    expect(wrapper.findAll('button').some(button => button.text() === '确认出库')).toBe(false)
    state.auth.isTeamAccount = true; state.auth.isAdmin = false; state.auth.currentUser.team_id = 2; await flushPromises()
    expect(wrapper.findAll('button').some(button => button.text() === '确认出库')).toBe(false)
    expect(canConfirmMaterialTransfer(record('warehouse_outbound', { allowed_actions: ['confirm'] }))).toBe(false)
  })
  it('edits only quantity, weight and notes while keeping external destination and source identity fixed', async () => {
    wrapper = mount(MaterialTransferFormDialog, { props: { modelValue: true, transfer: record() }, global: { stubs: { ElDialog: dialogStub } } }); await flushPromises()
    expect(wrapper.text()).toContain('外部收货单位')
    expect(wrapper.find('[aria-label="接收班组"]').exists()).toBe(false)
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[aria-label="出库说明"]').setValue('核对后说明')
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 3)
    await submit()
    expect(materialTransferApi.update).toHaveBeenCalledWith('TL-EXTERNAL', { quantity: 3, weight: 1.005, notes: '核对后说明', expected_version: 4 })
  })
  it('keeps terminal shipment status distinct from receipt', () => {
    const shipment = record('inspection_shipment', { status: 'dispatched', stock_tracked: false, dispatched_by: '检验员' })
    expect(shipment.next_team.id).toBe(''); expect(shipment.next_team.name).toBe('外部收货单位')
    expect(materialTransferStatusLabel(shipment.status, shipment.entry_kind)).toBe('已发货')
    expect(shipment.stock_tracked).toBe(false)
  })
})

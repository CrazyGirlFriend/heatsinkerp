// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseReceiptDialog from './WarehouseReceiptDialog.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
const state = vi.hoisted(() => ({
  auth: { isTeamAccount: true, currentUser: { id: 41, team_id: 901, active: true }, currentUserError: '', refreshCurrentUser: vi.fn() },
  directory: { items: [{ id: 901, code: 'FACTORY-WAREHOUSE', kind: 'warehouse', name: '库房', active: true }], loaded: true, error: '', refreshTeamDirectory: vi.fn() },
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => state.directory }))
const receipt = () => normalizeMaterialTransfer({ id: 51, batch_no: 'TL-RECEIPT', serial_no: 'QA-IN', entry_kind: 'warehouse_receipt', source_team: null, next_team: { id: 901, name: '库房', kind: 'warehouse' }, status: 'received', locked: true, stock_tracked: true })
let wrapper: VueWrapper
beforeEach(() => {
  sessionStorage.clear()
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 41, team_id: 901, active: true }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  state.directory = reactive({ items: [{ id: 901, code: 'FACTORY-WAREHOUSE', kind: 'warehouse', name: '库房', active: true }], loaded: true, error: '', refreshTeamDirectory: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(teamMaterialApi, 'createReceipt').mockResolvedValue(receipt())
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); sessionStorage.clear() })
async function render() {
  wrapper = mount(WarehouseReceiptDialog, { props: { modelValue: true, teamId: 901 }, global: { stubs: { ElDialog: { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function amount(label: string, value: number) {
  wrapper.findAllComponents(ElInputNumber).find(item => item.find(`input[aria-label="${label}"]`).exists())!.vm.$emit('update:modelValue', value)
  await flushPromises()
}
async function fill() {
  await wrapper.get('input[aria-label="流水号"]').setValue('  QA-IN  ')
  await wrapper.get('input[aria-label="材质"]').setValue('  铜钼  ')
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'semi_finished')
  await amount('入库件数', 0); await amount('入库重量', 0.005)
  await wrapper.get('textarea[aria-label="入库说明"]').setValue('  实物到货登记  ')
}
async function submit() { await wrapper.get('form').trigger('submit'); await flushPromises() }

describe('warehouse manual receipt', () => {
  it('creates a root receipt for the bound warehouse with no transfer destination or status fields', async () => {
    await render(); await fill()
    expect(wrapper.findAllComponents(ElSelect)).toHaveLength(1)
    expect(wrapper.text()).not.toContain('接收班组')
    await wrapper.get('input[aria-label="原单批号"]').setValue('RAW-91')
    await submit()
    const [id, body] = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]!
    expect(id).toBe(901)
    expect(body).toMatchObject({ serial_no: 'QA-IN', material_name: '铜钼', material_type: 'semi_finished', quantity: 0, weight: 0.005, notes: '实物到货登记', source_batch_no: 'RAW-91', idempotency_key: expect.any(String) })
    expect(body).not.toHaveProperty('next_team_id'); expect(body).not.toHaveProperty('source_team_id'); expect(body).not.toHaveProperty('status')
    expect(state.auth.refreshCurrentUser).toHaveBeenCalledOnce(); expect(state.directory.refreshTeamDirectory).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')).toEqual([[receipt()]])
    expect(sessionStorage.length).toBe(0)
  })
  it('requires material, explanation, and a positive amount and rejects excessive decimal precision', async () => {
    await render(); await fill()
    await wrapper.get('input[aria-label="材质"]').setValue(' '); await submit(); expect(wrapper.text()).toContain('请输入材质')
    await wrapper.get('input[aria-label="材质"]').setValue('铜钼')
    await wrapper.get('textarea[aria-label="入库说明"]').setValue(' '); await submit(); expect(wrapper.text()).toContain('请填写入库说明')
    await wrapper.get('textarea[aria-label="入库说明"]').setValue('到货')
    await amount('入库重量', 0); await submit(); expect(wrapper.text()).toContain('至少一项大于 0')
    await amount('入库重量', 0.0005); await submit(); expect(wrapper.text()).toContain('最多保留 3 位小数')
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
  })
  it.each(['admin', 'other-team', 'inactive', 'wrong-code', 'wrong-kind'])('blocks %s from creating a warehouse receipt', async kind => {
    if (kind === 'admin') state.auth.isTeamAccount = false
    if (kind === 'other-team') state.auth.currentUser.team_id = 2
    if (kind === 'inactive') state.directory.items[0]!.active = false
    if (kind === 'wrong-code') state.directory.items[0]!.code = 'OLD-WAREHOUSE'
    if (kind === 'wrong-kind') state.directory.items[0]!.kind = 'production'
    await render(); await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').find(button => button.text() === '确认入库')!.attributes('disabled')).toBeDefined()
  })
  it('reuses an uncertain request after reopening, freezes its content and suppresses double submission', async () => {
    let fail!: (failure: Error) => void
    vi.mocked(teamMaterialApi.createReceipt).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
    await render(); await fill(); await submit(); await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledTimes(1)
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    fail(new TeamMaterialApiError('网络中断')); await flushPromises()
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
    wrapper.unmount(); await render()
    expect(wrapper.text()).toContain('上次提交结果待确认')
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
    expect(sessionStorage.length).toBe(0)
  })
  it('permits correction after a definitive validation failure', async () => {
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(new TeamMaterialApiError('说明不完整', 422))
    await render(); await fill(); await submit()
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeUndefined()
    expect(sessionStorage.length).toBe(0)
    await wrapper.get('textarea[aria-label="入库说明"]').setValue('补充完整到货说明'); await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1].notes).toBe('补充完整到货说明')
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('does not replace an unreadable pending entry with a new posting', async () => {
    sessionStorage.setItem('heatsink-flow.pending-warehouse-receipt.v1:41:901', '{broken')
    await render(); await submit()
    expect(wrapper.text()).toContain('上次入库草稿读取失败')
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('heatsink-flow.pending-warehouse-receipt.v1:41:901')).toBe('{broken')
  })
  it('makes no write when account binding changes during server verification', async () => {
    await render(); await fill()
    state.auth.refreshCurrentUser.mockImplementation(async () => { state.auth.currentUser.team_id = 2 })
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前不能入库')
  })
  it('does not apply a late receipt to another workspace and clears the confirmed retry only for its original identity', async () => {
    let finish!: (value: ReturnType<typeof receipt>) => void
    vi.mocked(teamMaterialApi.createReceipt).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await render(); await fill(); await submit()
    await wrapper.setProps({ teamId: 2, modelValue: false })
    finish(receipt()); await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(sessionStorage.length).toBe(0)
  })
})

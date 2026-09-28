// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialReceiptScanner from './MaterialReceiptScanner.vue'
import { materialTransferApi, normalizeMaterialTransfer, MaterialTransferApiError } from '@/services/materialTransferApi'
import { showToast } from '@/stores/toast'
import type { MaterialTransfer } from '@/types/materialTransfer'

const state = vi.hoisted(() => ({ auth: {} as Record<string, any> }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const pending = (batchNo = 'TL000001', extra = {}): MaterialTransfer => normalizeMaterialTransfer({
  batch_no: batchNo, entry_kind: 'transfer', source_team: { id: 1, name: '库房' }, next_team: { id: 2, name: '轧制' },
  status: 'pending', locked: false, version: 3, allowed_actions: ['confirm'], quantity: 100, weight: 12.5, ...extra,
})
const received = (batchNo = 'TL000001') => ({ ...pending(batchNo), status: 'received' as const, locked: true, version: 4, received_at: '2026-09-28T10:00:00Z' })
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 10, team_id: 2, active: true }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(materialTransferApi, 'get').mockImplementation(async code => pending(code))
  vi.spyOn(materialTransferApi, 'confirm').mockImplementation(async code => received(code))
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.clearAllMocks() })
function render() { wrapper = mount(MaterialReceiptScanner, { props: { teamId: 2 }, attachTo: document.body }); return wrapper }
async function scan(code = 'TL000001') {
  await wrapper.get('input').setValue(code)
  await wrapper.get('input').trigger('keyup.enter')
  await flushPromises()
}
function hid(code: string, target: EventTarget = document) {
  for (const key of [...code, 'Enter']) target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}
describe('scan directly into receiving inventory', () => {
  it('receives on Enter, shows actual amounts and stays ready for the next scan', async () => {
    render(); await scan(' tl000001 ')
    expect(materialTransferApi.confirm).toHaveBeenCalledWith('TL000001', { expected_version: 3, idempotency_key: expect.any(String) })
    expect(wrapper.emitted('received')).toEqual([[received()]])
    expect(wrapper.text()).toContain('TL000001 已入库 · 100 件 / 12.5 kg')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    expect(document.querySelector('.el-message-box')).toBeNull()
  })
  it('accepts a keyboard scanner outside fields and ignores typing inside unrelated fields', async () => {
    render(); hid('TL000001'); await flushPromises()
    expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1)
    const field = document.createElement('input'); document.body.append(field)
    try { hid('TL000002', field); await flushPromises(); expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1) }
    finally { field.remove() }
  })
  it('queues different scans during a request and prevents a duplicate queued or active receipt', async () => {
    let resolve!: (value: MaterialTransfer) => void
    vi.mocked(materialTransferApi.confirm).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    render(); await scan('TL000001'); await scan('TL000002'); await scan('TL000002'); await scan('TL000001')
    expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('1 批排队中')
    resolve(received()); await flushPromises()
    expect(vi.mocked(materialTransferApi.confirm).mock.calls.map(call => call[0])).toEqual(['TL000001', 'TL000002'])
    expect(wrapper.emitted('received')).toHaveLength(2)
  })
  it.each([
    [{ status: 'received', locked: true }, '已入库，请勿重复扫码'],
    [{ status: 'voided' }, '已作废'],
    [{ next_team: { id: 3, name: '检验' } }, '接收班组与当前工作台不符'],
    [{ rejection_reason: '重量不符' }, '已退回核对'],
    [{ entry_kind: 'inspection_shipment' }, '不是待接收的内部转料单'],
    [{ allowed_actions: [] }, '当前不能签收'],
    [{ version: null }, '当前不能签收'],
  ])('does not write when the batch cannot be received: %s', async (extra, message) => {
    vi.mocked(materialTransferApi.get).mockResolvedValue(pending('TL000001', extra))
    render(); await scan()
    expect(wrapper.text()).toContain(message)
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('received')).toBeUndefined()
  })
  it('rejects old group barcodes rather than silently receiving unscanned batches', async () => {
    render(); await scan('CK-GROUP')
    expect(wrapper.text()).toContain('每批物料的独立条码')
    expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
  })
  it('does not overwrite or consume another location reservation at receipt', async () => {
    state.auth.currentUser.team_id = 2
    vi.mocked(materialTransferApi.get).mockResolvedValue(pending('TL000001', { warehouse_location: 'A-01', next_team: { id: 2, kind: 'warehouse', name: '库房' } }))
    render(); await scan()
    const payload = vi.mocked(materialTransferApi.confirm).mock.calls[0]![1]
    expect(payload).not.toHaveProperty('warehouse_location')
    expect(payload).not.toHaveProperty('warehouse_location_reservation_key')
  })
  it('keeps a failed request idempotent and does not report a failed receipt as successful', async () => {
    vi.mocked(materialTransferApi.confirm).mockRejectedValueOnce(new MaterialTransferApiError('网络中断', 0))
    render(); await scan()
    expect(wrapper.get('[role=alert]').text()).toContain('网络中断')
    expect(wrapper.emitted('received')).toBeUndefined()
    await scan()
    const calls = vi.mocked(materialTransferApi.confirm).mock.calls
    expect(calls[0]![1].idempotency_key).toBe(calls[1]![1].idempotency_key)
    expect(wrapper.emitted('received')).toHaveLength(1)
  })
  it('uses the displayed version and requires another scan after a conflict', async () => {
    vi.mocked(materialTransferApi.confirm).mockRejectedValue(new MaterialTransferApiError('转料单已更新，请重新核对', 409))
    render(); await scan()
    expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role=alert]').text()).toContain('已更新')
    expect(wrapper.emitted('received')).toBeUndefined()
  })
  it('continues the next batch after a lookup fails', async () => {
    vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('未找到该转料单'))
    render(); hid('TL000001'); hid('TL000002'); await flushPromises()
    expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1)
    expect(materialTransferApi.confirm).toHaveBeenCalledWith('TL000002', expect.any(Object))
    expect(showToast).toHaveBeenCalledWith('TL000001：未找到该转料单', 'error')
  })
  it.each(['administrator', 'other-team', 'inactive'])('does not receive for %s', async role => {
    if (role === 'administrator') state.auth.isTeamAccount = false
    if (role === 'other-team') state.auth.currentUser.team_id = 3
    if (role === 'inactive') state.auth.currentUser.active = false
    render(); hid('TL000001'); await flushPromises()
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
  })
  it('discards a lookup and queue after account identity changes', async () => {
    let resolve!: (value: MaterialTransfer) => void
    vi.mocked(materialTransferApi.get).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    render(); await scan('TL000001'); await scan('TL000002')
    state.auth.currentUser.id = 11
    resolve(pending()); await flushPromises()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(materialTransferApi.get).toHaveBeenCalledTimes(1)
  })
  it('does not write after permissions change during the refreshed identity request', async () => {
    state.auth.refreshCurrentUser.mockImplementation(async () => { state.auth.currentUser.team_id = 3 })
    render(); await scan()
    expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
  })
  it('drops queued scans when a dialog opens or the scanner unmounts', async () => {
    let resolve!: (value: MaterialTransfer) => void
    vi.mocked(materialTransferApi.get).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    render(); await scan('TL000001'); await scan('TL000002')
    await wrapper.setProps({ paused: true })
    resolve(pending()); hid('TL000003'); await flushPromises()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    wrapper.unmount(); hid('TL000004'); await flushPromises()
    expect(materialTransferApi.get).toHaveBeenCalledTimes(1)
  })
})

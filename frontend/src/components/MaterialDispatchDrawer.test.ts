// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialDispatchDrawer from './MaterialDispatchDrawer.vue'
import MaterialDispatchPrintSheet from './MaterialDispatchPrintSheet.vue'
import MaterialTransferFormDialog from './MaterialTransferFormDialog.vue'
import { materialDispatchApi, MaterialDispatchApiError } from '@/services/materialDispatchApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import { dispatchFixture, completedDispatch } from '@/testFixtures/materialDispatch'
import type { MaterialDispatchDocument } from '@/types/teamMaterials'
const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, currentUser: { id: 41, team_id: 2, active: true }, currentUserError: '', refreshCurrentUser: vi.fn() } }))
const live = vi.hoisted(() => ({ refresh: async () => {}, busy: (): boolean => false, request: vi.fn() }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>, options: { busy: () => boolean }) => { live.refresh = refresh; live.busy = options.busy; return { message: ref(''), request: live.request } } }
})
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 41, team_id: 2, active: true }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture())
  vi.spyOn(materialDispatchApi, 'confirm').mockResolvedValue(completedDispatch(dispatchFixture()))
  vi.spyOn(materialTransferApi, 'confirm').mockResolvedValue(dispatchFixture().items[0]!)
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined)
  vi.spyOn(window, 'print').mockImplementation(() => undefined)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render() { wrapper = mount(MaterialDispatchDrawer, { props: { modelValue: true, dispatchNo: 'CK-GROUP', docked: true }, global: { stubs: { MaterialTransferDetailFrame: { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' }, MaterialTransferFormDialog: true, MaterialDispatchPrintSheet: true, BarcodeCard: true, MaterialTransferHistory: true, RouterLink: true } } }); await flushPromises() }
async function click(label = '确认整批接收') { await wrapper.findAll('button').find(button => button.text() === label || button.attributes('aria-label') === label)!.trigger('click'); await flushPromises() }
describe('group confirmation and isolation', () => {
  it('updates the item table without closing expanded rows, and defers a late response while editing', async () => {
    state.auth.currentUser.team_id = 1
    await render()
    const table = wrapper.get('.dispatch-detail-lines').element
    await wrapper.get('button[aria-label="查看明细 1"]').trigger('click')
    const updated = dispatchFixture(); updated.items[0]!.quantity = 77
    vi.mocked(materialDispatchApi.get).mockResolvedValueOnce(updated)
    await live.refresh(); await flushPromises()
    expect(wrapper.get('.dispatch-detail-lines').element).toBe(table)
    expect(wrapper.get('.dispatch-expanded-line').text()).toContain('QA-GROUP-1')
    expect(wrapper.text()).toContain('77')
    let finish!: (result: MaterialDispatchDocument) => void
    vi.mocked(materialDispatchApi.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const reading = live.refresh()
    await wrapper.get('button[aria-label="编辑明细 1"]').trigger('click')
    expect(live.busy()).toBe(true)
    finish(completedDispatch(updated)); await reading; await flushPromises()
    expect(wrapper.getComponent(MaterialTransferFormDialog).props('modelValue')).toBe(true)
    expect(wrapper.getComponent(MaterialTransferFormDialog).props('transfer')?.status).toBe('pending')
    expect(live.request).toHaveBeenCalled()
  })
  it('uses one item table and expands the selected line with its complete fields and history', async () => {
    await render()
    expect(wrapper.findAll('table.dispatch-detail-lines > tbody > tr.dispatch-detail-line')).toHaveLength(2)
    expect(wrapper.find('.dispatch-identity, article.dispatch-detail-line').exists()).toBe(false)
    expect(wrapper.get('.dispatch-detail-lines tfoot').text()).toContain('20')
    await wrapper.get('button[aria-label="查看明细 1"]').trigger('click')
    expect(wrapper.get('.dispatch-expanded-line').text()).toContain('TL-ROOT-1')
    expect(wrapper.get('.dispatch-expanded-line').text()).toContain('QA-GROUP-1')
    expect(wrapper.findAll('.dispatch-expanded-line')).toHaveLength(1)
    await wrapper.get('button[aria-label="查看明细 2"]').trigger('click')
    expect(wrapper.get('.dispatch-expanded-line').text()).toContain('QA-GROUP-2')
    expect(wrapper.findAll('.dispatch-expanded-line')).toHaveLength(1)
  })
  it('fetches complete lines and confirms them once using the reviewed revision', async () => {
    await render(); await click()
    expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP')
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('本次确认 2 条'), '确认整批接收', expect.any(Object))
    expect(materialDispatchApi.confirm).toHaveBeenCalledTimes(1)
    expect(materialDispatchApi.confirm).toHaveBeenCalledWith('CK-GROUP', { expected_revision: 'a'.repeat(64), idempotency_key: expect.any(String) }, false)
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('确认班组长')
    expect(wrapper.findAll('button').some(button => button.text() === '确认整批接收')).toBe(false)
  })
  it.each([['warehouse_outbound', 1, '出库'], ['inspection_shipment', 8, '发货']] as const)('confirms %s only as the source group', async (kind, team, verb) => {
    state.auth.currentUser.team_id = team
    vi.mocked(materialDispatchApi.get).mockResolvedValue(dispatchFixture(2, kind))
    vi.mocked(materialDispatchApi.confirm).mockResolvedValue(completedDispatch(dispatchFixture(2, kind)))
    await render(); await click(`确认整批${verb}`)
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('客户收货仓'), `确认整批${verb}`, expect.any(Object))
    expect(materialDispatchApi.confirm).toHaveBeenCalledWith('CK-GROUP', expect.objectContaining({ expected_revision: 'a'.repeat(64) }), true)
    expect(wrapper.text()).toContain(`已${verb}`)
  })
  it('keeps confirmed and voided history while reviewing only remaining pending amounts', async () => {
    const group = dispatchFixture(3)
    group.items[0]!.status = 'received'; group.items[1]!.status = 'voided'; group.pending_line_count = 1; group.status = 'partial'
    vi.mocked(materialDispatchApi.get).mockResolvedValue(group); vi.mocked(materialDispatchApi.confirm).mockResolvedValue(completedDispatch(group))
    await render(); await click()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('本次：10 件、1.005 kg'), '确认整批接收', expect.any(Object))
    expect(wrapper.findAll('.dispatch-detail-line')).toHaveLength(3); expect(wrapper.text()).toContain('已作废')
  })
  it('refreshes a changed group and requires a second deliberate confirmation with a new key and revision', async () => {
    await render()
    vi.mocked(materialDispatchApi.confirm).mockRejectedValueOnce(new MaterialDispatchApiError('已更新', 409))
    vi.mocked(materialDispatchApi.get).mockResolvedValue(dispatchFixture(3, 'transfer', { revision: 'b'.repeat(64) }))
    await click()
    expect(wrapper.text()).toContain('重新核对全部明细'); expect(wrapper.findAll('.dispatch-detail-line')).toHaveLength(3)
    expect(materialDispatchApi.confirm).toHaveBeenCalledTimes(1)
    await click()
    const calls = vi.mocked(materialDispatchApi.confirm).mock.calls
    expect(calls[1]![1].expected_revision).toBe('b'.repeat(64)); expect(calls[1]![1].idempotency_key).not.toBe(calls[0]![1].idempotency_key)
  })
  it('retries an uncertain same-revision confirmation with its original key', async () => {
    await render(); vi.mocked(materialDispatchApi.confirm).mockRejectedValueOnce(new MaterialDispatchApiError('网络错误'))
    await click(); await click()
    const calls = vi.mocked(materialDispatchApi.confirm).mock.calls
    expect(calls[1]![1]).toEqual(calls[0]![1])
  })
  it('blocks printing and another confirmation when conflict refresh fails', async () => {
    await render(); vi.mocked(materialDispatchApi.confirm).mockRejectedValue(new MaterialDispatchApiError('已更新', 409)); vi.mocked(materialDispatchApi.get).mockRejectedValue(new Error('读取失败'))
    await click()
    expect(wrapper.findAll('button').some(button => button.text() === '确认整批接收')).toBe(false)
    expect(wrapper.findAll('button').find(button => button.text() === '打印整批单')!.attributes('disabled')).toBeDefined()
  })
  it('makes no write after account rebinding during identity verification', async () => {
    state.auth.refreshCurrentUser.mockImplementation(async () => { state.auth.currentUser.team_id = 8 })
    await render(); await click()
    expect(materialDispatchApi.confirm).not.toHaveBeenCalled(); expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
  it('ignores a late confirmation after a different account takes over the same team', async () => {
    let finish!: (result: MaterialDispatchDocument) => void
    vi.mocked(materialDispatchApi.confirm).mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(); await click(); state.auth.currentUser.id = 99; await flushPromises()
    finish(completedDispatch(dispatchFixture())); await flushPromises()
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
  it.each(['admin', 'other-team', 'inactive'] as const)('keeps %s read only even with action metadata present', async role => {
    if (role === 'admin') state.auth.isTeamAccount = false
    if (role === 'other-team') state.auth.currentUser.team_id = 8
    if (role === 'inactive') state.auth.currentUser.active = false
    await render()
    expect(wrapper.findAll('button').some(button => button.text() === '确认整批接收')).toBe(false)
    expect(materialDispatchApi.confirm).not.toHaveBeenCalled()
  })
  it('refreshes the group revision after editing one source line', async () => {
    state.auth.currentUser.team_id = 1; await render(); await click('编辑明细 1')
    vi.mocked(materialDispatchApi.get).mockResolvedValue(dispatchFixture(2, 'transfer', { revision: 'c'.repeat(64) }))
    wrapper.getComponent(MaterialTransferFormDialog).vm.$emit('saved', dispatchFixture().items[0]); await flushPromises()
    expect(materialDispatchApi.get).toHaveBeenCalledTimes(2); expect(wrapper.emitted('changed')![0]![0]).toMatchObject({ revision: 'c'.repeat(64) })
  })
  it('reloads complete data before printing and never prints a stale list slice', async () => {
    await render(); vi.mocked(materialDispatchApi.get).mockResolvedValue(dispatchFixture(25))
    let printed = 0
    vi.mocked(window.print).mockImplementation(() => { printed = wrapper.getComponent(MaterialDispatchPrintSheet).props('dispatch').items.length })
    await click('打印整批单')
    expect(printed).toBe(25); expect(window.print).toHaveBeenCalledOnce()
  })
})

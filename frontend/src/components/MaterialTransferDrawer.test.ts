// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import { MaterialTransferApiError, materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
const live = vi.hoisted(() => ({ refresh: async () => {}, busy: (): boolean => false, request: vi.fn() }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>, options: { busy: () => boolean }) => { live.refresh = refresh; live.busy = options.busy; return { message: ref(''), request: live.request } } }
})

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isAdmin: false, isTeamAccount: true, currentUser: { team_id: 3 } }) }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => ({ items: [], loading: false, refreshTeamDirectory: vi.fn() }) }))

function fixture(overrides: Partial<MaterialTransfer> = {}) {
  return normalizeMaterialTransfer({ id: 1, batch_no: 'TL20260906000001', serial_no: 'HS-001', source_team: { id: 2, name: '研磨' }, next_team: { id: 3, name: '电镀' }, quantity: 0, weight: 8.25, finished_quantity: 132, material_type: 'sludge', source_batch_no: 'RAW-01', material_name: '材质A', technical_requirements: '技术要求\n完整第二行', status: 'pending', locked: false, allowed_actions: ['confirm'], version: 4, ...overrides })
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(fixture())
  vi.spyOn(materialTransferApi, 'confirm').mockResolvedValue(fixture({ status: 'received', locked: true, version: 5, allowed_actions: [] }))
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render() {
  wrapper = mount(MaterialTransferDrawer, { props: { modelValue: true, batchNo: 'TL20260906000001' }, global: { stubs: {
    MaterialTransferDetailFrame: { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' },
    MaterialDispatchDrawer: true, MaterialTransferFormDialog: true, MaterialTransferPrintSheet: true, BarcodeCard: true, RouterLink: { props: ['to'], template: '<a :href="to"><slot/></a>' },
  } } })
  await flushPromises()
}
async function confirm() {
  await wrapper.findAll('button').find(button => button.text() === '确认接收')!.trigger('click')
  await flushPromises()
}

describe('material transfer receipt review', () => {
  it.each(['warehouse_outbound', 'inspection_shipment'] as const)('explains that pending %s already left stock', async (entry_kind) => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({
      entry_kind, source_team: { id: 3, code: 'FACTORY-QC', name: '本班组' }, external_destination: '外部单位', allowed_actions: ['confirm_outbound'],
    }))
    await render()
    expect(wrapper.text()).toContain('已扣减库存')
    expect(wrapper.text()).not.toContain('已预留库存')
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
    await wrapper.findAll('button').find(button => /^(确认出库|确认发货)$/.test(button.text()))!.trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('库存已在提交时扣减'), expect.any(String), expect.any(Object))
  })

  it('updates read-only fields, but keeps the reviewed version during a confirmation', async () => {
    await render()
    const table = wrapper.get('table[aria-label="转料单据资料"]').element
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ quantity: 77, version: 5 }))
    await live.refresh(); await flushPromises()
    expect(wrapper.get('table[aria-label="转料单据资料"]').element).toBe(table)
    expect(wrapper.text()).toContain('77 件')
    let finish!: (result: MaterialTransfer) => void
    vi.mocked(materialTransferApi.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const reading = live.refresh()
    let cancel!: (reason: string) => void
    vi.mocked(ElMessageBox.confirm).mockReturnValueOnce(new Promise((_resolve, reject) => { cancel = reject }))
    await wrapper.findAll('button').find(button => button.text() === '确认接收')!.trigger('click')
    expect(live.busy()).toBe(true)
    finish(fixture({ quantity: 99, version: 6 })); await reading; await flushPromises()
    expect(wrapper.text()).toContain('77 件')
    expect(live.request).toHaveBeenCalled()
    cancel('cancel'); await flushPromises(); expect(live.busy()).toBe(false)
  })
  it('puts the whole document and history in tables without summary cards or tabs', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ product_code: 'P-001', material_description: '完整物料说明', notes: '本批说明', history: [{ id: 11, action: 'created', actor: '登记员', occurred_at: '2026-09-07T00:00:00Z', changes: {} }] }))
    await render()
    const document = wrapper.get('table[aria-label="转料单据资料"]')
    for (const value of ['HS-001', '研磨', '电镀', '0 件', '8.25 kg', 'P-001', '完整物料说明', '本批说明']) expect(document.text()).toContain(value)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    expect(wrapper.find('.handoff-panel, .transfer-amounts, .barcode-panel').exists()).toBe(false)
    expect(wrapper.get('table.document-history').text()).toContain('登记员')
  })
  it('shows warehouse intake origin and audit without a second receipt or mutation action', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ entry_kind: 'warehouse_receipt', source_team: { id: '', code: '', name: '库房手工入库' }, status: 'received', locked: true, history: [{ id: 10, action: 'stocked', actor: '库管', occurred_at: '2026-09-07T00:00:00Z', changes: {} }], allowed_actions: ['edit', 'void', 'confirm'] }))
    await render()
    expect(wrapper.text()).toContain('入库来源'); expect(wrapper.text()).toContain('已入库')
    expect(wrapper.text()).toContain('登记人'); expect(wrapper.text()).toContain('手工入库已入账')
    expect(wrapper.findAll('button').some(button => ['确认接收', '编辑', '作废'].includes(button.text()))).toBe(false)
    expect(wrapper.findAll('button').some(button => button.text() === '打印入库单')).toBe(true)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('外部来源未登记')
  })
  it('allows receipt of a legacy warehouse transfer with no material classification', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ material_type: null, next_team: { id: 3, code: 'DEPOT', name: '库房', kind: 'warehouse' } }))
    await render()
    expect(wrapper.text()).toContain('未填写')
    expect(wrapper.text()).toContain('入库说明')
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledOnce()
    expect(vi.mocked(materialTransferApi.confirm).mock.calls[0]![1]).not.toHaveProperty('material_type')
  })

  it('keeps the workbench trace scope in the detail link while global details remain unscoped', async () => {
    await render()
    expect(wrapper.get('a').attributes('href')).toBe('/material-trace?serial_no=HS-001')
    await wrapper.setProps({ traceScope: { team_id: 3, direction: 'incoming' } })
    expect(wrapper.get('a').attributes('href')).toBe('/material-trace?serial_no=HS-001&team_id=3&direction=incoming')
  })

  it('displays the complete scanned document and confirms only the reviewed version without amount input', async () => {
    await render()
    expect(wrapper.text()).toContain('废泥')
    expect(wrapper.text()).toContain('RAW-01')
    expect(wrapper.text()).toContain('132 件')
    expect(wrapper.text()).toContain('技术要求\n完整第二行')
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('待接收')
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith('TL20260906000001', { idempotency_key: expect.any(String), expected_version: 4 })
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('已接收')
    expect(wrapper.findAll('button').some(button => ['编辑', '作废', '确认接收'].includes(button.text()))).toBe(false)
  })

  it('refreshes a conflicting receipt, shows the changed document and waits for a second confirmation', async () => {
    await render()
    vi.mocked(materialTransferApi.confirm).mockRejectedValueOnce(new MaterialTransferApiError('单据已更新', 409))
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ version: 5, material_name: '更新后的材质', weight: 9 }))
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('更新后的材质')
    expect(wrapper.text()).toContain('请重新核对最新内容后接收')
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('待接收')
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenLastCalledWith('TL20260906000001', { idempotency_key: expect.any(String), expected_version: 5 })
  })

  it('blocks another confirmation while the updated record cannot be loaded', async () => {
    await render()
    vi.mocked(materialTransferApi.confirm).mockRejectedValueOnce(new MaterialTransferApiError('单据已更新', 409))
    vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('offline'))
    await confirm()
    expect(wrapper.findAll('button').some(button => button.text() === '确认接收')).toBe(false)
    expect(wrapper.findAll('button').some(button => button.text() === '重新读取')).toBe(true)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('待接收')
  })

  it('does not invent a version for old responses and renders real history only', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValue(fixture({ version: null, history: [{ id: 9, action: 'updated', actor: '李师傅', occurred_at: '2026-09-06T01:20:00Z', changes: { finished_quantity: { before: null, after: 132 }, customer_code: { before: '001440', after: null } } }] }))
    await render()
    expect(wrapper.text()).toContain('李师傅')
    expect(wrapper.text()).toContain('成品件数')
    expect(wrapper.text()).toContain('001440')
    await confirm()
    expect(vi.mocked(materialTransferApi.confirm).mock.calls[0]![1]).not.toHaveProperty('expected_version')
  })

  it('keeps detail history when a same-version list refresh contains an empty history array', async () => {
    const event = { id: 12, action: 'updated' as const, actor: '保留的历史操作者', occurred_at: '2026-09-06T01:20:00Z', changes: { quantity: { before: 1, after: 0 } } }
    vi.mocked(materialTransferApi.get).mockResolvedValue(fixture({ history: [event] }))
    await render()
    await wrapper.setProps({ transfer: fixture({ history: [] }) })
    await flushPromises()
    expect(wrapper.text()).toContain('保留的历史操作者')
    expect(materialTransferApi.get).toHaveBeenCalledTimes(1)
  })

  it('loads canonical detail when a list refresh reports a newer version', async () => {
    await render()
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ version: 5, history: [{ id: 15, action: 'updated', actor: '新版本操作者', occurred_at: '2026-09-06T01:30:00Z', changes: { weight: { before: 8.25, after: 9 } } }] }))
    await wrapper.setProps({ transfer: fixture({ version: 5, history: [] }) })
    await flushPromises()
    expect(materialTransferApi.get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('新版本操作者')
  })
})

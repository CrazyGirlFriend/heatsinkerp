// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination, ElSelect } from 'element-plus'
import TransferBatchesPage from './TransferBatchesPage.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { appPinia } from '@/stores/access'
const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isAdmin: true, isTeamAccount: false, currentUser: null }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({ items: [{ id: 1, name: '库房', active: true }], refreshTeamDirectory: vi.fn() }),
}))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))

const transfer = normalizeMaterialTransfer({
  id: 1, batch_no: 'TL20260906000001', serial_no: 'FLOW-001',
  source_team: { id: 1, name: '库房' }, next_team: { id: 2, name: '加工组' },
  quantity: 80, weight: 12.5, status: 'pending', allowed_actions: [],
})
const result = { items: [transfer], total: 1, page: 1, page_size: 10 }
let wrapper: VueWrapper | undefined

beforeEach(() => {
  vi.spyOn(materialTransferApi, 'list').mockResolvedValue(result)
  vi.spyOn(materialTransferApi, 'counts').mockResolvedValue({ all: 28, pending: 12, received: 14, voided: 2, dispatched: 0 })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks() })

async function renderList(path = '/transfer-batches?status=pending') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/transfer-batches', component: TransferBatchesPage }, { path: '/material-trace', component: { template: '<div />' } }] })
  await router.push(path)
  wrapper = mount(TransferBatchesPage, {
    global: {
      plugins: [appPinia, router],
      stubs: { MaterialDispatchDrawer: true, BarcodeCard: true, MaterialTransferDrawer: true, MaterialTransferFormDialog: true },
    },
  })
  await flushPromises()
  return wrapper
}

describe('transfer list refresh continuity', () => {
  it('updates rows and counts in place without changing page, drafts or open details', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, total: 30, page: 2 })
    const page = await renderList('/transfer-batches?status=pending&page=2&query=APPLIED')
    const table = page.get('.el-table').element
    await page.get('input[aria-label="搜索转料记录"]').setValue('未提交文字')
    await page.get('.batch-link').trigger('click')
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items: [{ ...transfer, quantity: 99 }], total: 30, page: 2 })
    await live.refresh(); await flushPromises()
    expect(page.get('.el-table').element).toBe(table)
    expect(page.get('input[aria-label="搜索转料记录"]').element).toHaveProperty('value', '未提交文字')
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, query: 'APPLIED', status: 'pending' }))
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, transfer })
    expect(page.text()).toContain('99')
    vi.mocked(materialTransferApi.list).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    await flushPromises()
    expect(page.get('.el-table').element).toBe(table)
    expect(page.text()).toContain('99')
  })
  it('uses separate source and destination columns for receipts, transfers and external outbound records', async () => {
    const items = [
      normalizeMaterialTransfer({ ...transfer, id: 2, batch_no: 'TL-RECEIPT', entry_kind: 'warehouse_receipt', status: 'received', next_team: { id: 1, name: '库房' } }),
      normalizeMaterialTransfer({ ...transfer, id: 3, batch_no: 'TL-INTERNAL', source_team: { id: 4, name: '线切割' }, next_team: { id: 5, name: '雕刻' } }),
      normalizeMaterialTransfer({ ...transfer, id: 4, batch_no: 'TL-EXTERNAL', entry_kind: 'warehouse_outbound', external_destination: '外协收料单位' }),
      normalizeMaterialTransfer({ ...transfer, id: 5, batch_no: 'TL-SHIPMENT', entry_kind: 'inspection_shipment', source_team: { id: 8, name: '检验' }, external_destination: '客户收货仓', status: 'dispatched' }),
    ]
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items, total: items.length })
    const page = await renderList('/transfer-batches')
    const headings = page.findAll('.el-table__header th .cell').map(cell => cell.text())
    expect(headings).toEqual(['批次号 / 流水号', '材质', '来源', '去向', '数量 / 重量', '状态', '转出时间'])
    expect(page.findAll('.el-table__header th.el-table__cell').every(cell => cell.classes().includes('is-center'))).toBe(true)
    expect(page.getComponent({ name: 'ElTable' }).props('border')).toBe(true)
    const tableRows = page.findAll('.el-table__body .el-table__row')
    expect(tableRows.every(row => row.findAll('td').every(cell => cell.classes().includes('is-center')))).toBe(true)
    expect(tableRows.map(row => row.get('.transfer-source-cell').text())).toEqual(['库房手工入库', '线切割', '库房', '检验'])
    expect(tableRows.map(row => row.get('.transfer-destination-cell').text())).toEqual(['库房', '雕刻', '外协收料单位', '客户收货仓'])
    expect(tableRows.map(row => row.get('.transfer-status-cell').text())).toEqual(['已入库', '待接收', '待出库确认', '已发货'])
    expect(page.find('.transfer-flow, .receipt-flow, .flow-track').exists()).toBe(false)
    const mobileRows = page.findAll('.mobile-transfer-parties')
    expect(mobileRows.map(row => row.findAll('small').map(label => label.text()))).toEqual(Array.from({ length: 4 }, () => ['来源', '去向']))
    expect(mobileRows[0].text()).toContain('库房手工入库')
    expect(mobileRows[2].text()).toContain('外协收料单位')
  })

  it('keeps quantities, units and local transfer time legible in separate lines', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items: [{ ...transfer, quantity: 12345, weight: 1234.567, transferred_at: '2026-09-14T01:36:00Z' }] })
    const page = await renderList()
    const row = page.get('.el-table__body .el-table__row')
    expect(row.findAll('.amount-cell > span').map(line => line.text())).toEqual(['12,345 件', '1,234.567 kg'])
    expect(row.get('.amount-cell').element.closest('td')?.classList.contains('is-center')).toBe(true)
    expect(row.findAll('.transfer-time > span').map(line => line.text())).toEqual(['2026-09-14', '09:36'])
    expect(row.get('.transfer-time').attributes('title')).toBe('2026-09-14 09:36')
  })

  it('still opens the original detail from a source cell or the batch link', async () => {
    const page = await renderList()
    await page.get('.el-table__body .transfer-source-cell').trigger('click')
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, batchNo: transfer.batch_no })
    page.getComponent(MaterialTransferDrawer).vm.$emit('update:modelValue', false)
    await flushPromises()
    await page.get('.batch-link').trigger('click')
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, batchNo: transfer.batch_no })
  })

  it('defaults to ten requested rows with selectable page sizes', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({ items: Array.from({ length: 10 }, (_, index) => ({ ...transfer, id: index + 1, batch_no: `TL${index + 1}` })), total: 50, page: 1, page_size: 10 })
    const page = await renderList('/transfer-batches')
    expect(page.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    expect(page.getComponent(ElPagination).props('pageSizes')).toEqual([10, 20, 50, 100])
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 10 }))
    expect(page.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    page.getComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 20 }))
    expect(page.vm.$route.query.page_size).toBe('20')
  })
  async function choose(page: VueWrapper, label: string, value: string) {
    const select = page.findAllComponents(ElSelect).find(component => component.props('ariaLabel') === label)!
    select.vm.$emit('update:modelValue', value)
    select.vm.$emit('change', value)
    await flushPromises()
  }

  it('opens a CK from the list page keyboard scanner without replacing field filters', async () => {
    const page = await renderList('/transfer-batches?query=001440&search_mode=exact&search_field=customer_code')
    vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture())
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(transfer)
    for (const key of [...'CK-GROUP', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await flushPromises()
    expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP'); expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(page.getComponent(MaterialDispatchDrawer).props()).toMatchObject({ modelValue: true, dispatchNo: 'CK-GROUP' })
    expect(page.vm.$route.query).toMatchObject({ query: '001440', search_mode: 'exact', search_field: 'customer_code' })
  })

  it('restores the same field, mode and material type for list and status totals from a shared URL', async () => {
    const page = await renderList('/transfer-batches?query=001440&search_mode=exact&search_field=customer_code&material_type=finished&page=3&page_size=10&status=received')
    const scope = { query: '001440', search_mode: 'exact', search_field: 'customer_code', material_type: 'finished' }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ ...scope, page: 3, page_size: 10, status: 'received' }))
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect(page.get('input[aria-label="搜索转料记录"]').attributes('placeholder')).toBe('搜索客户代码')
    page.getComponent(ElPagination).vm.$emit('current-change', 4)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ ...scope, page: 4 }))
    expect(page.vm.$route.query).toMatchObject({ search_mode: 'exact', search_field: 'customer_code', material_type: 'finished', page: '4' })
    page.getComponent(ElPagination).vm.$emit('size-change', 50)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ ...scope, page: 1, page_size: 50 }))
  })

  it('preserves contains/all for existing URLs and rejects unknown search options', async () => {
    const page = await renderList('/transfer-batches?query=旧备注&search_mode=typo&search_field=unknown&material_type=invalid')
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: '旧备注', search_mode: 'contains', search_field: 'all', material_type: undefined }))
    expect(page.get('input[aria-label="搜索转料记录"]').attributes('placeholder')).toContain('班组或转料人')
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(page.vm.$route.query).toEqual({ query: '旧备注' })
  })

  it('applies explicit search choices to both scopes, resets the page and clears every filter on reset', async () => {
    const page = await renderList('/transfer-batches?query=AL%_&page=3&source_team_id=1')
    await choose(page, '搜索方式', 'prefix')
    expect(page.text()).toContain('从内容开头匹配')
    expect(page.text()).toContain('客户代码、材质')
    await choose(page, '搜索字段', 'material_name')
    await choose(page, '筛选物料类型', 'sludge')
    const scope = { query: 'AL%_', search_mode: 'prefix', search_field: 'material_name', material_type: 'sludge', source_team_id: '1' }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ ...scope, page: 1 }))
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect(page.vm.$route.query).toMatchObject({ query: 'AL%_', search_mode: 'prefix', search_field: 'material_name', material_type: 'sludge' })
    await page.get('button[aria-label="重置"]').trigger('click')
    await flushPromises()
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith({ query: undefined, search_mode: 'contains', search_field: 'all', material_type: undefined, source_team_id: undefined, next_team_id: undefined })
    expect(page.vm.$route.query).toEqual({})
  })

  it('restores filters after route navigation without keeping stale fields or totals', async () => {
    const page = await renderList('/transfer-batches?query=A&search_mode=exact&search_field=batch_no&material_type=finished')
    await page.vm.$router.push('/transfer-batches?query=B&search_mode=prefix&search_field=source_batch_no&material_type=waste&page=2')
    await flushPromises()
    const scope = { query: 'B', search_mode: 'prefix', search_field: 'source_batch_no', material_type: 'waste' }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ ...scope, page: 2 }))
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect((page.get('input[aria-label="搜索转料记录"]').element as HTMLInputElement).value).toBe('B')
    await page.vm.$router.push('/transfer-batches?query=旧备注')
    await flushPromises()
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining({ query: '旧备注', search_mode: 'contains', search_field: 'all', material_type: undefined }))
  })

  it('keeps the existing table mounted while refreshing its data', async () => {
    const page = await renderList()
    const table = page.get('.el-table').element
    let finish!: (value: typeof result) => void
    vi.mocked(materialTransferApi.list).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))

    await page.get('form').trigger('submit')
    expect(page.get('.table-pane').attributes('aria-busy')).toBe('true')
    expect(page.get('.el-table').element).toBe(table)
    expect(page.text()).toContain('FLOW-001')

    finish({ ...result, items: [{ ...transfer, serial_no: 'FLOW-002' }] })
    await flushPromises()
    expect(page.get('.el-table').element).toBe(table)
    expect(page.get('.table-pane').attributes('aria-busy')).toBe('false')
    expect(page.text()).toContain('FLOW-002')
  })

  it('requeries the active filter and total after a drawer action changes a record', async () => {
    const page = await renderList()
    vi.mocked(materialTransferApi.list).mockResolvedValueOnce({ ...result, items: [], total: 0 })
    vi.mocked(materialTransferApi.counts).mockResolvedValueOnce({ all: 28, pending: 11, received: 15, voided: 2, dispatched: 0 })

    page.getComponent(MaterialTransferDrawer).vm.$emit('changed', { ...transfer, status: 'received', locked: true })
    await flushPromises()

    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending' }))
    expect(page.text()).toContain('共 0 条')
    expect(page.text()).not.toContain('FLOW-001')
    expect(page.text()).toContain('暂无转料记录')
    expect(page.get('.status-filter--pending strong').text()).toBe('11')
    expect(page.get('.status-filter--received strong').text()).toBe('15')
  })

  it('keeps totals for all matching records when selecting a status, rather than counting the current page', async () => {
    const page = await renderList()
    expect(page.get('.status-filter--all strong').text()).toBe('28')
    expect(page.get('.status-filter--pending strong').text()).toBe('12')
    await page.get('.status-filter--received').trigger('click')
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'received', page: 1 }))
    expect(materialTransferApi.counts).toHaveBeenCalledTimes(1)
    expect(page.get('.status-filter--received').attributes('aria-pressed')).toBe('true')
    expect(page.get('.status-filter--all strong').text()).toBe('28')
  })

  it('does not replace the current search totals with a late response for a previous search', async () => {
    const page = await renderList()
    type Counts = Awaited<ReturnType<typeof materialTransferApi.counts>>
    let finishOld!: (value: Counts) => void
    let finishNew!: (value: Counts) => void
    vi.mocked(materialTransferApi.counts)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve }))
    await page.get('input[aria-label="搜索转料记录"]').setValue('OLD')
    await page.get('form').trigger('submit')
    await flushPromises()
    await page.get('input[aria-label="搜索转料记录"]').setValue('NEW')
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'NEW' }))
    finishNew({ all: 7, pending: 3, received: 4, voided: 0, dispatched: 0 })
    await flushPromises()
    finishOld({ all: 18, pending: 9, received: 7, voided: 2, dispatched: 0 })
    await flushPromises()
    expect(page.get('.status-filter--all strong').text()).toBe('7')
    expect(page.get('.status-filter--pending strong').text()).toBe('3')
  })
})

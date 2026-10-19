// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElInput, ElPagination, ElSelect } from 'element-plus'
import FilterDialog from '@/components/FilterDialog.vue'
import TableExportButton from '@/components/TableExportButton.vue'
import TableColumnFilter from '@/components/TableColumnFilter.vue'
import { ElOption } from 'element-plus'
import TransferBatchesPage from './TransferBatchesPage.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { appPinia } from '@/stores/access'
import { showToast } from '@/stores/toast'
const live = vi.hoisted(() => ({ refresh: async () => {} }))
const state = vi.hoisted(() => ({
  auth: {
    isAdmin: true,
    isTeamAccount: false,
    currentUser: { id: 1, team_id: null as number | null },
  },
}))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return {
    useLiveRefresh: (refresh: () => Promise<void>) => {
      live.refresh = refresh
      return { message: ref(''), request: vi.fn() }
    },
  }
})

vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [{ id: 1, name: '库房', active: true }],
    refreshTeamDirectory: vi.fn(),
  }),
}))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))

const transfer = normalizeMaterialTransfer({
  id: 1,
  batch_no: 'TL20260906000001',
  serial_no: 'FLOW-001',
  source_team: { id: 1, name: '库房' },
  next_team: { id: 2, name: '加工组' },
  quantity: 80,
  weight: 12.5,
  status: 'pending',
  allowed_actions: [],
})
const result = { items: [transfer], total: 1, page: 1, page_size: 10 }
let wrapper: VueWrapper | undefined

beforeEach(() => {
  localStorage.clear()
  state.auth = reactive({
    isAdmin: true,
    isTeamAccount: false,
    currentUser: { id: 1, team_id: null },
  })
  vi.spyOn(materialTransferApi, 'list').mockResolvedValue(result)
  vi.spyOn(materialTransferApi, 'counts').mockResolvedValue({
    all: 28,
    pending: 12,
    received: 14,
    voided: 2,
    dispatched: 0,
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  localStorage.clear()
})

async function renderList(path = '/transfer-batches?status=pending') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/transfer-batches', component: TransferBatchesPage },
      { path: '/material-trace', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  wrapper = mount(TransferBatchesPage, {
    global: {
      plugins: [appPinia, router],
      stubs: {
        MaterialDispatchDrawer: true,
        BarcodeCard: true,
        MaterialTransferDrawer: true,
        MaterialTransferFormDialog: true,
      },
    },
  })
  await flushPromises()
  wrapper.getComponent(FilterDialog).vm.$emit('update:modelValue', true)
  await flushPromises()
  return wrapper
}

function statusCount(page: VueWrapper, value: string) {
  const select = page
    .findAllComponents(ElSelect)
    .find((item) => item.find('input[aria-label="转料状态"]').exists())!
  const option = select.findAllComponents(ElOption).find((item) => item.props('value') === value)!
  return String(option.props('label')).match(/（(.*)）$/)![1]
}

async function filterColumn(page: VueWrapper, label: string, value: string, end = '') {
  page
    .findAllComponents(TableColumnFilter)
    .find((filter) => filter.props('label') === label)!
    .vm.$emit('apply', value, end)
  await flushPromises()
}

const defaultHeaders = [
  '流水号',
  '转出时间',
  '材质',
  '来源',
  '去向',
  '接收业务',
  '物料类型',
  '数量',
  '重量',
  '状态',
  '实际尺寸',
  '转料人',
  '接收人',
  '签收时间',
  '批次号',
]
function tableHeaders(page: VueWrapper) {
  return page.findAll('.el-table__header-wrapper th:not(.gutter)').map((cell) => cell.text())
}

describe('transfer display columns', () => {
  it('shows dimensions and actual receiving and sending employees by default, separately from accounts', async () => {
    const received = normalizeMaterialTransfer({
      ...transfer,
      entry_kind: 'transfer',
      status: 'received',
      transfer_specification: '30 × 20 × 2 mm',
      sent_employee_name: '张师傅',
      received_employee_name: '李师傅',
      transferred_by: '库房账号',
      received_by: '轧制账号',
      received_at: '2026-10-15T02:10:00Z',
    })
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items: [received] })
    const page = await renderList('/transfer-batches')
    expect(tableHeaders(page)).toEqual(defaultHeaders)
    const row = page.get('.el-table__body .el-table__row')
    expect(row.get('.transfer-transfer-specification-cell').text()).toBe('30 × 20 × 2 mm')
    expect(row.get('.transfer-sent-employee-name-cell').text()).toBe('张师傅')
    expect(row.get('.transfer-received-employee-name-cell').text()).toBe('李师傅')
    expect(row.get('.transfer-received-at-cell').text()).toBe('2026-10-15 10:10')
    expect(row.text()).not.toContain('库房账号')
    expect(row.text()).not.toContain('轧制账号')
  })

  it('offers all missing document fields and keeps each field in its own centered column', async () => {
    const record = normalizeMaterialTransfer({
      ...transfer,
      entry_kind: 'transfer',
      status: 'received',
      transfer_specification: '30 × 20 × 2 mm',
      finished_specification: '25 × 18 × 1 mm',
      sent_employee_name: '张师傅',
      received_employee_name: '李师傅',
      received_at: '2026-10-15T02:10:00Z',
      source_transfer_batch_no: 'TL-PARENT',
      source_batch_no: 'SUPPLIER-001',
      customer_code: 'CUSTOMER-A',
      delivery_date: '2026-10-20',
      delivery_quantity: 200,
      warehouse_location: '成品区-C02',
      notes: '同一批物料的说明',
      transferred_by: '库房操作账号',
    })
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items: [record] })
    const page = await renderList('/transfer-batches')
    const settings = page.getComponent({ name: 'InventoryColumnSettings' })
    const choices = settings.props('columns') as { key: string; label: string }[]
    expect(choices).toHaveLength(23)
    const expected = {
      transfer_specification: ['实际尺寸', '30 × 20 × 2 mm'],
      sent_employee_name: ['转料人', '张师傅'],
      received_employee_name: ['接收人', '李师傅'],
      received_at: ['签收时间', '2026-10-15 10:10'],
      entry_kind: ['转料方式', '内部转料'],
      finished_specification: ['成品规格', '25 × 18 × 1 mm'],
      source_transfer_batch_no: ['上一批次号', 'TL-PARENT'],
      source_batch_no: ['原单批号', 'SUPPLIER-001'],
      customer_code: ['客户代码', 'CUSTOMER-A'],
      delivery_date: ['要求发货日期', '2026-10-20'],
      delivery_quantity: ['应发成品件数', '200'],
      warehouse_location: ['仓位', '成品区-C02'],
      notes: ['说明', '同一批物料的说明'],
      transferred_by: ['开单操作账号', '库房操作账号'],
    }
    settings.vm.$emit(
      'change',
      choices.map((column) => ({ key: column.key, visible: true })),
    )
    await flushPromises()
    expect(tableHeaders(page)).toEqual([
      '流水号',
      '转出时间',
      ...choices.map((column) => column.label),
      '批次号',
    ])
    const row = page.get('.el-table__body .el-table__row')
    expect(row.findAll('td')).toHaveLength(26)
    for (const [key, [label, value]] of Object.entries(expected)) {
      expect(choices.find((column) => column.key === key)?.label).toBe(label)
      const cell = row.get(`.transfer-${key.replaceAll('_', '-')}-cell`)
      expect(cell.text()).toBe(value)
      expect(cell.classes()).toContain('is-center')
    }
    const exported = page.getComponent(TableExportButton).props('source')()!
    expect(exported.fields).toHaveLength(26)
    expect(materialTransferApi.list).toHaveBeenCalledTimes(1)
    const [exportedRow] = await exported.load(new AbortController().signal, () => undefined)
    for (const [key, [, value]] of Object.entries(expected)) {
      expect(exported.fields.some((field) => field.key === key)).toBe(true)
      expect(String(exportedRow?.[key])).toBe(value)
    }
  })

  it('restores the chosen order and visibility per account while keeping identity columns in place', async () => {
    localStorage.setItem(
      'heatsink.transfer-columns.v1:1',
      JSON.stringify([
        { key: 'weight', visible: true },
        { key: 'material', visible: false },
        { key: 'source', visible: true },
      ]),
    )
    const page = await renderList()
    expect(tableHeaders(page)).toEqual(['流水号', '转出时间', '重量', '来源', '批次号'])
    const row = page.get('.el-table__body .el-table__row')
    expect(row.get('td.transfer-weight-cell').text()).toBe('12.5 kg')
    expect(row.get('td.transfer-source-cell').text()).toBe('库房')
    await row.get('.batch-link').trigger('click')
    expect(page.getComponent(MaterialTransferDrawer).props('batchNo')).toBe(transfer.batch_no)

    state.auth.currentUser = { id: 2, team_id: 2 }
    await flushPromises()
    expect(tableHeaders(page)).toEqual(defaultHeaders)
    expect(page.getComponent({ name: 'InventoryColumnSettings' }).props('storageKey')).toBe(
      'heatsink.transfer-columns.v1:2',
    )
    state.auth.currentUser = { id: 1, team_id: null }
    await flushPromises()
    expect(tableHeaders(page)).toEqual(['流水号', '转出时间', '重量', '来源', '批次号'])
  })

  it('changes display without reloading, losing hidden filters, changing pagination or narrowing export fields', async () => {
    const page = await renderList('/transfer-batches?material_query=W80&page=3')
    expect(tableHeaders(page)).toEqual(defaultHeaders)
    await page.get('.batch-link').trigger('click')
    const exportBefore = page.getComponent(TableExportButton).props('source')()!
    const routeBefore = page.vm.$route.fullPath
    const listCalls = vi.mocked(materialTransferApi.list).mock.calls.length
    const countCalls = vi.mocked(materialTransferApi.counts).mock.calls.length
    page.getComponent({ name: 'InventoryColumnSettings' }).vm.$emit('change', [
      { key: 'weight', visible: true },
      { key: 'material', visible: false },
      { key: 'source', visible: true },
    ])
    await flushPromises()
    expect(tableHeaders(page)).toEqual(['流水号', '转出时间', '重量', '来源', '批次号'])
    expect(materialTransferApi.list).toHaveBeenCalledTimes(listCalls)
    expect(materialTransferApi.counts).toHaveBeenCalledTimes(countCalls)
    expect(page.vm.$route.fullPath).toBe(routeBefore)
    expect(page.getComponent(ElPagination).props('currentPage')).toBe(3)
    expect(page.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(true)
    expect(page.getComponent(FilterDialog).props('count')).toBeGreaterThan(0)
    const exported = page.getComponent(TableExportButton).props('source')()!
    expect(exported.fields).toEqual(exportBefore.fields)
    await exported.load(new AbortController().signal, () => undefined)
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ material_query: 'W80', page: 1, page_size: 100 }),
    )
  })
})

describe('transfer header filtering', () => {
  it('combines columns and top filters, resets pagination, and exports only applied criteria', async () => {
    const page = await renderList('/transfer-batches?query=APPLIED&page=3')
    page.getComponent(FilterDialog).vm.$emit('update:modelValue', false)
    await page.get('input[aria-label="搜索转料记录"]').setValue('UNSENT')
    for (const [label, value, end] of [
      ['流水号', 'YS-001'],
      ['材质', '材料1'],
      ['接收业务', '业务1'],
      ['批次号', 'TL-'],
      ['来源', '1,2'],
      ['去向', '7,8'],
      ['物料类型', 'finished,semi_finished'],
      ['数量', '0', '20'],
      ['重量', '1.352', '2'],
      ['转出时间', '2026-10-12', '2026-10-13'],
      ['状态', 'pending,received'],
    ])
      await filterColumn(page, label!, value!, end)
    const scope = {
      query: 'APPLIED',
      serial_query: 'YS-001',
      material_query: '材料1',
      purpose_query: '业务1',
      batch_query: 'TL-',
      source_team_ids: '1,2',
      next_team_ids: '7,8',
      material_types: 'finished,semi_finished',
      quantity_min: '0',
      quantity_max: '20',
      weight_min: '1.352',
      weight_max: '2',
      date_from: '2026-10-12',
      date_to: '2026-10-13',
    }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, statuses: 'pending,received', page: 1 }),
    )
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect(vi.mocked(materialTransferApi.counts).mock.lastCall![0]).not.toHaveProperty('statuses')
    expect(page.vm.$route.query).toMatchObject({ ...scope, statuses: 'pending,received' })
    expect(page.vm.$route.query).not.toHaveProperty('page')
    page.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, page: 2 }),
    )
    const source = page.getComponent(TableExportButton).props('source')()!
    await source.load(new AbortController().signal, () => undefined)
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, statuses: 'pending,received', page: 1, page_size: 100 }),
    )
    expect(page.get('input[aria-label="搜索转料记录"]').element).toHaveProperty('value', 'UNSENT')
  })

  it('preserves filter headers with no results and can clear one column without losing others', async () => {
    const page = await renderList('/transfer-batches?serial_query=YS-001&material_query=材料1')
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items: [], total: 0 })
    await filterColumn(page, '材质', '不存在')
    expect(page.get('.el-table').text()).toContain('暂无转料记录')
    expect(page.findAllComponents(TableColumnFilter)).toHaveLength(11)
    await filterColumn(page, '材质', '')
    const last = vi.mocked(materialTransferApi.list).mock.lastCall![0]!
    expect(last.serial_query).toBe('YS-001')
    expect(last).not.toHaveProperty('material_query')
    expect(page.vm.$route.query).toEqual({ serial_query: 'YS-001' })
  })

  it('restores multiple choices from URLs and clears all column criteria from the existing dialog', async () => {
    const page = await renderList(
      '/transfer-batches?source_team_ids=1,2&statuses=pending,received&quantity_min=0&weight_max=2',
    )
    const source = page
      .findAllComponents(TableColumnFilter)
      .find((filter) => filter.props('label') === '来源')!
    expect(source.props('value')).toBe('1,2')
    await page.vm.$router.push('/transfer-batches?material_query=W80')
    await flushPromises()
    expect(source.props('value')).toBe('')
    const last = vi.mocked(materialTransferApi.list).mock.lastCall![0]!
    expect(last.material_query).toBe('W80')
    expect(last).not.toHaveProperty('quantity_min')
    expect(last).not.toHaveProperty('statuses')
    page.getComponent(FilterDialog).vm.$emit('reset')
    page.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(page.vm.$route.query).toEqual({})
    expect(
      page
        .findAllComponents(TableColumnFilter)
        .every((filter) => !filter.props('value') && !filter.props('end')),
    ).toBe(true)
  })

  it('shares numeric validation with the advanced dialog and keeps invalid drafts open', async () => {
    const page = await renderList('/transfer-batches')
    const minimum = page
      .findAllComponents(ElInput)
      .find((input) => input.find('input[aria-label="最少件数"]').exists())!
      .get('input')
    const maximum = page
      .findAllComponents(ElInput)
      .find((input) => input.find('input[aria-label="最多件数"]').exists())!
      .get('input')
    await minimum.setValue('20')
    await maximum.setValue('10')
    const requests = vi.mocked(materialTransferApi.list).mock.calls.length
    page.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenCalledTimes(requests)
    expect(minimum.attributes('aria-invalid')).toBe('true')
    expect(page.getComponent(FilterDialog).props('modelValue')).toBe(true)
    await maximum.setValue('30')
    page.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ quantity_min: '20', quantity_max: '30' }),
    )
  })
})

describe('transfer amount summary', () => {
  const summary = {
    received: { quantity: 3784, weight: 1.1341 },
    pending: { quantity: 2882, weight: 0.865 },
  }
  const summarized = { ...result, total: 105, summary }

  it('shows all filtered totals in separate fields and retains them across pages', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue(summarized)
    const page = await renderList('/transfer-batches?query=805881-5')
    const totals = page.get('.transfer-summary')
    expect(totals.get('[data-status="received"]').text()).toContain('已签收')
    expect(totals.get('[data-status="pending"]').text()).toContain('待签收')
    expect(totals.findAll('strong').map((item) => item.text())).toEqual([
      '3,784',
      '1.1341',
      '2,882',
      '0.865',
    ])
    await page.get('input[aria-label="搜索转料记录"]').setValue('未提交搜索')
    page.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: '805881-5', page: 2, include_summary: true }),
    )
    expect(totals.findAll('strong').map((item) => item.text())).toEqual([
      '3,784',
      '1.1341',
      '2,882',
      '0.865',
    ])
  })

  it('clears totals while changing filters and discards stale results', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue(summarized)
    const page = await renderList('/transfer-batches?query=A')
    let resolveB!: (value: typeof summarized) => void
    vi.mocked(materialTransferApi.list).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveB = resolve
      }),
    )
    await page.vm.$router.push('/transfer-batches?query=B')
    await flushPromises()
    expect(page.get('.transfer-summary').attributes('aria-busy')).toBe('true')
    expect(page.findAll('.transfer-summary strong').map((item) => item.text())).toEqual([
      '—',
      '—',
      '—',
      '—',
    ])
    const zeroSummary = {
      received: { quantity: 0, weight: 0 },
      pending: { quantity: 0, weight: 0 },
    }
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      ...result,
      items: [],
      total: 0,
      summary: zeroSummary,
    })
    await page.vm.$router.push('/transfer-batches?query=C&status=voided')
    await flushPromises()
    resolveB(summarized)
    await flushPromises()
    expect(page.findAll('.transfer-summary strong').map((item) => item.text())).toEqual([
      '0',
      '0',
      '0',
      '0',
    ])
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'C', status: 'voided', include_summary: true }),
    )
  })

  it('refreshes totals with records and retains the last result on a background failure', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue(summarized)
    const page = await renderList('/transfer-batches')
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      ...summarized,
      summary: {
        received: { quantity: 6666, weight: 1.9991 },
        pending: { quantity: 0, weight: 0 },
      },
    })
    await live.refresh()
    await flushPromises()
    expect(page.findAll('.transfer-summary strong').map((item) => item.text())).toEqual([
      '6,666',
      '1.9991',
      '0',
      '0',
    ])
    vi.mocked(materialTransferApi.list).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    expect(page.get('.transfer-summary').text()).toContain('6,666')
    vi.mocked(materialTransferApi.list).mockRejectedValueOnce(new Error('offline'))
    await page.vm.$router.push('/transfer-batches?query=NEW')
    await flushPromises()
    expect(page.find('.transfer-summary').exists()).toBe(false)
  })
})

describe('transfer list refresh continuity', () => {
  it('exports all applied filtered pages, ignoring an unsubmitted search draft', async () => {
    const page = await renderList(
      '/transfer-batches?status=pending&page=2&query=APPLIED&source_team_id=1',
    )
    await page.get('input[aria-label="搜索转料记录"]').setValue('UNSENT')
    const source = page.getComponent(TableExportButton).props('source')()!
    vi.mocked(materialTransferApi.list).mockImplementation(async (params) => ({
      items: Array.from({ length: params?.page === 1 ? 100 : 5 }, (_, index) => ({
        ...transfer,
        id: index + (params?.page === 1 ? 1 : 101),
        serial_no: '000012',
      })),
      total: 105,
      page: params?.page || 1,
      page_size: 100,
    }))
    const rows = await source.load(new AbortController().signal, () => undefined)
    expect(rows).toHaveLength(105)
    expect(rows[0].serial_no).toBe('000012')
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'APPLIED',
        status: 'pending',
        source_team_id: '1',
        page: 2,
        page_size: 100,
      }),
    )
    expect(source.fields.slice(0, 2).map((field: { key: string }) => field.key)).toEqual([
      'serial_no',
      'transferred_at',
    ])
    expect(source.fields.at(-1)!.key).toBe('batch_no')
  })
  it('discards a late batch link lookup after the account changes', async () => {
    let finish!: (value: Awaited<ReturnType<typeof materialDispatchApi.get>>) => void
    vi.spyOn(materialDispatchApi, 'get').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const page = await renderList('/transfer-batches?batch_no=CK-GROUP')
    state.auth.currentUser.id = 99
    await flushPromises()
    finish(dispatchFixture())
    await flushPromises()
    expect(page.getComponent(MaterialDispatchDrawer).props('modelValue')).toBe(false)
    expect(page.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
  })

  it('updates rows and counts in place without changing page, drafts or open details', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, total: 30, page: 2 })
    const page = await renderList('/transfer-batches?status=pending&page=2&query=APPLIED')
    const table = page.get('.el-table').element
    await page.get('input[aria-label="搜索转料记录"]').setValue('未提交文字')
    await page.get('.batch-link').trigger('click')
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      ...result,
      items: [{ ...transfer, quantity: 99 }],
      total: 30,
      page: 2,
    })
    await live.refresh()
    await flushPromises()
    expect(page.get('.el-table').element).toBe(table)
    expect(page.get('input[aria-label="搜索转料记录"]').element).toHaveProperty(
      'value',
      '未提交文字',
    )
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, query: 'APPLIED', status: 'pending' }),
    )
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      transfer,
    })
    expect(page.find('.transfers-page--detail, .detail-slot').exists()).toBe(false)
    expect(page.getComponent(MaterialTransferDrawer).attributes('docked')).toBeUndefined()
    expect(page.text()).toContain('99')
    vi.mocked(materialTransferApi.list).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    await flushPromises()
    expect(page.get('.el-table').element).toBe(table)
    expect(page.text()).toContain('99')
  })
  it('uses separate source and destination columns for receipts, transfers and external outbound records', async () => {
    const items = [
      normalizeMaterialTransfer({
        ...transfer,
        id: 2,
        batch_no: 'TL-RECEIPT',
        external_source: '供应商 A',
        material_type: 'raw_material',
        entry_kind: 'warehouse_receipt',
        status: 'received',
        next_team: { id: 1, name: '库房' },
      }),
      normalizeMaterialTransfer({
        ...transfer,
        id: 3,
        batch_no: 'TL-INTERNAL',
        material_type: 'semi_finished',
        source_team: { id: 7, name: '电镀' },
        next_team: { id: 8, name: '检验' },
        purpose_name: '去毛刺',
      }),
      normalizeMaterialTransfer({
        ...transfer,
        id: 4,
        batch_no: 'TL-EXTERNAL',
        material_type: 'waste',
        entry_kind: 'warehouse_outbound',
        external_destination: '外协收料单位',
        purpose_name: '旧来源业务',
      }),
      normalizeMaterialTransfer({
        ...transfer,
        id: 5,
        batch_no: 'TL-SHIPMENT',
        entry_kind: 'inspection_shipment',
        source_team: { id: 8, name: '检验' },
        external_destination: '客户收货仓',
        status: 'dispatched',
      }),
    ]
    vi.mocked(materialTransferApi.list).mockResolvedValue({ ...result, items, total: items.length })
    const page = await renderList('/transfer-batches')
    const headings = page.findAll('.el-table__header th .cell').map((cell) => cell.text())
    expect(headings).toEqual(defaultHeaders)
    expect(
      page
        .findAll('.el-table__header th.el-table__cell')
        .every((cell) => cell.classes().includes('is-center')),
    ).toBe(true)
    expect(page.getComponent({ name: 'ElTable' }).props('border')).toBe(true)
    const tableRows = page.findAll('.el-table__body .el-table__row')
    expect(
      tableRows.every((row) =>
        row.findAll('td').every((cell) => cell.classes().includes('is-center')),
      ),
    ).toBe(true)
    expect(tableRows.map((row) => row.get('.transfer-source-cell').text())).toEqual([
      '供应商 A',
      '电镀',
      '库房',
      '检验',
    ])
    expect(tableRows.map((row) => row.get('.transfer-destination-cell').text())).toEqual([
      '库房',
      '检验',
      '外协收料单位',
      '客户收货仓',
    ])
    expect(tableRows.map((row) => row.get('.transfer-purpose-cell').text())).toEqual([
      '未指定',
      '去毛刺',
      '—',
      '—',
    ])
    expect(tableRows.map((row) => row.get('.transfer-material-type-cell').text())).toEqual([
      '原材料',
      '半成品',
      '废料',
      '未填写',
    ])
    expect(tableRows.map((row) => row.get('.transfer-status-cell').text())).toEqual([
      '已入库',
      '待签收',
      '待出库',
      '已发货',
    ])
    expect(page.find('.transfer-flow, .receipt-flow, .flow-track').exists()).toBe(false)
    const mobileRows = page.findAll('.mobile-transfer-parties')
    expect(mobileRows.map((row) => row.findAll('small').map((label) => label.text()))).toEqual(
      Array.from({ length: 4 }, () => ['来源', '去向', '接收业务']),
    )
    expect(mobileRows[0].text()).toContain('供应商 A')
    expect(mobileRows[1].text()).toContain('去毛刺')
    expect(mobileRows[2].text()).toContain('外协收料单位')
    expect(mobileRows[2].text()).not.toContain('旧来源业务')
  })

  it('separates quantities and weights into columns while keeping the timestamp on one line', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      ...result,
      items: [
        { ...transfer, quantity: 12345, weight: 1234.567, transferred_at: '2026-09-14T01:36:00Z' },
      ],
    })
    const page = await renderList()
    const row = page.get('.el-table__body .el-table__row')
    expect(row.get('td.transfer-quantity-cell').text()).toBe('12,345 件')
    expect(row.get('td.transfer-weight-cell').text()).toBe('1,234.567 kg')
    expect(row.get('td.transfer-quantity-cell').classes()).toContain('is-center')
    expect(row.get('td.transfer-weight-cell').classes()).toContain('is-center')
    expect(row.get('.transfer-time').text()).toBe('2026-09-14 09:36')
    expect(row.find('.amount-cell, .transfer-time > span, br').exists()).toBe(false)
    expect(row.get('.transfer-time').attributes('title')).toBe('2026-09-14 09:36')
  })

  it('still opens the original detail from a source cell or the batch link', async () => {
    const page = await renderList()
    await page.get('.el-table__body .transfer-source-cell').trigger('click')
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      batchNo: transfer.batch_no,
    })
    page.getComponent(MaterialTransferDrawer).vm.$emit('update:modelValue', false)
    await flushPromises()
    await page.get('.batch-link').trigger('click')
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      batchNo: transfer.batch_no,
    })
  })

  it('defaults to ten requested rows with selectable page sizes', async () => {
    vi.mocked(materialTransferApi.list).mockResolvedValue({
      items: Array.from({ length: 10 }, (_, index) => ({
        ...transfer,
        id: index + 1,
        batch_no: `TL${index + 1}`,
      })),
      total: 50,
      page: 1,
      page_size: 10,
    })
    const page = await renderList('/transfer-batches')
    expect(page.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    expect(page.getComponent(ElPagination).props('pageSizes')).toEqual([10, 20, 50, 100])
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 10 }),
    )
    expect(page.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    page.getComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 20 }),
    )
    expect(page.vm.$route.query.page_size).toBe('20')
  })
  async function choose(page: VueWrapper, label: string, value: string) {
    const select = page
      .findAllComponents(ElSelect)
      .find((component) => component.props('ariaLabel') === label)!
    select.vm.$emit('update:modelValue', value)
    page.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
  }

  it('does not intercept scanner input or open documents from F2 on the records page', async () => {
    const page = await renderList(
      '/transfer-batches?query=001440&search_mode=exact&search_field=customer_code',
    )
    vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture())
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(transfer)
    vi.spyOn(materialTransferApi, 'confirm').mockResolvedValue(transfer)
    for (const code of ['CK-GROUP', 'TL000001'])
      for (const suffix of ['Enter', 'Tab']) {
        for (const key of [...code, suffix])
          window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    await flushPromises()
    expect(materialDispatchApi.get).not.toHaveBeenCalled()
    expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(page.getComponent(MaterialDispatchDrawer).props('modelValue')).toBe(false)
    expect(page.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
    expect(page.find('[aria-label="扫码查询"]').exists()).toBe(false)
    expect(document.querySelector('.transfer-scan-popover')).toBeNull()
    expect(page.vm.$route.query).toMatchObject({
      query: '001440',
      search_mode: 'exact',
      search_field: 'customer_code',
    })
  })

  it('opens the retained batch link without replacing list filters', async () => {
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(transfer)
    const page = await renderList('/transfer-batches?batch_no=tl000001&status=pending&query=0001')
    expect(materialTransferApi.get).toHaveBeenCalledWith('TL000001')
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({
      modelValue: true,
      transfer,
    })
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'pending', query: '0001' }),
    )
  })

  it('keeps ordinary historical group links usable inside the list page', async () => {
    vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture())
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue(transfer)
    const page = await renderList('/transfer-batches?batch_no=CK-GROUP')
    expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP')
    expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(page.getComponent(MaterialDispatchDrawer).props()).toMatchObject({
      modelValue: true,
      dispatchNo: 'CK-GROUP',
    })
  })

  it('reports a missing linked batch without opening a scanner or document', async () => {
    vi.spyOn(materialTransferApi, 'get').mockRejectedValue(new Error('未找到批次'))
    const page = await renderList('/transfer-batches?batch_no=TL-MISSING')
    expect(page.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(false)
    expect(showToast).toHaveBeenCalledWith('未找到批次', 'error')
    expect(page.find('[aria-label="扫码查询"]').exists()).toBe(false)
  })

  it('restores the same field, mode and material type for list and status totals from a shared URL', async () => {
    const page = await renderList(
      '/transfer-batches?query=001440&search_mode=exact&search_field=customer_code&material_type=finished&page=3&page_size=10&status=received',
    )
    const scope = {
      query: '001440',
      search_mode: 'exact',
      search_field: 'customer_code',
      material_type: 'finished',
    }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, page: 3, page_size: 10, status: 'received' }),
    )
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect(page.get('input[aria-label="搜索转料记录"]').attributes('placeholder')).toBe(
      '搜索客户代码',
    )
    page.getComponent(ElPagination).vm.$emit('current-change', 4)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, page: 4 }),
    )
    expect(page.vm.$route.query).toMatchObject({
      search_mode: 'exact',
      search_field: 'customer_code',
      material_type: 'finished',
      page: '4',
    })
    page.getComponent(ElPagination).vm.$emit('size-change', 50)
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, page: 1, page_size: 50 }),
    )
  })

  it('preserves contains/all for existing URLs and rejects unknown search options', async () => {
    const page = await renderList(
      '/transfer-batches?query=旧备注&search_mode=typo&search_field=unknown&material_type=invalid',
    )
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: '旧备注',
        search_mode: 'contains',
        search_field: 'all',
        material_type: undefined,
      }),
    )
    expect(page.get('input[aria-label="搜索转料记录"]').attributes('placeholder')).toContain(
      '班组或转料人',
    )
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(page.vm.$route.query).toEqual({ query: '旧备注' })
  })

  it('applies explicit search choices to both scopes, resets the page and clears every filter on reset', async () => {
    const page = await renderList('/transfer-batches?query=AL%_&page=3&source_team_id=1')
    await choose(page, '搜索方式', 'prefix')
    expect(page.vm.$route.query.search_mode).toBe('prefix')
    await choose(page, '搜索字段', 'material_name')
    await choose(page, '筛选物料类型', 'sludge')
    const scope = {
      query: 'AL%_',
      search_mode: 'prefix',
      search_field: 'material_name',
      material_type: 'sludge',
      source_team_id: '1',
    }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, page: 1 }),
    )
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect(page.vm.$route.query).toMatchObject({
      query: 'AL%_',
      search_mode: 'prefix',
      search_field: 'material_name',
      material_type: 'sludge',
    })
    page.getComponent(FilterDialog).vm.$emit('reset')
    page.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith({
      query: undefined,
      search_mode: 'contains',
      search_field: 'all',
      material_type: undefined,
      source_team_id: undefined,
      next_team_id: undefined,
    })
    expect(page.vm.$route.query).toEqual({})
  })

  it('restores filters after route navigation without keeping stale fields or totals', async () => {
    const page = await renderList(
      '/transfer-batches?query=A&search_mode=exact&search_field=batch_no&material_type=finished',
    )
    await page.vm.$router.push(
      '/transfer-batches?query=B&search_mode=prefix&search_field=source_batch_no&material_type=waste&page=2',
    )
    await flushPromises()
    const scope = {
      query: 'B',
      search_mode: 'prefix',
      search_field: 'source_batch_no',
      material_type: 'waste',
    }
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...scope, page: 2 }),
    )
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(expect.objectContaining(scope))
    expect((page.get('input[aria-label="搜索转料记录"]').element as HTMLInputElement).value).toBe(
      'B',
    )
    await page.vm.$router.push('/transfer-batches?query=旧备注')
    await flushPromises()
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: '旧备注',
        search_mode: 'contains',
        search_field: 'all',
        material_type: undefined,
      }),
    )
  })

  it('keeps the existing table mounted while refreshing its data', async () => {
    const page = await renderList()
    const table = page.get('.el-table').element
    let finish!: (value: typeof result) => void
    vi.mocked(materialTransferApi.list).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )

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
    vi.mocked(materialTransferApi.counts).mockResolvedValueOnce({
      all: 28,
      pending: 11,
      received: 15,
      voided: 2,
      dispatched: 0,
    })

    page
      .getComponent(MaterialTransferDrawer)
      .vm.$emit('changed', { ...transfer, status: 'received', locked: true })
    await flushPromises()

    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'pending' }),
    )
    expect(page.text()).toContain('共 0 条')
    expect(page.text()).not.toContain('FLOW-001')
    expect(page.text()).toContain('暂无转料记录')
    expect(statusCount(page, 'pending')).toBe('11')
    expect(statusCount(page, 'received')).toBe('15')
  })

  it('keeps totals for all matching records when selecting a status, rather than counting the current page', async () => {
    const page = await renderList()
    expect(statusCount(page, 'all')).toBe('28')
    expect(statusCount(page, 'pending')).toBe('12')
    await choose(page, '转料状态', 'received')
    await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'received', page: 1 }),
    )
    expect(materialTransferApi.counts).toHaveBeenCalledTimes(1)
    expect(page.vm.$route.query.status).toBe('received')
    expect(statusCount(page, 'all')).toBe('28')
  })

  it('does not replace the current search totals with a late response for a previous search', async () => {
    const page = await renderList()
    type Counts = Awaited<ReturnType<typeof materialTransferApi.counts>>
    let finishOld!: (value: Counts) => void
    let finishNew!: (value: Counts) => void
    vi.mocked(materialTransferApi.counts)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishNew = resolve
        }),
      )
    await page.get('input[aria-label="搜索转料记录"]').setValue('OLD')
    await page.get('form').trigger('submit')
    await flushPromises()
    await page.get('input[aria-label="搜索转料记录"]').setValue('NEW')
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(materialTransferApi.counts).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'NEW' }),
    )
    finishNew({ all: 7, pending: 3, received: 4, voided: 0, dispatched: 0 })
    await flushPromises()
    finishOld({ all: 18, pending: 9, received: 7, voided: 2, dispatched: 0 })
    await flushPromises()
    expect(statusCount(page, 'all')).toBe('7')
    expect(statusCount(page, 'pending')).toBe('3')
  })
})

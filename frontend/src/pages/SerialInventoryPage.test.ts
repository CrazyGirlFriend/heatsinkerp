// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SerialInventoryPage from './SerialInventoryPage.vue'
import {
  serialInventoryApi as api,
  type GlobalInventory,
  type GlobalInventoryRow,
} from '@/services/serialInventoryApi'
import { warehouseFixture } from '@/testFixtures/teamInventory'
import TeamInventoryDetail from '@/components/TeamInventoryDetail.vue'
import FilterDialog from '@/components/FilterDialog.vue'
import AppSelect from '@/components/AppSelect.vue'
import { ElOption } from 'element-plus'
import TableExportButton from '@/components/TableExportButton.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import SerialIncomingInventory from '@/components/SerialIncomingInventory.vue'
import WatermelonFilter from '@/components/watermelon/WatermelonFilter.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return {
    useLiveRefresh: (refresh: () => Promise<void>) => {
      live.refresh = refresh
      return { message: ref('') }
    },
  }
})
let wrapper: VueWrapper | undefined
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})
const row: GlobalInventoryRow = {
  ...warehouseFixture({
    serial_no: '000012',
    on_hand_quantity: 48,
    on_hand_weight: 4.8,
    owned_quantity: 68,
    owned_weight: 6.8,
  }),
  team_id: 1,
  team_name: '库房',
  team_code: 'FACTORY-WAREHOUSE',
  stock_age_hours: 125,
  stock_age_started_at: '2026-10-30T20:00:00Z',
  stock_age_basis: 'received',
}
const response = (
  items: GlobalInventoryRow[] = [
    row,
    { ...row, group_id: 12, team_id: 2, team_name: '轧制', team_code: 'FACTORY-ROLL' },
  ],
): GlobalInventory => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
  as_of: '2026-11-05T01:00:00Z',
})
async function render(path = '/material-trace') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/material-trace', component: SerialInventoryPage }],
  })
  await router.push(path)
  wrapper = mount(SerialInventoryPage, {
    global: {
      plugins: [router],
      stubs: {
        PageBackButton: true,
        TeamInventoryDetail: true,
        InventoryPendingDialog: true,
        MaterialTransferDrawer: true,
        AppDialog: {
          props: ['modelValue'],
          template:
            '<div v-if="modelValue" class="test-dialog"><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
  await flushPromises()
  return { page: wrapper, router }
}

it('switches a serial with no on-hand stock to receiving-team pending batches', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response([]))
  const transfer = normalizeMaterialTransfer({
    id: 29,
    batch_no: 'TL-PENDING-29',
    serial_no: '861113-29',
    source_team: { id: 7, name: '电镀' },
    next_team: { id: 8, name: '检验' },
    status: 'pending',
    entry_kind: 'transfer',
    quantity: 800,
    weight: 12.5,
  })
  vi.spyOn(materialTransferApi, 'list').mockResolvedValue({
    items: [transfer],
    total: 1,
    page: 1,
    page_size: 20,
  })
  const { page, router } = await render(
    '/material-trace?serial_no=861113-29&stock_age_min=7&page=1',
  )
  expect(page.get('[aria-label="全厂库存明细"]').text()).not.toContain('800')
  page.getComponent(WatermelonFilter).vm.$emit('change', 'incoming')
  await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({
    view: 'incoming',
    serial_no: '861113-29',
  })
  expect(router.currentRoute.value.query).not.toHaveProperty('stock_age_min')
  expect(materialTransferApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      serial_no: '861113-29',
      internal_only: true,
      status: 'pending',
      page: 1,
    }),
  )
  expect(page.find('[aria-label="全厂库存明细"]').exists()).toBe(false)
  const table = page.get('[aria-label="全厂待签收明细"]')
  for (const value of ['电镀', '检验', '800', '12.5', '待签收数量', 'TL-PENDING-29'])
    expect(table.text()).toContain(value)
  await table
    .findAll('button')
    .find((button) => button.text() === '明细')!
    .trigger('click')
  expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({
    modelValue: true,
    transfer,
    showHistoryGroup: false,
  })
  vi.mocked(materialTransferApi.list).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  })
  page.getComponent(MaterialTransferDrawer).vm.$emit('changed', { ...transfer, status: 'received' })
  await flushPromises()
  expect(page.get('[aria-label="全厂待签收明细"]').text()).not.toContain('TL-PENDING-29')
  page.getComponent(WatermelonFilter).vm.$emit('change', 'stock')
  await flushPromises()
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({ serial_no: '861113-29', availability: 'current' }),
  )
  expect(page.findComponent(SerialIncomingInventory).exists()).toBe(false)
})

it('keeps receiving-team filters in pending pagination and export without loading stock', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response([]))
  vi.spyOn(materialTransferApi, 'list').mockResolvedValue({
    items: [normalizeMaterialTransfer({ id: 1, quantity: 30 })],
    total: 21,
    page: 1,
    page_size: 20,
  })
  const { page, router } = await render(
    '/material-trace?view=incoming&serial_no=000012&inventory_team_id=8&source_team_id=7',
  )
  expect(api.stock).not.toHaveBeenCalled()
  expect(page.find('[aria-label="滞留至少（天）"]').exists()).toBe(false)
  page.getComponent(WorkspacePagination).vm.$emit('change', 2, 10)
  await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({
    view: 'incoming',
    inventory_team_id: '8',
    page: '2',
    page_size: '10',
  })
  expect(materialTransferApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      next_team_id: '8',
      source_team_id: '7',
      serial_no: '000012',
      status: 'pending',
      internal_only: true,
      page: 2,
      page_size: 10,
    }),
  )
  const source = page.getComponent(TableExportButton).props('source')()!
  expect(source.title).toBe('全厂待签收明细')
  const filter = page.getComponent(FilterDialog)
  await filter.get('button').trigger('click')
  const receiver = page
    .findAllComponents(AppSelect)
    .find((select) => select.find('[aria-label="接收班组"]').exists())!
  receiver.vm.$emit('update:modelValue', '2')
  filter.vm.$emit('apply')
  await flushPromises()
  expect(materialTransferApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ next_team_id: '2', page: 1, status: 'pending' }),
  )
  vi.mocked(materialTransferApi.list).mockResolvedValueOnce({
    items: [normalizeMaterialTransfer({ id: 1, quantity: 30 })],
    total: 1,
    page: 1,
    page_size: 100,
  })
  const exported = await source.load(new AbortController().signal, () => {})
  expect(exported[0]).toMatchObject({ quantity: 30 })
  expect(materialTransferApi.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      next_team_id: '8',
      source_team_id: '7',
      serial_no: '000012',
      internal_only: true,
      status: 'pending',
      page: 1,
      page_size: 100,
    }),
  )
})

it('loads all teams immediately and opens the existing inventory detail for the selected team', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response())
  const { page } = await render()
  expect(api.stock).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, page_size: 20, serial_no: undefined, team_id: undefined }),
  )
  const table = page.get('[aria-label="全厂库存明细"]')
  expect(table.text()).toContain('库房')
  expect(table.text()).toContain('轧制')
  expect(table.text()).toContain('48')
  expect(table.findAll('thead th').map((cell) => cell.text())).not.toContain('重量（kg）')
  expect(table.text()).toContain('5天5小时')
  expect(table.find('[title^="从本班组接收起算"]').exists()).toBe(true)
  const buttons = table.findAll('button').filter((b) => b.text() === '明细')
  await buttons[1]!.trigger('click')
  expect(page.findComponent(TeamInventoryDetail).props()).toMatchObject({
    teamId: 2,
    group: { group_id: 12 },
    canWrite: false,
  })
})

it('uses receipt time for both processed and unprocessed stock', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(
    response([
      { ...row, processing_state: 'complete', stock_age_hours: 240 },
      { ...row, group_id: 12, processing_state: 'unregistered', stock_age_hours: 240 },
    ]),
  )
  const { page } = await render()
  const table = page.get('[aria-label="全厂库存明细"]')
  const ages = table.findAll('[title^="从本班组接收起算"]')
  expect(ages).toHaveLength(2)
  expect(ages.map((cell) => cell.text())).toEqual(['10天', '10天'])
  expect(table.find('[title*="完成登记起算"]').exists()).toBe(false)
})

it('combines team and residence filters, validates bounds and resets pagination', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response())
  const { page, router } = await render('/material-trace?page=3')
  useTeamDirectoryStore().items = [
    { id: '2', code: 'FACTORY-ROLL', name: '轧制', active: true, kind: 'production' },
  ]
  const filter = page.getComponent(FilterDialog)
  await filter.get('button').trigger('click')
  await page.get('input[aria-label="滞留至少（天）"]').setValue('7')
  await page.get('input[aria-label="滞留至多（天）"]').setValue('3')
  filter.vm.$emit('apply')
  await flushPromises()
  expect(page.text()).toContain('滞留时间下限不能大于上限')
  expect(api.stock).toHaveBeenCalledTimes(1)
  await page.get('input[aria-label="滞留至多（天）"]').setValue('14')
  const select = page
    .findAllComponents(AppSelect)
    .find((s) => s.find('[aria-label="所在班组"]').exists())!
  select.vm.$emit('update:modelValue', 2)
  filter.vm.$emit('apply')
  await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({
    inventory_team_id: '2',
    stock_age_min: '7',
    stock_age_max: '14',
    page: '1',
  })
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: 2, stock_age_min: 7, stock_age_max: 14, page: 1 }),
  )
  expect(page.text()).toContain('滞留 7～14天')
  await filter.get('button').trigger('click')
  filter.vm.$emit('reset')
  await flushPromises()
  filter.vm.$emit('apply')
  await flushPromises()
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      team_id: undefined,
      stock_age_min: undefined,
      stock_age_max: undefined,
    }),
  )
})

it('preserves exact serial deep links, pagination filters and unsubmitted search on refresh', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response())
  const { page } = await render('/material-trace?serial_no=000012&stock_age_min=3')
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({ serial_no: '000012', stock_age_min: 3 }),
  )
  page.getComponent(WorkspacePagination).vm.$emit('change', 2, 50)
  await flushPromises()
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({ serial_no: '000012', stock_age_min: 3, page: 2, page_size: 50 }),
  )
  await page.get('input[aria-label="搜索库存"]').setValue('NOT-SUBMITTED')
  vi.mocked(api.stock).mockRejectedValueOnce(new Error('offline'))
  await live.refresh()
  await flushPromises()
  expect(page.text()).toContain('库存更新失败')
  expect(page.text()).toContain('000012')
  expect(page.get('input[aria-label="搜索库存"]').element).toHaveProperty('value', 'NOT-SUBMITTED')
})

it('ignores stale searches and clearing a serial returns to the full list', async () => {
  let resolveOld!: (value: GlobalInventory) => void
  vi.spyOn(api, 'stock')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValue(response([{ ...row, serial_no: '000013' }]))
  const { page, router } = await render('/material-trace?serial_no=000012')
  await router.replace('/material-trace?serial_no=000013')
  await flushPromises()
  resolveOld(response())
  await flushPromises()
  expect(page.get('[aria-label="全厂库存明细"]').text()).toContain('000013')
  expect(page.get('[aria-label="全厂库存明细"]').text()).not.toContain('000012')
  await page.get('input[aria-label="搜索库存"]').setValue('')
  await page.get('form[role="search"]').trigger('submit')
  await flushPromises()
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({ serial_no: undefined, query: undefined }),
  )
})

it('keeps the full table and pagination for an empty filter result', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response([]))
  const { page } = await render('/material-trace?stock_age_min=365')
  expect(page.text()).toContain('暂无符合条件的库存')
  expect(page.findComponent(WorkspacePagination).props('total')).toBe(0)
  expect(page.find('[aria-label="全厂库存明细"]').exists()).toBe(true)
})

it('keeps quantity and processing state visible even when column choices hide everything', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(
    response([
      {
        ...row,
        team_code: 'FACTORY-GRIND',
        processing_state: 'unregistered',
        processing_unregistered_batch_count: 1,
      },
    ]),
  )
  const { page } = await render()
  page.getComponent({ name: 'InventoryColumnSettings' }).vm.$emit('change', [])
  await flushPromises()
  const table = page.get('[aria-label="全厂库存明细"]')
  expect(table.findAll('thead th').map((c) => c.text())).toEqual([
    '流水号',
    '所在班组',
    '数量（件）',
    '工艺工序',
    '返工情况',
    '加工状态',
    '操作',
  ])
  expect(table.text()).toContain('48')
  expect(table.text()).toContain('待加工')
})

it('combines property search with processing filters and clears pagination', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response())
  const { page, router } = await render('/material-trace?page=2')
  const filter = page.getComponent(FilterDialog)
  await filter.get('button').trigger('click')
  const select = (name: string) =>
    page.findAllComponents(AppSelect).find((s) => s.find(`[aria-label="${name}"]`).exists())!
  select('搜索属性').vm.$emit('update:modelValue', 'on_hand_quantity')
  await flushPromises()
  select('比较方式').vm.$emit('update:modelValue', 'gte')
  select('加工状态筛选').vm.$emit('update:modelValue', 'complete')
  await page.get('input[aria-label="搜索属性内容"]').setValue('40')
  filter.vm.$emit('apply')
  await flushPromises()
  expect(router.currentRoute.value.query.page).toBe('1')
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      search_field: 'on_hand_quantity',
      search_operator: 'gte',
      query: '40',
      processing_state: 'complete',
    }),
  )
})

it.each(['waste', 'sludge', 'scrap_chips'] as const)(
  'uses the same %s material filter, quantities and export as team inventory',
  async (material_type) => {
    vi.spyOn(api, 'stock').mockResolvedValue(
      response([
        {
          ...row,
          material_type,
          processing_state: 'complete',
          on_hand_quantity: material_type === 'waste' ? 12 : 0,
          on_hand_weight: 3.456,
        },
      ]),
    )
    const { page, router } = await render(
      '/material-trace?processing_state=complete&processing_role=produced&page=2',
    )
    page
      .getComponent({ name: 'InventoryColumnSettings' })
      .vm.$emit('change', [{ key: 'on_hand_weight', visible: true }])
    await flushPromises()
    const table = page.get('[aria-label="全厂库存明细"]')
    const labels = table.findAll('thead th').map((cell) => cell.text())
    const cells = table.get('tbody tr').findAll('td')
    expect(cells[labels.indexOf('数量（件）')]!.text()).toBe(material_type === 'waste' ? '12' : '—')
    expect(cells[labels.indexOf('重量（kg）')]!.text()).toBe('3.456')
    expect(cells[labels.indexOf('加工状态')]!.text()).toBe('—')
    const source = page.getComponent(TableExportButton).props('source')()!
    expect(
      source.fields.some((field) =>
        ['processing_role', 'scrap_quantity', 'scrap_weight'].includes(field.key),
      ),
    ).toBe(false)
    const exported = await source.load(new AbortController().signal, vi.fn())
    expect(exported[0]).toMatchObject({
      on_hand_quantity: material_type === 'waste' ? 12 : null,
      on_hand_weight: 3.456,
      processing_state: null,
    })
    const filter = page.getComponent(FilterDialog)
    await filter.get('button').trigger('click')
    const select = (name: string) =>
      page.findAllComponents(AppSelect).find((s) => s.find(`[aria-label="${name}"]`).exists())
    expect(
      select('物料类型')!
        .findAllComponents(ElOption)
        .map((option) => option.props('label')),
    ).toEqual(expect.arrayContaining(['成品', '半成品', '废料', '废泥', '废屑']))
    expect(select('加工分类筛选')).toBeUndefined()
    expect(
      select('加工状态筛选')!
        .findAllComponents(ElOption)
        .some((option) => option.props('value') === 'not_applicable'),
    ).toBe(false)
    select('物料类型')!.vm.$emit('update:modelValue', material_type)
    await flushPromises()
    expect(select('加工状态筛选')).toBeUndefined()
    filter.vm.$emit('apply')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ material_type, page: '1' })
    expect(router.currentRoute.value.query.processing_state).toBeUndefined()
    expect(router.currentRoute.value.query.processing_role).toBeUndefined()
  },
)

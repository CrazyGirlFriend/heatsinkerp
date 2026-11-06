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
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'

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
  ...warehouseFixture({ serial_no: '000012', owned_quantity: 48, owned_weight: 4.8 }),
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
  expect(table.text()).toContain('4.8')
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

it('explains the processing clock without calling it a receipt time', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(
    response([
      { ...row, stock_age_basis: 'processed', stock_age_hours: 6 },
      { ...row, group_id: 12, stock_age_basis: 'mixed' },
    ]),
  )
  const { page } = await render()
  const table = page.get('[aria-label="全厂库存明细"]')
  expect(table.find('[title^="从加工完成登记起算"]').text()).toBe('6小时')
  expect(table.find('[title*="当前行取最长滞留"]').exists()).toBe(true)
  expect(table.find('[title^="最早在库批次接收于"]').exists()).toBe(false)
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
    '库存件数',
    '库存重量 (kg)',
    '加工状态',
    '操作',
  ])
  expect(table.text()).toContain('48')
  expect(table.text()).toContain('未登记加工')
})

it('combines property search with processing filters and clears pagination', async () => {
  vi.spyOn(api, 'stock').mockResolvedValue(response())
  const { page, router } = await render('/material-trace?page=2')
  const filter = page.getComponent(FilterDialog)
  await filter.get('button').trigger('click')
  const select = (name: string) =>
    page.findAllComponents(AppSelect).find((s) => s.find(`[aria-label="${name}"]`).exists())!
  select('搜索属性').vm.$emit('update:modelValue', 'owned_quantity')
  await flushPromises()
  select('比较方式').vm.$emit('update:modelValue', 'gte')
  select('加工状态筛选').vm.$emit('update:modelValue', 'complete')
  await page.get('input[aria-label="搜索属性内容"]').setValue('40')
  filter.vm.$emit('apply')
  await flushPromises()
  expect(router.currentRoute.value.query.page).toBe('1')
  expect(api.stock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      search_field: 'owned_quantity',
      search_operator: 'gte',
      query: '40',
      processing_state: 'complete',
    }),
  )
})

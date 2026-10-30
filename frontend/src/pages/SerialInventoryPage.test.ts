// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import SerialInventoryPage from './SerialInventoryPage.vue'
import {
  serialInventoryApi as api,
  type SerialInventory,
  type SerialInventoryRow,
} from '@/services/serialInventoryApi'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'

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
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})
const row: SerialInventoryRow = {
  team_id: 1,
  team_name: '库房',
  material_name: '铜钼',
  material_type: 'semi_finished',
  shared_unallocated: false,
  stock_quantity: 48,
  stock_weight: 4.8,
  incoming_quantity: 10,
  incoming_weight: 1,
}
const response = (serial_no = '000012'): SerialInventory => ({
  serial_no,
  items: [
    row,
    {
      ...row,
      team_id: 2,
      team_name: '轧制',
      stock_quantity: 20,
      stock_weight: 2,
      incoming_quantity: 20,
      incoming_weight: 2,
    },
  ],
  untracked_count: 0,
  as_of: '2026-10-30T01:00:00Z',
})
async function render(path = '/material-trace?serial_no=000012') {
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
        MaterialTransferDrawer: true,
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue" class="test-dialog"><slot /></div>',
        },
      },
    },
  })
  await flushPromises()
  return { page: wrapper, router }
}

it('shows current stock by team with separate amounts, preserving the exact serial', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(response())
  const { page } = await render()
  expect(api.get).toHaveBeenCalledWith('000012')
  const table = page.get('table[aria-label="各班组库存"]')
  expect(table.findAll('tbody tr')).toHaveLength(2)
  expect(
    table
      .findAll('tbody tr')[0]!
      .findAll('td')
      .map((c) => c.text()),
  ).toEqual(['库房', '铜钼', '半成品', '48', '4.8', '10', '1', '批次明细'])
  expect(page.text()).not.toMatch(/全链路|交期|累计转出/)
  await page.get('input[aria-label="流水号"]').setValue('NOT-SUBMITTED')
  vi.mocked(api.get).mockResolvedValue({ ...response(), items: [{ ...row, stock_quantity: 38 }] })
  await live.refresh()
  await flushPromises()
  expect(table.text()).toContain('38')
  expect(page.get('input').element).toHaveProperty('value', 'NOT-SUBMITTED')
  expect(api.get).toHaveBeenLastCalledWith('000012')
})

it('keeps shared material separate and pages only the selected stock group', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    ...response(),
    items: [row, { ...row, shared_unallocated: true, stock_quantity: 1, stock_weight: 100 }],
  })
  vi.spyOn(api, 'batches').mockResolvedValue({
    items: [
      {
        id: 1,
        batch_no: 'TL-100',
        transfer_specification: '20×10',
        quantity: 1,
        weight: 100,
        rework_pending: true,
        rework_count: 0,
        inspection_hold_id: 7,
      },
    ],
    total: 25,
    page: 1,
    page_size: 20,
  })
  const { page } = await render()
  expect(page.get('table[aria-label="各班组库存"]').text()).not.toContain('100')
  await page.get('table[aria-label="共投待分料"] button').trigger('click')
  await flushPromises()
  expect(api.batches).toHaveBeenLastCalledWith(
    '000012',
    expect.objectContaining({ shared_unallocated: true, team_id: 1 }),
    'stock',
    1,
    20,
  )
  expect(page.get('table[aria-label="批次库存"]').text()).toContain('待返工')
  expect(page.get('table[aria-label="批次库存"]').text()).toContain('冻结')
  await page.get('table[aria-label="批次库存"] button').trigger('click')
  expect(page.findComponent(MaterialTransferDrawer).props()).toMatchObject({
    modelValue: true,
    batchNo: 'TL-100',
  })
  const pager = page.findComponent(ElPagination)
  pager.vm.$emit('update:current-page', 2)
  pager.vm.$emit('change', 2, 20)
  await flushPromises()
  expect(api.batches).toHaveBeenLastCalledWith('000012', expect.anything(), 'stock', 2, 20)
  await page.get('.inventory-tabs button:nth-child(2)').trigger('click')
  await flushPromises()
  expect(api.batches).toHaveBeenLastCalledWith('000012', expect.anything(), 'incoming', 1, 20)
})

it('does not allow an older lookup to overwrite a new serial', async () => {
  let resolveOld!: (value: SerialInventory) => void
  vi.spyOn(api, 'get')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValue(response('000013'))
  const { page, router } = await render()
  await router.replace('/material-trace?serial_no=000013')
  await flushPromises()
  resolveOld(response())
  await flushPromises()
  expect(page.get('.inventory-result-heading').text()).toContain('000013')
  expect(page.get('.inventory-result-heading').text()).not.toContain('000012')
  await router.replace('/material-trace')
  expect(page.find('table').exists()).toBe(false)
  expect(page.text()).toContain('输入流水号查询库存')
})

it('distinguishes no stock from an unknown serial and retains last data on a refresh failure', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...response(), items: [] })
  const { page } = await render()
  expect(page.text()).toContain('该流水号暂无在库或待签收物料')
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
  await live.refresh()
  await flushPromises()
  expect(page.text()).toContain('库存更新失败')
  expect(page.find('table').exists()).toBe(true)
  vi.mocked(api.get).mockRejectedValueOnce(new Error('未找到该流水号'))
  await page.get('input').setValue('UNKNOWN')
  await page.get('form').trigger('submit')
  await flushPromises()
  expect(page.text()).toContain('未找到该流水号')
  expect(page.find('table').exists()).toBe(false)
})

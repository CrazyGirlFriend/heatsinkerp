// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseManagement from './WarehouseManagement.vue'
import BatchSelectionBar from './BatchSelectionBar.vue'
import WatermelonFilter from './watermelon/WatermelonFilter.vue'
import WatermelonPagination from './watermelon/WatermelonPagination.vue'
import TableExportButton from './TableExportButton.vue'
import WarehousePlacementDialog from './WarehousePlacementDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'

import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const slot: WarehouseLocation = {
  id: 1,
  team_id: 1,
  name: 'A区-01',
  active: true,
  version: 3,
  status: 'available',
  has_stock: false,
  batches: [],
}
const batch = (id: number, quantity = 4, weight = 1): WarehouseLocation['batches'][number] => ({
  id,
  batch_no: `TL${id}`,
  serial_no: 'YS-007',
  material_name: '材料1',
  material_type: 'semi_finished',
  status: 'received',
  quantity,
  weight,
  available_quantity: quantity,
  available_weight: weight,
  received_at: '2026-10-09T00:30:00',
  created_at: '2026-10-08T00:00:00',
})
const occupied = (id: number, batches = [batch(id)]): WarehouseLocation => ({
  ...slot,
  id,
  name: `A-${id}`,
  status: 'occupied',
  has_stock: true,
  batches,
})
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(warehouseLocationApi, 'list').mockResolvedValue({
    items: [slot, { ...slot, id: 2, name: 'A区-02', status: 'locked', draft_locked: true }],
    total: 2,
    team_id: 1,
  })
  vi.spyOn(warehouseLocationApi, 'save').mockResolvedValue(slot)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function render(canManage = true, canDispatch = false) {
  wrapper = mount(WarehouseManagement, {
    props: { canManage, canDispatch },
    global: {
      stubs: {
        PageBackButton: true,
        WatermelonDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await flushPromises()
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
  await flushPromises()
}
async function open(name: string) {
  await wrapper
    .findAll('.warehouse-location-link')
    .find((card) => card.text() === name)!
    .trigger('click')
  await flushPromises()
}
async function nextPage() {
  wrapper.getComponent(WatermelonPagination).vm.$emit('current-change', 2)
  await flushPromises()
}

describe('warehouse management', () => {
  it('exports every filtered warehouse page with current states and excludes unsigned stock from totals', async () => {
    await render()
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    vi.mocked(warehouseLocationApi.list).mockImplementation(async (_query, page) => ({
      items:
        page === 1
          ? [occupied(1, [batch(1, 2, 0.000123), { ...batch(2, 100, 10), status: 'pending' }])]
          : [{ ...slot, draft_locked: true }],
      total: 2,
      team_id: 1,
    }))
    const rows = await source.load(new AbortController().signal, () => undefined)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ quantity: 2, weight: 0.000123, received: 1, pending: 1 })
    expect(rows[1]).toMatchObject({ status: '填写中', quantity: 0, weight: 0 })
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 2, 100, undefined)
  })
  it('omits selection for empty slots and resets to the first page when the page size changes', async () => {
    const items = Array.from({ length: 61 }, (_, index) => ({
      ...slot,
      id: index + 1,
      name: `A-${index + 1}`,
    }))
    vi.mocked(warehouseLocationApi.list).mockImplementation(
      async (_query, page = 1, size = 20) => ({
        items: items.slice((page - 1) * size, page * size),
        total: items.length,
        team_id: 1,
      }),
    )
    await render(true, true)
    expect(wrapper.get('.warehouse-table th').text()).toBe('仓位')
    expect(wrapper.find('[aria-label="选择本页未分配物料"]').exists()).toBe(false)
    expect(wrapper.get('.wm-pagination').text()).toContain('共 61 条')
    expect(wrapper.get('.wm-pagination').text()).toContain('第 1 / 4 页')
    await nextPage()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 2, 20, undefined)
    await wrapper.get('select[aria-label="每页条数"]').setValue('10')
    await flushPromises()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 10, undefined)
    expect(wrapper.get('.wm-pagination').text()).toContain('共 61 条')
    expect(wrapper.get('.wm-pagination').text()).toContain('第 1 / 7 页')
  })
  it('pages the warehouse table and keeps individual material details inside the popup', async () => {
    const items = Array.from({ length: 20 }, (_, index) => occupied(index + 1))
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items, total: 21, team_id: 1 })
    await render()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 20, undefined)
    expect(wrapper.findAll('.warehouse-location-link')).toHaveLength(20)
    expect(wrapper.get('.warehouse-table').text()).not.toContain('TL')
    expect(wrapper.get('.warehouse-table').text()).not.toContain('材料1')
    expect(wrapper.get('.warehouse-table').text()).toContain('YS-007')
    expect(wrapper.find('.warehouse-detail-totals').exists()).toBe(false)
    await open('A-1')
    expect(wrapper.get('.warehouse-detail-totals').text()).toContain('库存件数4')
    expect(wrapper.text()).toContain('YS-007')
    expect(wrapper.text()).toContain('2026-10-09 08:30')
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({
      items: [occupied(21)],
      total: 21,
      team_id: 1,
    })
    await nextPage()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 2, 20, undefined)
    expect(wrapper.findAll('.warehouse-location-link')).toHaveLength(1)
    expect(wrapper.find('.warehouse-detail-totals').exists()).toBe(false)
  })
  it('separates stock amounts from pending batches and distinguishes locked and disabled slots', async () => {
    const waiting = { ...batch(3, 20, 2), status: 'pending', received_at: null }
    const items = [
      occupied(1, [batch(1, 0, 1.234)]),
      { ...slot, id: 2, name: '待签收仓', status: 'locked' as const, batches: [waiting] },
      { ...occupied(3, [batch(2), waiting]), draft_locked: true },
      { ...slot, id: 4, name: '停用仓', active: false, status: 'disabled' as const },
    ]
    vi.mocked(warehouseLocationApi.list).mockResolvedValue({ items, total: 4, team_id: 1 })
    await render(true, true)
    const tableRows = wrapper.findAll('.warehouse-table .el-table__body tr')
    expect(tableRows[0]!.text()).toContain('1.234')
    expect(tableRows[0]!.text()).toContain('有料')
    expect(tableRows[1]!.text()).toContain('待签收')
    expect(tableRows[2]!.text()).toContain('填写中')
    expect(tableRows[3]!.text()).toContain('停用')
    expect(tableRows[1]!.findAll('td')[4]!.text()).toBe('0')
    expect(tableRows[1]!.findAll('td')[7]!.text()).toBe('1')
    await open('待签收仓')
    expect(wrapper.get('.warehouse-detail-tabs button[aria-pressed="true"]').text()).toBe(
      '待签收 1',
    )
    expect(wrapper.get('.warehouse-detail-totals').text()).toBe('库存件数0库存重量（kg）0')
    expect(wrapper.findComponent(BatchSelectionBar).exists()).toBe(false)
    expect(wrapper.text()).toContain('提交时间')
    expect(wrapper.text()).toContain('2026-10-08 08:00')
    await click('关闭')
    await open('A-3')
    expect(wrapper.get('.warehouse-detail-totals').text()).toBe('库存件数4库存重量（kg）1')
  })
  it('selects separate received batches across slots and pages, including weight-only stock', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({
      items: [
        occupied(11, [batch(11, 8, 1.28), batch(12, 0, 1.234), batch(13, 0, 0)]),
        { ...slot, id: 14, name: '空仓位' },
      ],
      total: 21,
      team_id: 1,
    })
    await render(true, true)
    await open('A-11')
    expect(
      wrapper.get('label[aria-label="选择批次 TL13"] input').attributes('disabled'),
    ).toBeDefined()
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true)
    await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props()).toMatchObject({
      count: 2,
      quantity: 8,
      weight: 2.514,
      allChecked: true,
    })
    await click('关闭')
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({
      items: [occupied(21, [batch(21, 2, 0.32)])],
      total: 21,
      team_id: 1,
    })
    await nextPage()
    await open('A-21')
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true)
    await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props('count')).toBe(3)
    await click('批量出库')
    expect(wrapper.emitted('batchDispatch')?.[0]).toEqual([[11, 12, 21]])
    await open('A-21')
    wrapper.getComponent(BatchSelectionBar).vm.$emit('clear')
    await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props('count')).toBe(0)
  })
  it('removes stock that left a refreshed slot and revokes controls when permissions change', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({
      items: [occupied(1)],
      total: 1,
      team_id: 1,
    })
    await render()
    await open('A-1')
    expect(wrapper.findComponent(BatchSelectionBar).exists()).toBe(false)
    await wrapper.setProps({ canDispatch: true })
    await open('A-1')
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true)
    await flushPromises()
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({
      items: [{ ...slot, name: 'A-1' }],
      total: 1,
      team_id: 1,
    })
    await wrapper.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(wrapper.findAll('button').some((button) => button.text().startsWith('批量出库'))).toBe(
      false,
    )
    await wrapper.setProps({ canManage: false })
    expect(wrapper.find('.warehouse-table').exists()).toBe(false)
    expect(wrapper.find('.warehouse-detail-totals').exists()).toBe(false)
  })
  it('queries all slots by status and search rather than filtering only the current page', async () => {
    await render()
    await nextPage()
    await wrapper.get('input[aria-label="搜索仓位"]').setValue(' 材料1 ')
    wrapper.getComponent(WatermelonFilter).vm.$emit('update:modelValue', 'pending')
    await flushPromises()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('材料1', 1, 20, 'pending')
    await click('重置')
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 20, undefined)
  })
  it('allows renaming an occupied slot, disables deactivation and offers batch shortcuts', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValue({
      items: [occupied(1, [batch(8)])],
      total: 1,
      team_id: 1,
    })
    await render(true, true)
    await open('A-1')
    await click('TL8')
    expect(wrapper.emitted('view')?.[0]).toEqual(['TL8'])
    await open('A-1')
    await click('转出')
    expect(wrapper.emitted('dispatch')?.[0]).toEqual(['TL8'])
    await open('A-1')
    await click('编辑仓位')
    expect(wrapper.get('button[aria-label="启用仓位"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[aria-label="仓位名称"]').setValue('A区-新名称')
    await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith(
      { name: 'A区-新名称', active: true, expected_version: 3 },
      1,
    )
  })
  it('creates a named slot and refreshes its catalog', async () => {
    await render()
    await click('新增仓位')
    await click('保存')
    expect(warehouseLocationApi.save).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="仓位名称"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    await wrapper.get('input[aria-label="仓位名称"]').setValue(' B区-03 ')
    await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith(
      { name: 'B区-03', active: true },
      undefined,
    )
    expect(warehouseLocationApi.list).toHaveBeenCalledTimes(2)
  })
  it('prevents editing a form-locked slot and passes the current version for a free slot', async () => {
    await render()
    await open('A区-02')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '编辑仓位')!
        .attributes('disabled'),
    ).toBeDefined()
    await click('关闭')
    await open('A区-01')
    await click('编辑仓位')
    vi.mocked(warehouseLocationApi.save).mockRejectedValueOnce(
      new Error('仓位已被修改，请刷新后重试'),
    )
    await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith(
      { name: slot.name, active: true, expected_version: 3 },
      1,
    )
    expect(wrapper.get('[role="alert"]').text()).toContain('仓位已被修改')
  })
  it('lists unassigned portions beside slots, selects each batch once, and opens placement from the row', async () => {
    const stock = {
      transfer: normalizeMaterialTransfer({
        id: 8,
        batch_no: 'TL8',
        serial_no: 'S8',
        material_type: 'semi_finished',
      }),
      available_quantity: 80,
      available_weight: 8,
      unassigned_quantity: 10,
      unassigned_weight: 1,
    } as StockBatch
    vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
      items: [stock],
      total: 1,
      page: 1,
      page_size: 20,
    })
    vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [slot] })
    vi.mocked(warehouseLocationApi.list).mockResolvedValue({
      items: [
        occupied(1, [
          { ...batch(8, 70, 7), serial_no: 'S8', available_quantity: 80, available_weight: 8 },
        ]),
        slot,
      ],
      total: 2,
      team_id: 1,
    })
    await render(true, true)
    await wrapper.setProps({ teamId: 1, refreshKey: 1 })
    await flushPromises()
    const tableRows = wrapper.findAll('.warehouse-table .el-table__body tr')
    expect(tableRows).toHaveLength(3)
    expect(tableRows[0]!.text()).toContain('S8未分配')
    expect(tableRows[0]!.findAll('td')[5]!.text()).toBe('10')
    expect(tableRows[1]!.text()).toContain('S8已分配')
    expect(tableRows[1]!.findAll('td')[5]!.text()).toBe('70')
    expect(wrapper.find('[aria-label="仓位视图"]').exists()).toBe(false)
    await wrapper.get('label[aria-label="选择本页未分配物料"] input').setValue(true)
    await click('批量出库（1）')
    expect(wrapper.emitted('batchDispatch')?.[0]).toEqual([[8]])
    await open('A-1')
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true)
    await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props()).toMatchObject({
      count: 1,
      quantity: 80,
      weight: 8,
    })
    await click('关闭')
    await click('安排仓位')
    expect(wrapper.getComponent(WarehousePlacementDialog).props('modelValue')).toEqual(stock)
    const loads = vi.mocked(teamMaterialApi.stock).mock.calls.length
    await wrapper.setProps({ refreshKey: 2 })
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenCalledTimes(loads)
    wrapper.getComponent(WarehousePlacementDialog).vm.$emit('update:modelValue', null)
    wrapper.getComponent(WarehousePlacementDialog).vm.$emit('changed')
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenCalledTimes(loads + 1)
  })
  it('keeps the scrap stock balance for unassigned batch dispatch', async () => {
    const stock = {
      transfer: normalizeMaterialTransfer({
        id: 18,
        batch_no: 'TL18',
        serial_no: 'S18',
        material_type: 'waste',
      }),
      available_quantity: 0,
      available_weight: 0,
      scrap_available_quantity: 3,
      scrap_available_weight: 0.5,
      unassigned_quantity: 3,
      unassigned_weight: 0.5,
    } as StockBatch
    vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
      items: [stock],
      total: 1,
      page: 1,
      page_size: 20,
    })
    await render(true, true)
    await wrapper.setProps({ teamId: 1, refreshKey: 1 })
    await flushPromises()
    const checkbox = wrapper.get('label[aria-label="选择未分配物料 TL18"] input')
    expect(checkbox.attributes('disabled')).toBeUndefined()
    await checkbox.setValue(true)
    await click('批量出库（1）')
    expect(wrapper.emitted('batchDispatch')?.[0]).toEqual([[18]])
  })
  it('does not request the catalog for an unrelated team account', async () => {
    await render(false)
    expect(warehouseLocationApi.list).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('仅库房账号和管理员可以设置仓位')
  })
})

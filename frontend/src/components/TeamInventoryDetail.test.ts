// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import TeamInventoryDetail from './TeamInventoryDetail.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { warehouseFixture } from '@/testFixtures/teamInventory'
import type { StockBatch } from '@/types/teamMaterials'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: { value: '' }, request: refresh } } }))
let wrapper: VueWrapper
const source = (id: number, quantity: number, dispatch_no: string | null = null): StockBatch => ({
  transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: '000128', status: 'received', dispatch_no }),
  received_quantity: 10, received_weight: 1, on_hand_quantity: quantity, on_hand_weight: quantity / 10,
  available_quantity: quantity, available_weight: quantity / 10,
  owned_quantity: quantity, owned_weight: quantity / 10,
} as StockBatch)
const movement = (id: number, status = 'pending') => normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: '000128',
  next_team: { id: id === 11 ? 1 : 2, name: id === 11 ? '库房' : '轧制' }, source_team: { id: 1, name: '库房' },
  entry_kind: id === 11 ? 'warehouse_receipt' : 'transfer', external_source: id === 11 ? '供应商 A' : null,
  source_transfer_id: id === 11 ? null : 11, source_transfer_batch_no: id === 11 ? null : 'TL11',
  quantity: id === 11 ? 100 : id === 21 ? 60 : 20, weight: id === 11 ? 10 : id === 21 ? 6 : 2, status,
  created_at: '2026-09-27T05:00:00Z', received_at: status === 'received' ? '2026-09-27T05:30:00Z' : null })
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'inventorySources').mockResolvedValue({ items: [source(11, 5), source(12, 0, 'CK20260917000001')], total: 21, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'inventoryMovements').mockResolvedValue({ items: [movement(11, 'received'), movement(21, 'received'), movement(22)], total: 3, page: 1, page_size: 10 })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canWrite = true, warehouse = true) {
  wrapper = mount(TeamInventoryDetail, { props: { teamId: 1, group: warehouseFixture(), canWrite, warehouse }, global: { stubs: {
    ElDialog: { name: 'ElDialog', props: { modelValue: Boolean, alignCenter: Boolean, appendToBody: Boolean }, template: '<div><slot/><slot name="footer"/></div>' }, LiveRefreshNotice: true, MaterialTransferDrawer: true, MaterialDispatchDrawer: true,
  } } }); await flushPromises()
}
describe('warehouse source detail', () => {
  it('separates stock, dispatchable, internal pending and external pending amounts', async () => {
    vi.mocked(teamMaterialApi.inventorySources).mockResolvedValue({ items: [{ ...source(11, 70), owned_quantity: 100, owned_weight: 10, in_transit_quantity: 20, in_transit_weight: 2, external_pending_quantity: 10, external_pending_weight: 1 }], total: 1, page: 1, page_size: 10 })
    await render()
    const table = wrapper.get('.warehouse-source-table')
    const headings = table.findAll('th').map(cell => cell.text())
    const cells = table.get('tbody tr').findAll('td')
    for (const [label, amount] of [['库存件数', '100'], ['库存重量 (kg)', '10'], ['可转出件数', '70'], ['可转出重量 (kg)', '7'], ['待签收件数', '20'], ['对外待确认件数', '10']]) {
      expect(cells[headings.indexOf(label!)]!.text()).toBe(amount)
    }
    expect(headings).not.toContain('归属件数')
  })
  it('shows inventory details in a centered dialog and keeps batch drilldown independent', async () => {
    await render(false)
    const dialog = wrapper.getComponent({ name: 'ElDialog' })
    expect(dialog.props()).toMatchObject({ modelValue: true, alignCenter: true, appendToBody: true })
    expect(dialog.classes()).toContain('material-detail-dialog')
    dialog.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
  it('shows independent receipt and outbound batch rows, including pending, and opens each original document', async () => {
    await render(false)
    const table = wrapper.get('.warehouse-movement-table')
    const cells = table.findAll('tbody tr').map(row => row.findAll('td').map(cell => cell.text()))
    expect(cells[0]?.slice(0, 7)).toEqual(['TL11', '入库', '—', '供应商 A', '100', '10', '已入库'])
    expect(cells[1]?.slice(0, 7)).toEqual(['TL21', '转出', 'TL11', '轧制', '60', '6', '已接收'])
    expect(cells[2]?.slice(0, 7)).toEqual(['TL22', '转出', 'TL11', '轧制', '20', '2', '待签收'])
    await table.findAll('button').find(button => button.text() === 'TL22')!.trigger('click')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('transfer')?.id).toBe(22)
    await table.findAll('button').find(button => button.text() === 'TL21')!.trigger('click')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('transfer')?.id).toBe(21)
    expect(teamMaterialApi.inventoryMovements).toHaveBeenLastCalledWith(1, 11, { page: 1, page_size: 10 })
  })
  it('paginates movement records independently and keeps old records on refresh failure', async () => {
    vi.mocked(teamMaterialApi.inventoryMovements).mockResolvedValue({ items: [movement(22)], total: 21, page: 1, page_size: 10 })
    await render(false)
    wrapper.findAllComponents(ElPagination)[1]!.vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.inventoryMovements).toHaveBeenLastCalledWith(1, 11, { page: 2, page_size: 10 })
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(1, 11, { page: 1, page_size: 10 })
    await wrapper.get('.warehouse-movement-table button').trigger('click')
    await wrapper.setProps({ group: warehouseFixture({ in_transit_quantity: 0 }) }); await flushPromises()
    expect(wrapper.findAllComponents(ElPagination)[1]!.props('currentPage')).toBe(2)
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(true)
    vi.mocked(teamMaterialApi.inventoryMovements).mockRejectedValueOnce(new Error('records offline'))
    await expect(live.refresh()).rejects.toThrow('records offline'); await flushPromises()
    expect(wrapper.get('.warehouse-movement-table').text()).toContain('TL22')
    await wrapper.setProps({ group: warehouseFixture({ group_id: 99 }) }); await flushPromises()
    expect(teamMaterialApi.inventoryMovements).toHaveBeenLastCalledWith(1, 99, { page: 1, page_size: 10 })
  })
  it('shows the upstream team on a workshop group and forwards losses from the actual batch', async () => {
    await render(true, false)
    await wrapper.setProps({ group: warehouseFixture({ receipt_source: 'internal', source_name: '轧制', source_team_id: 2, received_quantity: 130, received_weight: 130, dispatched_quantity: 20, dispatched_weight: 20, reserved_quantity: 30, reserved_weight: 30, in_transit_quantity: 30, in_transit_weight: 30, lost_quantity: 10, lost_weight: 10 }) }); await flushPromises()
    expect(wrapper.text()).toContain('上序班组')
    expect(wrapper.text()).toContain('轧制')
    expect(wrapper.text()).not.toContain('车间转入 ·')
    await wrapper.findAll('button').find(button => button.text() === '查看转出待确认批次')!.trigger('click')
    expect(wrapper.emitted('pending')).toEqual([[]])
    await wrapper.findAll('button').find(button => button.text() === '登记丢失')!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['loss', [source(11, 5)]]])
  })
  it('pages only the selected source group and shows exhausted history without allowing another outbound', async () => {
    await render()
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(1, 11, { page: 1, page_size: 10 })
    expect(wrapper.text()).toContain('外部来料 · 供应商 A')
    expect(wrapper.text()).toContain('含零库存')
    expect(wrapper.text()).not.toContain('累计收发')
    expect(wrapper.findAll('.warehouse-source-table tbody tr').map(row => row.findAll('td').slice(1, 3).map(cell => cell.text()))).toEqual([['5', '0.5'], ['0', '0']])
    const buttons = wrapper.findAll('button').filter(button => button.text() === '出库')
    expect(buttons[1]!.attributes('disabled')).toBeDefined()
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['dispatch', [source(11, 5)]]])
    wrapper.findAllComponents(ElPagination)[0]!.vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(1, 11, { page: 2, page_size: 10 })
    wrapper.findAllComponents(ElPagination)[0]!.vm.$emit('size-change', 20); await flushPromises()
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(1, 11, { page: 1, page_size: 20 })
  })
  it('opens original TL/CK documents while keeping read-only users from stock actions', async () => {
    await render(false)
    expect(wrapper.findAll('button').some(button => button.text() === '出库')).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === 'TL11')!.trigger('click')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('transfer')?.id).toBe(11)
    await wrapper.findAll('button').find(button => button.text() === 'TL12')!.trigger('click')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('transfer')?.id).toBe(12)
  })
  it('preserves the previous data on push refresh failure, and ignores responses after closing', async () => {
    await render()
    vi.mocked(teamMaterialApi.inventorySources).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow('offline'); await flushPromises()
    expect(wrapper.text()).toContain('TL11')
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.inventorySources>>) => void
    vi.mocked(teamMaterialApi.inventorySources).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const request = live.refresh()
    await wrapper.setProps({ group: null })
    finish({ items: [source(999, 10)], total: 1, page: 1, page_size: 10 }); await request; await flushPromises()
    expect(wrapper.text()).not.toContain('TL999')
  })
})

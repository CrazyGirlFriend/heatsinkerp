// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import WarehouseInventoryDetail from './WarehouseInventoryDetail.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { warehouseFixture } from '@/testFixtures/warehouseInventory'
import type { StockBatch } from '@/types/teamMaterials'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: { value: '' }, request: refresh } } }))
let wrapper: VueWrapper
const source = (id: number, quantity: number, dispatch_no: string | null = null): StockBatch => ({
  transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: '000128', status: 'received', dispatch_no }),
  received_quantity: 10, received_weight: 1, on_hand_quantity: quantity, on_hand_weight: quantity / 10,
  available_quantity: quantity, available_weight: quantity / 10,
} as StockBatch)
beforeEach(() => { vi.spyOn(teamMaterialApi, 'warehouseSources').mockResolvedValue({ items: [source(11, 5), source(12, 0, 'CK20260917000001')], total: 21, page: 1, page_size: 10 }) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canWrite = true) {
  wrapper = mount(WarehouseInventoryDetail, { props: { teamId: 1, group: warehouseFixture(), canWrite }, global: { stubs: {
    ElDrawer: { template: '<div><slot/><slot name="footer"/></div>' }, LiveRefreshNotice: true, MaterialTransferDrawer: true, MaterialDispatchDrawer: true,
  } } }); await flushPromises()
}
describe('warehouse source detail', () => {
  it('pages only the selected source group and shows exhausted history without allowing another outbound', async () => {
    await render()
    expect(teamMaterialApi.warehouseSources).toHaveBeenLastCalledWith(1, 11, { page: 1, page_size: 10 })
    expect(wrapper.text()).toContain('外部来料 · 供应商 A')
    expect(wrapper.text()).toContain('含已出完')
    const buttons = wrapper.findAll('button').filter(button => button.text() === '出库')
    expect(buttons[1]!.attributes('disabled')).toBeDefined()
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['dispatch', [source(11, 5)]]])
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.warehouseSources).toHaveBeenLastCalledWith(1, 11, { page: 2, page_size: 10 })
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20); await flushPromises()
    expect(teamMaterialApi.warehouseSources).toHaveBeenLastCalledWith(1, 11, { page: 1, page_size: 20 })
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
    vi.mocked(teamMaterialApi.warehouseSources).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow('offline'); await flushPromises()
    expect(wrapper.text()).toContain('TL11')
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.warehouseSources>>) => void
    vi.mocked(teamMaterialApi.warehouseSources).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const request = live.refresh()
    await wrapper.setProps({ group: null })
    finish({ items: [source(999, 10)], total: 1, page: 1, page_size: 10 }); await request; await flushPromises()
    expect(wrapper.text()).not.toContain('TL999')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseUnassigned from './WarehouseUnassigned.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const slot: WarehouseLocation = { id: 7, team_id: 1, name: 'B-02', active: true, version: 3, status: 'available', has_stock: false, batches: [] }
const row = { transfer: normalizeMaterialTransfer({ id: 8, batch_no: 'TL8', serial_no: 'S8', next_team: { id: 1, code: 'FACTORY-WAREHOUSE' }, material_type: 'semi_finished' }), available_quantity: 80, available_weight: 8, unassigned_quantity: 10, unassigned_weight: 1 } as StockBatch
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({ items: [row], total: 1, page: 1, page_size: 10 })
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [slot] })
  vi.spyOn(warehouseLocationApi, 'place').mockResolvedValue({ ...slot, status: 'occupied' })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canDispatch = true) {
  wrapper = mount(WarehouseUnassigned, { props: { teamId: 1, canDispatch }, global: { stubs: { ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function click(text: string) { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }

describe('unassigned warehouse stock', () => {
  it('assigns only the returned portion, not the full lot balance', async () => {
    await render(); expect(teamMaterialApi.stock).toHaveBeenCalledWith(1, expect.objectContaining({ location_status: 'unassigned', availability: 'all' }))
    await click('安排仓位'); await click('确认安排')
    expect(warehouseLocationApi.place).not.toHaveBeenCalled()
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 7); await flushPromises(); await click('确认安排')
    expect(warehouseLocationApi.place).toHaveBeenCalledWith(7, { source_transfer_id: 8, expected_version: 3, quantity: 10, weight: 1 })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  it('keeps the form after a concurrent location conflict', async () => {
    vi.mocked(warehouseLocationApi.place).mockRejectedValue(new Error('该仓位已被其他单据占用'))
    await render(false); expect(wrapper.text()).not.toContain('转出')
    await click('安排仓位'); wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 7); await flushPromises(); await click('确认安排')
    expect(wrapper.text()).toContain('该仓位已被其他单据占用')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
  it('refreshes on a stock push without overwriting an open placement form', async () => {
    await render(); await wrapper.setProps({ refreshKey: 1 }); await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenCalledTimes(2)
    await click('安排仓位'); await wrapper.setProps({ refreshKey: 2 }); await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenCalledTimes(2)
  })
})

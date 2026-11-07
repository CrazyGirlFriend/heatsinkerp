// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehousePlacementDialog from './WarehousePlacementDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const slot: WarehouseLocation = {
  id: 7,
  team_id: 1,
  name: 'B-02',
  active: true,
  version: 3,
  status: 'available',
  has_stock: false,
  draft_locked: false,
  batches: [],
}
const row = {
  transfer: normalizeMaterialTransfer({
    id: 8,
    batch_no: 'TL8',
    serial_no: 'S8',
    next_team: { id: 1, code: 'FACTORY-WAREHOUSE' },
    material_type: 'semi_finished',
  }),
  available_quantity: 80,
  available_weight: 8,
  unassigned_quantity: 10,
  unassigned_weight: 1,
} as StockBatch
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
    items: [row],
    total: 1,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [slot] })
  vi.spyOn(warehouseLocationApi, 'place').mockResolvedValue({ ...slot, status: 'occupied' })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(WarehousePlacementDialog, {
    props: { teamId: 1, modelValue: null },
    global: {
      stubs: {
        WatermelonDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await wrapper.setProps({ modelValue: row })
  await flushPromises()
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
  await flushPromises()
}

describe('unassigned warehouse stock', () => {
  it('assigns only the returned portion, not the full lot balance', async () => {
    await render()
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(7)
    expect(warehouseLocationApi.place).not.toHaveBeenCalled()
    await click('确认安排')
    expect(warehouseLocationApi.place).toHaveBeenCalledWith(7, {
      source_transfer_id: 8,
      expected_version: 3,
      quantity: 10,
      weight: 1,
    })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  it('keeps the form after a concurrent location conflict', async () => {
    vi.mocked(warehouseLocationApi.place).mockRejectedValue(new Error('该仓位已被其他单据占用'))
    await render()
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 7)
    await flushPromises()
    await click('确认安排')
    expect(wrapper.text()).toContain('该仓位已被其他单据占用')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
  it('shows the pending location lookup and prevents submitting before it finishes', async () => {
    let resolveSlots!: (value: { items: WarehouseLocation[] }) => void
    vi.mocked(teamMaterialApi.warehouseLocations).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlots = resolve)),
    )
    await render()
    const confirm = wrapper.findAll('button').find((button) => button.text() === '确认安排')!
    expect(wrapper.getComponent(ElSelect).props('loading')).toBe(true)
    expect(confirm.attributes('disabled')).toBeDefined()
    await confirm.trigger('click')
    expect(warehouseLocationApi.place).not.toHaveBeenCalled()
    resolveSlots({ items: [slot] })
    await flushPromises()
    expect(wrapper.getComponent(ElSelect).props('loading')).toBe(false)
    expect(confirm.attributes('disabled')).toBeUndefined()
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(7)
  })
  it('discards a late location lookup after changing batches', async () => {
    let resolveSlots!: (value: { items: WarehouseLocation[] }) => void
    vi.mocked(teamMaterialApi.warehouseLocations).mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlots = resolve)),
    )
    await render()
    await wrapper.setProps({
      modelValue: { ...row, transfer: { ...row.transfer, id: '9', serial_no: 'S9' } },
    })
    await flushPromises()
    resolveSlots({ items: [{ ...slot, id: 99 }] })
    await flushPromises()
    expect(wrapper.getComponent(ElSelect).props('modelValue')).toBe(7)
    expect(wrapper.text()).toContain('S9')
  })
})

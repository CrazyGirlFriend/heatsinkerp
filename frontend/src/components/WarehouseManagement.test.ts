// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseManagement from './WarehouseManagement.vue'
import BatchSelectionBar from './BatchSelectionBar.vue'
import { ElPagination } from 'element-plus'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const slot: WarehouseLocation = { id: 1, team_id: 1, name: 'A区-01', active: true, version: 3, status: 'available', has_stock: false, batches: [] }
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(warehouseLocationApi, 'list').mockResolvedValue({ items: [slot, { ...slot, id: 2, name: 'A区-02', status: 'locked', draft_locked: true }], total: 2, team_id: 1 })
  vi.spyOn(warehouseLocationApi, 'save').mockResolvedValue(slot)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canManage = true) {
  wrapper = mount(WarehouseManagement, { props: { canManage }, global: { stubs: { PageBackButton: true, ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function click(text: string) { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }

describe('warehouse management', () => {
  it('selects dispatchable batches across pages, includes weight-only stock and clears selection', async () => {
    const occupied = (id: number, quantity: number, weight: number): WarehouseLocation => ({ ...slot, id, name: `A-${id}`, status: 'occupied', has_stock: true,
      batches: [{ id, batch_no: `TL${id}`, serial_no: `S${id}`, status: 'received', quantity, weight, available_quantity: quantity, available_weight: weight }] })
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [occupied(11, 8, 1.28), occupied(12, 0, 1.234), occupied(13, 0, 0), { ...slot, id: 14, name: '空仓位' }], total: 21, team_id: 1 })
    await render(); await wrapper.setProps({ canDispatch: true })
    expect(wrapper.findAll('.el-table__expand-icon')).toHaveLength(0)
    expect(wrapper.get('label[aria-label="选择仓位 空仓位"] input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('label[aria-label="选择仓位 A-13"] input').attributes('disabled')).toBeDefined()
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true); await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props()).toMatchObject({ count: 2, quantity: 8, weight: 2.514, allChecked: true })
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [occupied(21, 2, 0.32)], total: 21, team_id: 1 })
    wrapper.getComponent(ElPagination).vm.$emit('update:current-page', 2)
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true); await flushPromises()
    await click('批量出库')
    expect(wrapper.emitted('batchDispatch')?.[0]).toEqual([[11, 12, 21]])
    wrapper.getComponent(BatchSelectionBar).vm.$emit('clear'); await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props('count')).toBe(0)
  })
  it('removes stock that left a refreshed slot and hides bulk controls without dispatch permission', async () => {
    const filled: WarehouseLocation = { ...slot, status: 'occupied', has_stock: true, batches: [{ id: 8, batch_no: 'TL8', serial_no: 'S8', status: 'received', quantity: 4, weight: 1, available_quantity: 4, available_weight: 1 }] }
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [filled], total: 1, team_id: 1 })
    await render(); expect(wrapper.findComponent(BatchSelectionBar).exists()).toBe(false)
    await wrapper.setProps({ canDispatch: true }); wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true); await flushPromises()
    await wrapper.setProps({ refreshKey: 1 }); await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props('count')).toBe(0)
    expect(wrapper.findAll('button').find(button => button.text() === '批量出库')!.attributes('disabled')).toBeDefined()
  })
  it('allows renaming an occupied slot but disables deactivation and offers material shortcuts', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValue({ items: [{ ...slot, status: 'occupied', has_stock: true, batches: [{ id: 8, batch_no: 'TL8', serial_no: 'S8', quantity: 4, weight: 1, available_quantity: 4, available_weight: 1, status: 'received' }] }], total: 1, team_id: 1 })
    await render(); await wrapper.setProps({ canDispatch: true })
    await click('查看物料'); expect(wrapper.emitted('view')?.[0]).toEqual(['TL8'])
    await click('转出'); expect(wrapper.emitted('dispatch')?.[0]).toEqual(['TL8'])
    await click('编辑')
    expect(wrapper.get('input[aria-label="启用仓位"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[aria-label="仓位名称"]').setValue('A区-新名称'); await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith({ name: 'A区-新名称', active: true, expected_version: 3 }, 1)
  })
  it('creates a named slot and refreshes its catalog', async () => {
    await render(); await click('新增仓位'); await click('保存')
    expect(warehouseLocationApi.save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写仓位名称')
    await wrapper.get('input[aria-label="仓位名称"]').setValue(' B区-03 ')
    await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith({ name: 'B区-03', active: true }, undefined)
    expect(warehouseLocationApi.list).toHaveBeenCalledTimes(2)
  })
  it('prevents editing a locked slot and passes the current version when editing a free slot', async () => {
    await render()
    const edits = wrapper.findAll('button').filter(button => button.text() === '编辑')
    expect(edits[1]!.attributes('disabled')).toBeDefined()
    await edits[0]!.trigger('click'); await flushPromises()
    vi.mocked(warehouseLocationApi.save).mockRejectedValueOnce(new Error('仓位已被修改，请刷新后重试'))
    await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith({ name: slot.name, active: true, expected_version: 3 }, 1)
    expect(wrapper.get('[role="alert"]').text()).toContain('仓位已被修改')
  })
  it('does not request the catalog for an unrelated team account', async () => {
    await render(false)
    expect(warehouseLocationApi.list).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('仅库房账号和管理员可以设置仓位')
  })
})

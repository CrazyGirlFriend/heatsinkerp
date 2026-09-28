// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseManagement from './WarehouseManagement.vue'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const slot: WarehouseLocation = { id: 1, team_id: 1, name: 'A区-01', active: true, version: 3, status: 'available', has_stock: false, batches: [] }
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(warehouseLocationApi, 'list').mockResolvedValue({ items: [slot, { ...slot, id: 2, name: 'A区-02', status: 'locked' }], total: 2, team_id: 1 })
  vi.spyOn(warehouseLocationApi, 'save').mockResolvedValue(slot)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canManage = true) {
  wrapper = mount(WarehouseManagement, { props: { canManage }, global: { stubs: { PageBackButton: true, ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function click(text: string) { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }

describe('warehouse management', () => {
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

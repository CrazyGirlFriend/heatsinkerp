// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseManagement from './WarehouseManagement.vue'
import BatchSelectionBar from './BatchSelectionBar.vue'
import FilterDialog from './FilterDialog.vue'
import TableExportButton from './TableExportButton.vue'
import { ElPagination, ElSelect } from 'element-plus'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
const slot: WarehouseLocation = { id: 1, team_id: 1, name: 'A区-01', active: true, version: 3, status: 'available', has_stock: false, batches: [] }
const batch = (id: number, quantity = 4, weight = 1): WarehouseLocation['batches'][number] => ({ id, batch_no: `TL${id}`, serial_no: 'YS-007', material_name: '材料1', material_type: 'semi_finished', status: 'received', quantity, weight, available_quantity: quantity, available_weight: weight, received_at: '2026-10-09T00:30:00', created_at: '2026-10-08T00:00:00' })
const occupied = (id: number, batches = [batch(id)]): WarehouseLocation => ({ ...slot, id, name: `A-${id}`, status: 'occupied', has_stock: true, batches })
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(warehouseLocationApi, 'list').mockResolvedValue({ items: [slot, { ...slot, id: 2, name: 'A区-02', status: 'locked', draft_locked: true }], total: 2, team_id: 1 })
  vi.spyOn(warehouseLocationApi, 'save').mockResolvedValue(slot)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function render(canManage = true, canDispatch = false) {
  wrapper = mount(WarehouseManagement, { props: { canManage, canDispatch }, global: { stubs: { PageBackButton: true, ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function click(text: string) { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
async function open(name: string) { await wrapper.findAll('.warehouse-slot').find(card => card.text() === name)!.trigger('click'); await flushPromises() }
async function nextPage() {
  wrapper.getComponent(ElPagination).vm.$emit('update:current-page', 2)
  wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
}

describe('warehouse management', () => {
  it('exports every filtered warehouse page with current states and excludes unsigned stock from totals', async () => {
    await render()
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    vi.mocked(warehouseLocationApi.list).mockImplementation(async (_query, page) => ({
      items: page === 1 ? [occupied(1, [batch(1, 2, .000123), { ...batch(2, 100, 10), status: 'pending' }])] : [{ ...slot, draft_locked: true }], total: 2, team_id: 1,
    }))
    const rows = await source.load(new AbortController().signal, () => undefined)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ quantity: 2, weight: .000123, received: 1, pending: 1 })
    expect(rows[1]).toMatchObject({ status: '填写中', quantity: 0, weight: 0 })
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 2, 100, undefined)
  })
  it('uses the initial capacity before measurement and keeps material details inside the popup', async () => {
    const items = Array.from({ length: 50 }, (_, index) => occupied(index + 1))
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items, total: 51, team_id: 1 })
    await render()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 50, undefined)
    expect(wrapper.findAll('.warehouse-slot')).toHaveLength(50)
    expect(wrapper.get('.warehouse-grid').text()).not.toContain('TL')
    expect(wrapper.get('.warehouse-grid').text()).not.toContain('材料1')
    expect(wrapper.find('.warehouse-detail-totals').exists()).toBe(false)
    await open('A-1')
    expect(wrapper.get('.warehouse-detail-totals').text()).toContain('库存件数4')
    expect(wrapper.text()).toContain('YS-007')
    expect(wrapper.text()).toContain('2026-10-09 08:30')
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [occupied(51)], total: 51, team_id: 1 })
    await nextPage()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 2, 50, undefined)
    expect(wrapper.findAll('.warehouse-slot')).toHaveLength(1)
    expect(wrapper.find('.warehouse-detail-totals').exists()).toBe(false)
  })
  it('fits pagination to the available grid and resets the page after a screen resize', async () => {
    let height = 600, columns = 10, notify = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe(element: Element) { if (element.classList.contains('warehouse-grid')) notify = this.callback }
      disconnect = disconnect
    })
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('warehouse-grid') ? height : clientHeight?.get?.call(this) || 0 })
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => element.classList.contains('warehouse-grid') ? { gridTemplateColumns: Array(columns).fill('100px').join(' '), rowGap: '12px', getPropertyValue: () => '70px' } as unknown as CSSStyleDeclaration : computedStyle(element))
    await render()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 70, undefined)
    await nextPage()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 2, 70, undefined)
    vi.useFakeTimers(); height = 320; columns = 4; notify()
    await vi.advanceTimersByTimeAsync(160); await flushPromises()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 16, undefined)
    expect(wrapper.getComponent(ElPagination).props('pageSize')).toBe(16)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })
  it('colors physical inventory and distinguishes pending, draft and disabled slots', async () => {
    const waiting = { ...batch(3, 20, 2), status: 'pending', received_at: null }
    const items = [occupied(1, [batch(1, 0, 1.234)]), { ...slot, id: 2, name: '待签收仓', status: 'locked' as const, batches: [waiting] }, { ...occupied(3, [batch(2), waiting]), draft_locked: true }, { ...slot, id: 4, name: '停用仓', active: false, status: 'disabled' as const }]
    vi.mocked(warehouseLocationApi.list).mockResolvedValue({ items, total: 4, team_id: 1 })
    await render(true, true)
    const cards = wrapper.findAll('.warehouse-slot')
    expect(cards[0]!.classes()).toContain('is-stocked')
    expect(cards[1]!.classes()).not.toContain('is-stocked')
    expect(cards[1]!.find('.pending').exists()).toBe(true)
    expect(cards[2]!.classes()).toContain('is-stocked')
    expect(cards[2]!.find('.pending').exists()).toBe(true)
    expect(cards[2]!.find('.draft').exists()).toBe(true)
    expect(cards[3]!.classes()).toContain('is-disabled')
    expect(cards[3]!.attributes('disabled')).toBeUndefined()
    await open('待签收仓')
    expect(wrapper.get('.warehouse-detail-tabs button[aria-pressed="true"]').text()).toBe('待签收 1')
    expect(wrapper.get('.warehouse-detail-totals').text()).toBe('库存件数0库存重量（kg）0')
    expect(wrapper.findComponent(BatchSelectionBar).exists()).toBe(false)
    expect(wrapper.text()).toContain('提交时间')
    expect(wrapper.text()).toContain('2026-10-08 08:00')
    await click('关闭'); await open('A-3')
    expect(wrapper.get('.warehouse-detail-totals').text()).toBe('库存件数4库存重量（kg）1')
  })
  it('selects separate received batches across slots and pages, including weight-only stock', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [occupied(11, [batch(11, 8, 1.28), batch(12, 0, 1.234), batch(13, 0, 0)]), { ...slot, id: 14, name: '空仓位' }], total: 51, team_id: 1 })
    await render(true, true); await open('A-11')
    expect(wrapper.get('label[aria-label="选择批次 TL13"] input').attributes('disabled')).toBeDefined()
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true); await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props()).toMatchObject({ count: 2, quantity: 8, weight: 2.514, allChecked: true })
    await click('关闭')
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [occupied(21, [batch(21, 2, 0.32)])], total: 51, team_id: 1 })
    await nextPage(); await open('A-21')
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true); await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props('count')).toBe(3)
    await click('批量出库')
    expect(wrapper.emitted('batchDispatch')?.[0]).toEqual([[11, 12, 21]])
    await open('A-21'); wrapper.getComponent(BatchSelectionBar).vm.$emit('clear'); await flushPromises()
    expect(wrapper.getComponent(BatchSelectionBar).props('count')).toBe(0)
  })
  it('removes stock that left a refreshed slot and revokes controls when permissions change', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [occupied(1)], total: 1, team_id: 1 })
    await render(); await open('A-1')
    expect(wrapper.findComponent(BatchSelectionBar).exists()).toBe(false)
    await wrapper.setProps({ canDispatch: true }); await open('A-1')
    wrapper.getComponent(BatchSelectionBar).vm.$emit('all', true); await flushPromises()
    vi.mocked(warehouseLocationApi.list).mockResolvedValueOnce({ items: [{ ...slot, name: 'A-1' }], total: 1, team_id: 1 })
    await wrapper.setProps({ refreshKey: 1 }); await flushPromises()
    expect(wrapper.findAll('button').some(button => button.text().startsWith('批量出库'))).toBe(false)
    await wrapper.setProps({ canManage: false })
    expect(wrapper.find('.warehouse-grid').exists()).toBe(false)
    expect(wrapper.find('.warehouse-detail-totals').exists()).toBe(false)
  })
  it('queries all slots by status and search rather than filtering only the current page', async () => {
    await render(); await nextPage()
    await wrapper.get('input[aria-label="搜索仓位"]').setValue(' 材料1 ')
    wrapper.getComponent(FilterDialog).vm.$emit('open'); wrapper.getComponent(FilterDialog).vm.$emit('update:modelValue', true); await flushPromises()
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'pending'); wrapper.getComponent(FilterDialog).vm.$emit('apply'); await flushPromises()
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('材料1', 1, 50, 'pending')
    await click('重置')
    expect(warehouseLocationApi.list).toHaveBeenLastCalledWith('', 1, 50, undefined)
  })
  it('allows renaming an occupied slot, disables deactivation and offers batch shortcuts', async () => {
    vi.mocked(warehouseLocationApi.list).mockResolvedValue({ items: [occupied(1, [batch(8)])], total: 1, team_id: 1 })
    await render(true, true); await open('A-1')
    await click('TL8'); expect(wrapper.emitted('view')?.[0]).toEqual(['TL8'])
    await open('A-1'); await click('转出'); expect(wrapper.emitted('dispatch')?.[0]).toEqual(['TL8'])
    await open('A-1'); await click('编辑仓位')
    expect(wrapper.get('input[aria-label="启用仓位"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[aria-label="仓位名称"]').setValue('A区-新名称'); await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith({ name: 'A区-新名称', active: true, expected_version: 3 }, 1)
  })
  it('creates a named slot and refreshes its catalog', async () => {
    await render(); await click('新增仓位'); await click('保存')
    expect(warehouseLocationApi.save).not.toHaveBeenCalled()
    expect(wrapper.get('input[aria-label="仓位名称"]').element.closest('.el-form-item')!.classList.contains('is-error')).toBe(true)
    await wrapper.get('input[aria-label="仓位名称"]').setValue(' B区-03 ')
    await click('保存')
    expect(warehouseLocationApi.save).toHaveBeenCalledWith({ name: 'B区-03', active: true }, undefined)
    expect(warehouseLocationApi.list).toHaveBeenCalledTimes(2)
  })
  it('prevents editing a form-locked slot and passes the current version for a free slot', async () => {
    await render(); await open('A区-02')
    expect(wrapper.findAll('button').find(button => button.text() === '编辑仓位')!.attributes('disabled')).toBeDefined()
    await click('关闭'); await open('A区-01'); await click('编辑仓位')
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

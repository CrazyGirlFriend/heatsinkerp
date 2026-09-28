// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import StockSourcePicker from './StockSourcePicker.vue'
import BatchSelectionBar from './BatchSelectionBar.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'
import { warehouseFixture } from '@/testFixtures/teamInventory'

const source = (id: number, quantity = 12): StockBatch => ({ transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: `S${id}`, material_name: '铜', status: 'received', next_team: { id: 914, name: '轧制' } }), available_quantity: quantity, available_weight: quantity / 10 } as StockBatch)
let wrapper: VueWrapper
const summary = () => ({ team_id: 914, totals: warehouseFixture({ on_hand_quantity: 0, on_hand_weight: 0, reserved_quantity: 6680, reserved_weight: 1304, in_transit_quantity: 6680, in_transit_weight: 1304 }), materials: [], pending_incoming: { quantity: 0, weight: 0, count: 0 }, legacy_received_count: 0 })
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({ items: [source(1), source(2)], total: 40, page: 1, page_size: 20 })
  vi.spyOn(teamMaterialApi, 'overview').mockResolvedValue(summary())
  vi.spyOn(teamMaterialApi, 'dispatches').mockResolvedValue({ items: [], total: 6, page: 1, page_size: 1 })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render() {
  wrapper = mount(StockSourcePicker, { props: { teamId: 914 }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
const nextButton = () => wrapper.findAll('button').find(button => button.text() === '下一步：填写出库')!
describe('stock selection for new outbound', () => {
  it('explains fully pending stock using unpaginated balances and provides an outbound link', async () => {
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
    await render()
    expect(wrapper.text()).toContain('当前库存已全部转出，等待下序签收')
    expect(wrapper.text()).toContain('共 6 批，6,680 件，1,304 kg，不能重复出库。')
    expect(teamMaterialApi.dispatches).toHaveBeenCalledWith(914, { status: 'pending', page: 1, page_size: 1 })
    expect(nextButton().attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(button => button.text() === '查看出库记录')!.trigger('click')
    expect(wrapper.emitted('outbound')).toHaveLength(1)
  })
  it.each([false, true])('labels external pending confirmation without calling it internal receipt (mixed=%s)', async mixed => {
    const data = summary()
    data.totals.external_pending_weight = 100
    data.totals.in_transit_quantity = 0; data.totals.in_transit_weight = mixed ? 1204 : 0
    vi.mocked(teamMaterialApi.overview).mockResolvedValue(data)
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
    await render()
    expect(wrapper.text()).toContain(mixed ? '等待下序签收或对外确认' : '等待对外确认')
  })
  it('does not confuse unmatched filters with the whole team having no dispatchable stock', async () => {
    await render()
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
    await wrapper.get('input[aria-label="出库库存搜索"]').setValue('不存在的流水号')
    await wrapper.get('input[aria-label="出库库存搜索"]').trigger('keyup.enter'); await flushPromises()
    expect(wrapper.text()).toContain('没有符合筛选条件的可出库物料')
    expect(wrapper.text()).not.toContain('全部转出')
    expect(teamMaterialApi.overview).not.toHaveBeenCalled()
  })
  it('does not label genuinely empty or unknown stock as fully pending', async () => {
    const data = summary(); data.totals.reserved_quantity = 0; data.totals.reserved_weight = 0
    vi.mocked(teamMaterialApi.overview).mockResolvedValue(data)
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
    await render()
    expect(wrapper.text()).not.toContain('全部转出')
    expect(teamMaterialApi.dispatches).not.toHaveBeenCalled()
    vi.mocked(teamMaterialApi.overview).mockResolvedValue({ ...summary(), totals: { ...summary().totals, on_hand_weight: null } })
    await wrapper.findAll('button').find(button => button.text() === '查询')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain('全部转出')
    expect(teamMaterialApi.dispatches).not.toHaveBeenCalled()
  })
  it('discards a late empty-state summary after switching teams', async () => {
    let finish!: (value: Awaited<ReturnType<typeof teamMaterialApi.overview>>) => void
    vi.mocked(teamMaterialApi.stock).mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 20 })
    vi.mocked(teamMaterialApi.overview).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await render()
    await wrapper.setProps({ teamId: 900 }); await flushPromises()
    finish(summary()); await flushPromises()
    expect(wrapper.text()).not.toContain('全部转出')
    expect(wrapper.text()).toContain('TL1')
    expect(teamMaterialApi.dispatches).not.toHaveBeenCalled()
  })
  it('separates material, nature, quantity and weight and preserves weight-only waste selection', async () => {
    const row = { ...source(1, 0), transfer: { ...source(1).transfer, material_type: 'sludge' as const }, scrap_available_quantity: 0, scrap_available_weight: 1.234 }
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: [row], total: 1, page: 1, page_size: 20 })
    await render()
    const headings = wrapper.findAll('thead th').map(cell => cell.text())
    const cells = wrapper.get('tbody tr').findAll('td')
    expect(cells[headings.indexOf('材质')]!.text()).toBe('铜')
    expect(cells[headings.indexOf('物料类型')]!.text()).toBe('废泥')
    expect(cells[headings.indexOf('可出库件数')]!.text()).toBe('0')
    expect(cells[headings.indexOf('可出库重量 (kg)')]!.text()).toBe('1.234')
    expect(wrapper.find('.material-amount').exists()).toBe(false)
    await wrapper.get('label[aria-label="选择出库 TL1"] input').setValue(true)
    expect(wrapper.getComponent(BatchSelectionBar).props()).toMatchObject({ count: 1, quantity: 0, weight: 1.234 })
    await nextButton().trigger('click')
    expect(wrapper.emitted('selected')?.[0]?.[0]).toEqual([row])
  })
  it('restricts a warehouse row to its group across filters and clears selection if the group changes', async () => {
    vi.spyOn(teamMaterialApi, 'inventorySources').mockResolvedValue({ items: [source(31)], total: 1, page: 1, page_size: 20 })
    wrapper = mount(StockSourcePicker, { props: { teamId: 901, groupId: 11, groupLabel: '000128 · 成品 · 车间转入 · 检验' }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
    await flushPromises()
    expect(teamMaterialApi.stock).not.toHaveBeenCalled()
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(901, 11, expect.objectContaining({ current_only: true }))
    await wrapper.get('label[aria-label="选择出库 TL31"] input').setValue(true)
    await wrapper.get('input[aria-label="出库库存搜索"]').setValue('000128'); await wrapper.get('input[aria-label="出库库存搜索"]').trigger('keyup.enter'); await flushPromises()
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(901, 11, expect.objectContaining({ query: '000128', current_only: true }))
    await wrapper.setProps({ groupId: 12 }); await flushPromises()
    expect(nextButton().attributes('disabled')).toBeDefined()
    expect(teamMaterialApi.inventorySources).toHaveBeenLastCalledWith(901, 12, expect.objectContaining({ page: 1 }))
  })
  it('loads only this team’s available stock, supports paging and retains cross-page selections', async () => {
    await render()
    expect(teamMaterialApi.stock).toHaveBeenCalledWith(914, { availability: 'dispatchable', query: undefined, page: 1, page_size: 20 })
    expect(nextButton().attributes('disabled')).toBeDefined()
    expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([20, 50, 100])
    await wrapper.get('label[aria-label="选择出库 TL1"] input').setValue(true)
    vi.mocked(teamMaterialApi.stock).mockResolvedValueOnce({ items: [source(21)], total: 40, page: 2, page_size: 20 })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    await wrapper.get('label[aria-label="选择出库 TL21"] input').setValue(true)
    await nextButton().trigger('click')
    expect((wrapper.emitted('selected')![0]![0] as StockBatch[]).map(row => row.transfer.id)).toEqual([1, 21])
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 50); await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(914, expect.objectContaining({ page: 1, page_size: 50 }))
  })
  it('searches within the team and excludes exhausted stock', async () => {
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: [source(1, 0), source(2)], total: 2, page: 1, page_size: 20 })
    await render()
    expect(wrapper.get('label[aria-label="选择出库 TL1"] input').attributes('disabled')).toBeDefined()
    await wrapper.get('input[aria-label="出库库存搜索"]').setValue(' 铜 ')
    await wrapper.get('input[aria-label="出库库存搜索"]').trigger('keyup.enter'); await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(914, expect.objectContaining({ query: '铜', availability: 'dispatchable', page: 1 }))
    await wrapper.get('label[aria-label="选择本页出库物料"] input').setValue(true)
    await nextButton().trigger('click')
    expect((wrapper.emitted('selected')![0]![0] as StockBatch[]).map(row => row.transfer.id)).toEqual([2])
  })
  it('shows read failures, prevents progression and allows retry', async () => {
    vi.mocked(teamMaterialApi.stock).mockRejectedValueOnce(new Error('库存暂不可用'))
    await render()
    expect(wrapper.text()).toContain('库存暂不可用')
    expect(nextButton().attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(button => button.text() === '重新加载')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('TL1')
  })
  it('limits a batch to 100 sources across pages and allows clearing selections', async () => {
    vi.mocked(teamMaterialApi.stock).mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => source(i + 1)), total: 101, page: 1, page_size: 100 })
    await render()
    await wrapper.get('label[aria-label="选择本页出库物料"] input').setValue(true)
    vi.mocked(teamMaterialApi.stock).mockResolvedValueOnce({ items: [source(101)], total: 101, page: 2, page_size: 100 })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(wrapper.get('label[aria-label="选择出库 TL101"] input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('已选 100 批')
    expect(wrapper.text()).toContain('最多 100 批')
    await wrapper.findAll('button').find(button => button.text() === '清空')!.trigger('click')
    expect(nextButton().attributes('disabled')).toBeDefined()
    expect(wrapper.get('label[aria-label="选择出库 TL101"] input').attributes('disabled')).toBeUndefined()
  })
  it('discards late data and selection when switching team', async () => {
    let finish!: (value: Awaited<ReturnType<typeof teamMaterialApi.stock>>) => void
    vi.mocked(teamMaterialApi.stock).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await render()
    await wrapper.setProps({ teamId: 900 }); await flushPromises()
    finish({ items: [source(999)], total: 1, page: 1, page_size: 20 }); await flushPromises()
    expect(wrapper.text()).not.toContain('TL999')
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(900, expect.any(Object))
    expect(nextButton().attributes('disabled')).toBeDefined()
  })
})

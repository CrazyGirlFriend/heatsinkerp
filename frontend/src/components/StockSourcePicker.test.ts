// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import StockSourcePicker from './StockSourcePicker.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'

const source = (id: number, quantity = 12): StockBatch => ({ transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: `S${id}`, material_name: '铜', status: 'received', next_team: { id: 914, name: '轧制' } }), available_quantity: quantity, available_weight: quantity / 10 } as StockBatch)
let wrapper: VueWrapper
beforeEach(() => { vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({ items: [source(1), source(2)], total: 40, page: 1, page_size: 20 }) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render() {
  wrapper = mount(StockSourcePicker, { props: { teamId: 914 }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
const nextButton = () => wrapper.findAll('button').find(button => button.text() === '下一步：填写出库')!
describe('stock selection for new outbound', () => {
  it('loads only this team’s available stock, supports paging and retains cross-page selections', async () => {
    await render()
    expect(teamMaterialApi.stock).toHaveBeenCalledWith(914, { availability: 'available', query: undefined, page: 1, page_size: 20 })
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
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(914, expect.objectContaining({ query: '铜', availability: 'available', page: 1 }))
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
    expect(wrapper.text()).toContain('已选 100 / 100 批')
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

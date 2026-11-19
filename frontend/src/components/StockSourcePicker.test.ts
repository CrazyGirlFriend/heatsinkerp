// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import StockSourcePicker from './StockSourcePicker.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'
import { warehouseFixture } from '@/testFixtures/teamInventory'

const source = (id: number, quantity = 12): StockBatch =>
  ({
    transfer: normalizeMaterialTransfer({
      id,
      batch_no: `TL${id}`,
      serial_no: `S${id}`,
      material_name: '铜',
      status: 'received',
      next_team: { id: 914, name: '轧制' },
    }),
    available_quantity: quantity,
    available_weight: quantity / 10,
  }) as StockBatch
let wrapper: VueWrapper
const summary = () => ({
  team_id: 914,
  totals: warehouseFixture({
    on_hand_quantity: 0,
    on_hand_weight: 0,
    reserved_quantity: 6680,
    reserved_weight: 1304,
    in_transit_quantity: 6680,
    in_transit_weight: 1304,
  }),
  materials: [],
  pending_incoming: { quantity: 0, weight: 0, count: 0 },
  legacy_received_count: 0,
})
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
    items: [source(1), source(2)],
    total: 40,
    page: 1,
    page_size: 20,
  })
  vi.spyOn(teamMaterialApi, 'overview').mockResolvedValue(summary())
  vi.spyOn(teamMaterialApi, 'dispatches').mockResolvedValue({
    items: [],
    total: 6,
    page: 1,
    page_size: 1,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(StockSourcePicker, {
    props: { teamId: 914, mode: 'loss' },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
}
describe('stock selection for record actions', () => {
  it('selects one available source for loss registration without outbound controls', async () => {
    const held = { ...source(2), inspection_hold_id: 9 }
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [source(1), held],
      total: 2,
      page: 1,
      page_size: 20,
    })
    await render()
    await wrapper.setProps({ mode: 'loss' })
    expect(wrapper.find('thead input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('填写出库')
    expect(wrapper.find('[aria-label="丢失库存搜索"]').exists()).toBe(true)
    expect(wrapper.get('button[aria-label="登记丢失 TL2"]').attributes('disabled')).toBeDefined()
    await wrapper.get('button[aria-label="登记丢失 TL1"]').trigger('click')
    expect(wrapper.emitted('selected')).toEqual([[source(1)]])
  })
  it('selects a single batch for reallocation without outbound controls or allowing shared stock', async () => {
    const normal = source(1)
    const shared = { ...source(2), transfer: { ...source(2).transfer, shared_unallocated: true } }
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [normal, shared],
      total: 2,
      page: 1,
      page_size: 20,
    })
    await render()
    await wrapper.setProps({ mode: 'reallocate' })
    expect(wrapper.find('thead input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('下一步：填写出库')
    expect(wrapper.get('button[aria-label="转投 TL2"]').attributes('disabled')).toBeDefined()
    await wrapper.get('button[aria-label="转投 TL1"]').trigger('click')
    expect(wrapper.emitted('selected')).toEqual([[normal]])
  })
  it('only selects eligible inspection stock for a summary shipment', async () => {
    const normal = source(1)
    const scrap = {
      ...source(2),
      transfer: { ...source(2).transfer, material_type: 'sludge' as const },
      scrap_available_quantity: 0,
      scrap_available_weight: 2,
    }
    const shared = { ...source(3), transfer: { ...source(3).transfer, shared_unallocated: true } }
    const held = { ...source(4), inspection_hold_id: 9 }
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [normal, scrap, shared, held],
      total: 4,
      page: 1,
      page_size: 20,
    })
    await render()
    await wrapper.setProps({ mode: 'shipment' })
    for (const id of [2, 3, 4]) {
      expect(wrapper.get(`button[aria-label="选择 TL${id}"]`).attributes('disabled')).toBeDefined()
    }
    await wrapper.get('button[aria-label="选择 TL1"]').trigger('click')
    expect(wrapper.emitted('selected')).toEqual([[normal]])
  })
  it('shows processing role and current dimensions before choosing a physical child batch', async () => {
    const row = {
      ...source(1, 2),
      current_specification: '100 × 80 × 5 mm',
      processing_role: 'remaining' as const,
      transfer: {
        ...source(1, 2).transfer,
        entry_kind: 'processing_output' as const,
        transfer_specification: 'old',
        material_type: 'semi_finished' as const,
      },
    }
    const child = {
      ...source(2),
      transfer: {
        ...source(2).transfer,
        material_type: 'semi_finished' as const,
        processing_role: 'produced' as const,
      },
    }
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [row, child, source(3)],
      total: 3,
      page: 1,
      page_size: 20,
    })
    await render()
    await wrapper.setProps({ processing: true })
    const headings = wrapper.findAll('thead th').map((cell) => cell.text())
    const column = (label: string) =>
      wrapper.findAll('tbody tr').map((item) => item.findAll('td')[headings.indexOf(label)]!.text())
    expect(column('物料类型').slice(0, 2)).toEqual(['半成品', '半成品'])
    expect(column('加工分类')).toEqual(['未加工余料', '加工产出', '—'])
    expect(wrapper.get('tbody tr').text()).toContain('未加工余料')
    expect(wrapper.get('tbody tr').text()).toContain('100 × 80 × 5 mm')
    expect(wrapper.get('tbody tr').text()).not.toContain('old')
  })
  it.each(['shipment', 'reallocate'] as const)(
    'hides historical processing classification in non-processing teams during %s selection',
    async (mode) => {
      const row = {
        ...source(1),
        current_specification: '100 × 80 × 5 mm',
        processing_role: 'remaining' as const,
        transfer: {
          ...source(1).transfer,
          entry_kind: 'processing_output' as const,
          processing_role: 'remaining' as const,
        },
      }
      vi.mocked(teamMaterialApi.stock).mockResolvedValue({
        items: [row],
        total: 1,
        page: 1,
        page_size: 20,
      })
      await render()
      await wrapper.setProps({ mode })
      expect(wrapper.findAll('thead th').map((cell) => cell.text())).not.toContain('加工分类')
      expect(wrapper.get('tbody tr').text()).not.toContain('未加工余料')
      expect(wrapper.get('tbody tr').text()).toContain('100 × 80 × 5 mm')
      expect(wrapper.get('tbody tr').text()).toContain(row.transfer.batch_no)
    },
  )
  it('shows no signed source batch when the team has no historical receipts', async () => {
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    })
    await render()
    expect(wrapper.text()).toContain('暂无已签收来源批次')
    expect(wrapper.find('button[aria-label^="登记丢失 TL"]').exists()).toBe(false)
    expect(teamMaterialApi.overview).not.toHaveBeenCalled()
  })
  it('does not confuse unmatched filters with the whole team having no dispatchable stock', async () => {
    await render()
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    })
    await wrapper.get('input[aria-label="丢失库存搜索"]').setValue('不存在的流水号')
    await wrapper.get('input[aria-label="丢失库存搜索"]').trigger('keyup.enter')
    await flushPromises()
    expect(wrapper.text()).toContain('没有符合筛选条件的来源批次')
    expect(wrapper.text()).not.toContain('全部转出')
    expect(teamMaterialApi.overview).not.toHaveBeenCalled()
  })
  it('does not label genuinely empty or unknown stock as fully pending', async () => {
    const data = summary()
    data.totals.reserved_quantity = 0
    data.totals.reserved_weight = 0
    vi.mocked(teamMaterialApi.overview).mockResolvedValue(data)
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    })
    await render()
    expect(wrapper.text()).not.toContain('全部转出')
    expect(teamMaterialApi.dispatches).not.toHaveBeenCalled()
    vi.mocked(teamMaterialApi.overview).mockResolvedValue({
      ...summary(),
      totals: { ...summary().totals, on_hand_weight: null },
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查询')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('全部转出')
    expect(teamMaterialApi.dispatches).not.toHaveBeenCalled()
  })
  it('separates material, nature, quantity and weight and preserves weight-only waste selection', async () => {
    const row = {
      ...source(1, 0),
      transfer: { ...source(1).transfer, material_type: 'sludge' as const },
      scrap_available_quantity: 0,
      scrap_available_weight: 1.234,
    }
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [row],
      total: 1,
      page: 1,
      page_size: 20,
    })
    await render()
    const headings = wrapper.findAll('thead th').map((cell) => cell.text())
    const cells = wrapper.get('tbody tr').findAll('td')
    expect(cells[headings.indexOf('材质')]!.text()).toBe('铜')
    expect(cells[headings.indexOf('物料类型')]!.text()).toBe('废泥')
    expect(cells[headings.indexOf('账面件数')]!.text()).toBe('0')
    expect(cells[headings.indexOf('账面重量 (kg)')]!.text()).toBe('1.234')
    expect(wrapper.find('.material-amount').exists()).toBe(false)
    await wrapper.get('button[aria-label="登记丢失 TL1"]').trigger('click')
    expect(wrapper.emitted('selected')).toEqual([[row]])
  })
  it('paginates available stock and selects the batch on the requested page', async () => {
    await render()
    expect(teamMaterialApi.stock).toHaveBeenCalledWith(
      914,
      expect.objectContaining({ availability: 'dispatchable', page: 1, page_size: 20 }),
    )
    expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([20, 50, 100])
    vi.mocked(teamMaterialApi.stock).mockResolvedValueOnce({
      items: [source(21)],
      total: 40,
      page: 2,
      page_size: 20,
    })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.get('button[aria-label="登记丢失 TL21"]').trigger('click')
    expect(wrapper.emitted('selected')).toEqual([[source(21)]])
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 50)
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ page: 1, page_size: 50 }),
    )
  })
  it('searches within the team and includes exhausted source batches', async () => {
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({
      items: [source(1, 0), source(2)],
      total: 2,
      page: 1,
      page_size: 20,
    })
    await render()
    expect(wrapper.get('button[aria-label="登记丢失 TL1"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('input[aria-label="丢失库存搜索"]').setValue(' 铜 ')
    await wrapper.get('input[aria-label="丢失库存搜索"]').trigger('keyup.enter')
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(
      914,
      expect.objectContaining({ query: '铜', availability: 'dispatchable', page: 1 }),
    )
    await wrapper.get('button[aria-label="登记丢失 TL2"]').trigger('click')
    expect(wrapper.emitted('selected')).toEqual([[source(2)]])
  })
  it('shows read failures, prevents progression and allows retry', async () => {
    vi.mocked(teamMaterialApi.stock).mockRejectedValueOnce(new Error('库存暂不可用'))
    await render()
    expect(wrapper.text()).toContain('库存暂不可用')
    expect(wrapper.find('button[aria-label^="登记丢失 TL"]').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重新加载')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('TL1')
  })
  it('discards late data and selection when switching team', async () => {
    let finish!: (value: Awaited<ReturnType<typeof teamMaterialApi.stock>>) => void
    vi.mocked(teamMaterialApi.stock).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await wrapper.setProps({ teamId: 900 })
    await flushPromises()
    finish({ items: [source(999)], total: 1, page: 1, page_size: 20 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('TL999')
    expect(teamMaterialApi.stock).toHaveBeenLastCalledWith(900, expect.any(Object))
    expect(wrapper.emitted('selected')).toBeUndefined()
  })
})

it('explains inspection holds and selects only unaffected lots', async () => {
  vi.mocked(teamMaterialApi.stock).mockResolvedValue({
    items: [{ ...source(1), inspection_hold_id: 13 }, source(2)],
    total: 2,
    page: 1,
    page_size: 20,
  })
  await render()
  expect(wrapper.text()).toContain('待处理 · 禁止转出')
  expect(wrapper.get('button[aria-label="登记丢失 TL1"]').attributes('disabled')).toBeDefined()
  await wrapper.get('button[aria-label="登记丢失 TL2"]').trigger('click')
  expect(wrapper.emitted('selected')).toEqual([[source(2)]])
})

it('distinguishes schedule batches of the same serial before choosing a batch', async () => {
  const items = [2, 1, null].map((batch, index) => ({
    ...source(index + 1),
    transfer: { ...source(index + 1).transfer, serial_no: '691236-50', task_batch_number: batch },
  }))
  vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items, total: 3, page: 1, page_size: 20 })
  await render()
  const rows = wrapper.findAll('tbody tr')
  expect(rows.map((row) => row.findAll('td')[1]!.text())).toEqual(['第2批', '第1批', '未关联排期'])
  await wrapper.get('button[aria-label="登记丢失 TL2"]').trigger('click')
  expect(wrapper.emitted('selected')).toEqual([[items[1]]])
})

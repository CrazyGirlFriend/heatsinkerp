// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import MaterialAmount from './MaterialAmount.vue'
import { ElPagination } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { serialFixture } from '@/testFixtures/materialAnalytics'
import { formatDateTime } from '@/utils/format'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { StockBatch } from '@/types/teamMaterials'
const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})

afterEach(() => vi.restoreAllMocks())

it('supports source-batch dispatch and loss only for writable available inventory', async () => {
  const source = (id: number, quantity = 10): StockBatch => ({ transfer: normalizeMaterialTransfer({ id, batch_no: `TL-${id}`, serial_no: 'SERIAL-DETAIL', status: 'received' }), available_quantity: quantity, available_weight: 0, on_hand_quantity: quantity, on_hand_weight: 0, reserved_quantity: 0, reserved_weight: 0, lost_quantity: 0, lost_weight: 0, received_quantity: quantity, received_weight: 0, dispatched_quantity: 0, dispatched_weight: 0, in_transit_quantity: 0, in_transit_weight: 0 })
  const rows = [source(1), source(2), source(3, 0)]
  vi.spyOn(teamMaterialApi, 'serials').mockResolvedValue({ items: [serialFixture('SERIAL-DETAIL')], total: 1, page: 1, page_size: 1 })
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({ items: rows, total: 3, page: 1, page_size: 10 })
  const wrapper = mount(SerialMaterialDrawer, { props: { modelValue: true, teamId: 914, serialNo: 'SERIAL-DETAIL', canWrite: false }, global: { stubs: { ElDrawer: { template: '<section><slot/><slot name="footer"/></section>' }, MaterialTransferDrawer: true, MaterialDispatchDrawer: true } } })
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  try {
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenCalledWith(914, expect.objectContaining({ serial_no: 'SERIAL-DETAIL', availability: 'all' }))
    expect(wrapper.find('.serial-stock-actions').exists()).toBe(false)
    expect(wrapper.find('input[type=checkbox]').exists()).toBe(false)
    await wrapper.setProps({ canWrite: true }); await flushPromises()
    expect(wrapper.get('label[aria-label="选择 TL-3"] input').attributes('disabled')).toBeDefined()
    await wrapper.get('label[aria-label="选择本页可用批次"] input').setValue(true)
    await button('批量出库').trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['dispatch', rows.slice(0, 2)])
    await button('登记丢失').trigger('click')
    expect(wrapper.emitted('action')?.[1]).toEqual(['loss', [rows[0]]])
    vi.mocked(teamMaterialApi.stock).mockResolvedValue({ items: rows.map(row => ({ ...row, available_quantity: 0 })), total: 3, page: 1, page_size: 10 })
    await live.refresh(); await flushPromises()
    expect(button('批量出库').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.serial-stock-actions').text()).toContain('已选 0')
    await wrapper.setProps({ canWrite: false })
    expect(wrapper.find('.serial-stock-actions').exists()).toBe(false)
  } finally { wrapper.unmount() }
})

it('keeps the three secondary ledger fields accessible in serial detail', async () => {
  const summary = serialFixture('SERIAL-DETAIL')
  vi.spyOn(teamMaterialApi, 'serials').mockResolvedValue({ items: [summary], total: 1, page: 1, page_size: 1 })
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  const wrapper = mount(SerialMaterialDrawer, { props: { modelValue: false, teamId: 914, serialNo: summary.serial_no }, global: { stubs: { ElDrawer: { props: ['modelValue'], template: '<section v-if="modelValue"><slot name="header"/><slot/><slot name="footer"/></section>' }, ElTabs: true, ElTable: true, ElPagination: true, MaterialTransferDrawer: true, MaterialDispatchDrawer: true } } })
  try {
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(teamMaterialApi.stock).toHaveBeenCalledWith(914, expect.objectContaining({ page_size: 10 }))
    expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10, 20, 50, 100])
    const fields = wrapper.get('.el-descriptions')
    expect(fields.text()).toContain('待接收')
    expect(fields.text()).toContain('转出待确认')
    expect(fields.findAllComponents(MaterialAmount).map((item: VueWrapper) => item.props())).toMatchObject([
      { quantity: summary.pending_incoming_quantity, weight: summary.pending_incoming_weight },
      { quantity: summary.pending_outgoing_quantity, weight: summary.pending_outgoing_weight },
    ])
    expect(fields.text()).toContain('最近更新')
    expect(fields.text()).toContain(formatDateTime(summary.last_activity_at))
    const table = wrapper.getComponent({ name: 'ElTable' }).element
    vi.mocked(teamMaterialApi.serials).mockResolvedValue({ items: [{ ...summary, on_hand_quantity: 55 }], total: 1, page: 1, page_size: 1 })
    await live.refresh(); await flushPromises()
    expect(wrapper.getComponent({ name: 'ElTable' }).element).toBe(table)
    expect(wrapper.get('.serial-balances').text()).toContain('55')
    vi.mocked(teamMaterialApi.stock).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    await flushPromises(); expect(wrapper.getComponent({ name: 'ElTable' }).element).toBe(table)
  } finally { wrapper.unmount() }
})

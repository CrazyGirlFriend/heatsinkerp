// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import MaterialAmount from './MaterialAmount.vue'
import { ElPagination } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { serialFixture } from '@/testFixtures/materialAnalytics'
import { formatDateTime } from '@/utils/format'
const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})

afterEach(() => vi.restoreAllMocks())

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

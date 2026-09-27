// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import InventoryPendingDialog from './InventoryPendingDialog.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { warehouseFixture } from '@/testFixtures/teamInventory'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: { value: '' }, request: refresh } } }))
let wrapper: VueWrapper
const batch = (id = 12) => normalizeMaterialTransfer({ id, batch_no: `BATCH-${id}`, serial_no: '000128', quantity: 0, weight: 30, next_team: { id: 8, name: '检验' }, purpose_name: '去毛刺', transferred_at: '2026-09-27T00:00:00Z' })
beforeEach(() => { vi.spyOn(teamMaterialApi, 'inventoryPending').mockResolvedValue({ items: [batch()], total: 11, page: 1, page_size: 10, as_of: '2026-09-27T00:00:00Z' }) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render() {
  wrapper = mount(InventoryPendingDialog, { props: { teamId: 4, group: warehouseFixture() }, global: { stubs: {
    ElDialog: { name: 'ElDialog', props: { alignCenter: Boolean, appendToBody: Boolean }, template: '<div><slot/><slot name="footer"/></div>' }, LiveRefreshNotice: true, MaterialTransferDrawer: true,
  } } }); await flushPromises()
}
describe('pending ownership detail', () => {
  it('shows batch, downstream, both units and submission time, with original document drilldown', async () => {
    await render()
    expect(wrapper.getComponent({ name: 'ElDialog' }).props()).toMatchObject({ alignCenter: true, appendToBody: true })
    expect(teamMaterialApi.inventoryPending).toHaveBeenLastCalledWith(4, 11, { page: 1, page_size: 10 })
    for (const label of ['BATCH-12', '检验', '转出待签收', '2026-09-27', '统计于']) expect(wrapper.text()).toContain(label)
    const headings = wrapper.findAll('thead th').map(cell => cell.text())
    const cells = wrapper.findAll('tbody td')
    expect(cells[headings.indexOf('件数')]!.text()).toBe('0')
    expect(cells[headings.indexOf('重量 (kg)')]!.text()).toBe('30')
    expect(headings.indexOf('接收业务')).toBe(headings.indexOf('下序 / 去向') + 1)
    expect(cells[headings.indexOf('接收业务')]!.text()).toBe('去毛刺')
    expect(cells[headings.indexOf('转出时间')]!.text()).toContain('2026-09-27')
    await wrapper.findAll('button').find(button => button.text() === 'BATCH-12')!.trigger('click')
    expect(wrapper.getComponent(MaterialTransferDrawer).props('transfer')?.id).toBe(12)
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.inventoryPending).toHaveBeenLastCalledWith(4, 11, { page: 2, page_size: 10 })
  })
  it.each([['warehouse_outbound', '待出库'], ['inspection_shipment', '待发货']] as const)('labels %s separately instead of internal transit', async (entry_kind, label) => {
    vi.mocked(teamMaterialApi.inventoryPending).mockResolvedValue({ items: [normalizeMaterialTransfer({ ...batch(), status: 'pending', entry_kind, next_team: null, external_destination: '外部单位' })], total: 1, page: 1, page_size: 10 })
    await render()
    expect(wrapper.text()).toContain(label)
    expect(wrapper.text()).toContain('外部单位')
    expect(wrapper.text()).not.toContain('转出待签收')
    expect(wrapper.text()).not.toContain('去毛刺')
  })
  it('keeps data on live refresh failure, replaces confirmed batches on update, and ignores closed requests', async () => {
    await render()
    vi.mocked(teamMaterialApi.inventoryPending).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow('offline'); await flushPromises()
    expect(wrapper.text()).toContain('BATCH-12')
    vi.mocked(teamMaterialApi.inventoryPending).mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 10 })
    await live.refresh(); await flushPromises()
    expect(wrapper.text()).not.toContain('BATCH-12')
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.inventoryPending>>) => void
    vi.mocked(teamMaterialApi.inventoryPending).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = live.refresh()
    await wrapper.setProps({ group: null })
    finish({ items: [batch(99)], total: 1, page: 1, page_size: 10 }); await pending; await flushPromises()
    expect(wrapper.text()).not.toContain('BATCH-99')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElCheckbox, ElDatePicker, ElOption, ElPagination, ElSelect, ElTag } from 'element-plus'
import TeamInventory from './TeamInventory.vue'
import TeamInventoryDetail from './TeamInventoryDetail.vue'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import StockSourcePicker from './StockSourcePicker.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import { warehouseColumns } from '@/types/teamInventory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseFixture } from '@/testFixtures/teamInventory'
import type { StockBatch } from '@/types/teamMaterials'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useAuthStore } from '@/stores/auth'

let wrapper: VueWrapper
const data = () => [warehouseFixture(), warehouseFixture({ group_id: 12, material_type: 'finished', receipt_source: 'internal', source_team_id: 8, source_name: '检验', on_hand_quantity: 20, on_hand_weight: 2 }), warehouseFixture({ group_id: 13, serial_no: '000129' })]
const overview = () => ({ team_id: 901, totals: warehouseFixture(), materials: [], pending_incoming: { quantity: 0, weight: 0, count: 0 }, legacy_received_count: 0 })
beforeEach(() => { vi.spyOn(teamMaterialApi, 'teamInventory').mockResolvedValue({ items: data(), total: 28, page: 1, page_size: 10 }); localStorage.clear() })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(path = '/team-workspaces/901?tab=stock', canWrite = true, warehouse = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(TeamInventory, { props: { teamId: 901, overview: overview(), canWrite, warehouse }, global: { plugins: [router, createPinia()], stubs: { TeamInventoryDetail: true, SerialMaterialDrawer: true, StockSourcePicker: true, SerialUrgencyDialog: true } } })
  await flushPromises()
  return router
}
const headers = () => wrapper.findAll('thead th').map(item => item.text())
const select = (label: string) => wrapper.findAllComponents(ElSelect).find(item => item.find(`input[aria-label="${label}"]`).exists())!
async function submit(term: string) { await wrapper.get('input[aria-label="库存明细搜索"]').setValue(term); await wrapper.get('input[aria-label="库存明细搜索"]').trigger('keyup.enter'); await flushPromises() }

describe('warehouse grouped stock', () => {
  it('uses upstream team names on workshops and scopes outbound to the chosen classified row', async () => {
    const workshopRows = [warehouseFixture({ receipt_source: 'internal', source_team_id: 1, source_name: '库房' }), warehouseFixture({ group_id: 12, receipt_source: 'internal', source_team_id: 3, source_name: '退火', material_type: 'finished' })]
    vi.mocked(teamMaterialApi.teamInventory).mockResolvedValue({ items: workshopRows, total: 2, page: 1, page_size: 10 })
    await render(undefined, true, false)
    useTeamDirectoryStore().items = [{ id: 1, name: '库房', kind: 'warehouse' }, { id: 3, name: '退火' }, { id: 901, name: '本班组' }] as ReturnType<typeof useTeamDirectoryStore>['items']
    await flushPromises()
    expect(headers()).toEqual(['流水号', '材质 / 规格', '类型 / 业务', '上序班组', '当前结存', '累计收发', '最早在库接收', '操作'])
    expect(wrapper.text()).not.toContain('车间转入 ·')
    expect(select('库存来源筛选')).toBeUndefined()
    expect(select('库存上序班组筛选').findAllComponents(ElOption).map(option => option.props('label'))).toEqual(['库房', '退火'])
    await wrapper.findAll('button').filter(button => button.text() === '出库')[1]!.trigger('click')
    expect(wrapper.getComponent(StockSourcePicker).props()).toMatchObject({ teamId: 901, groupId: 12, groupLabel: '000128 · 成品 · 退火' })
    await wrapper.findAll('button').filter(button => button.text() === '明细')[1]!.trigger('click')
    expect(wrapper.getComponent(TeamInventoryDetail).props()).toMatchObject({ warehouse: false, group: workshopRows[1] })
    select('库存上序班组筛选').vm.$emit('update:modelValue', 1)
    select('库存物料类型筛选').vm.$emit('update:modelValue', 'semi_finished'); await flushPromises()
    await submit('000128')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ source_team_id: 1, material_type: 'semi_finished', query: '000128' }))
    expect(vi.mocked(teamMaterialApi.teamInventory).mock.lastCall?.[1]).not.toHaveProperty('receipt_source')
  })
  it('preserves warehouse column preferences and isolates workshop choices by account and team', async () => {
    await render(undefined, true, false)
    useAuthStore().session = { access_token: 'test', token_type: 'Bearer', user: { id: 42 } } as ReturnType<typeof useAuthStore>['session']; await flushPromises()
    expect(wrapper.getComponent({ name: 'InventoryColumnSettings' }).props('storageKey')).toBe('heatsink.classified-columns.v1:42:901')
    await wrapper.setProps({ warehouse: true }); await flushPromises()
    expect(wrapper.getComponent({ name: 'InventoryColumnSettings' }).props('storageKey')).toBe('heatsink.warehouse-columns.v1:42:901')
    await wrapper.setProps({ teamId: 902, warehouse: false }); await flushPromises()
    expect(wrapper.getComponent({ name: 'InventoryColumnSettings' }).props('storageKey')).toBe('heatsink.classified-columns.v1:42:902')
  })
  it('retains chart drill-down, date and urgency filters and clears them explicitly', async () => {
    const router = await render('/team-workspaces/901?tab=stock&stock_age=ge7&filter_label=库存停留：7天及以上&page_size=20&activity_day=2026-09-12', true, false)
    expect(wrapper.text()).toContain('库存停留：7天及以上')
    expect(wrapper.getComponent(RecordDateFilter).props('modelValue')).toEqual({ from: '2026-09-12', to: '2026-09-12' })
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-15', to: '2026-09-15' }); await flushPromises()
    wrapper.getComponent(ElCheckbox).vm.$emit('change', true); await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ stock_age: 'ge7', date_from: '2026-09-15', date_to: '2026-09-15', urgent_only: true, page_size: 20 }))
    expect(router.currentRoute.value.query.activity_day).toBeUndefined()
    wrapper.findAllComponents(ElTag).find(tag => tag.text().includes('库存停留'))!.vm.$emit('close', new MouseEvent('click')); await flushPromises()
    expect(router.currentRoute.value.query.stock_age).toBeUndefined()
    expect(router.currentRoute.value.query.date_from).toBe('2026-09-15')
    await wrapper.findAll('button').find(button => button.text() === '重置')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'stock', page_size: '20' })
  })
  it('searches zero balances, three-decimal weights, urgency and dates with safe clearing', async () => {
    await render(undefined, true, false)
    select('库存搜索字段').vm.$emit('update:modelValue', 'available_weight'); await flushPromises()
    const count = vi.mocked(teamMaterialApi.teamInventory).mock.calls.length
    await submit('1.2345'); await submit('0x10')
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledTimes(count)
    await submit('0')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ query: '0', search_field: 'available_weight' }))
    await submit('1.234')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ query: '1.234' }))
    select('库存搜索字段').vm.$emit('update:modelValue', 'urgency'); select('库存搜索字段').vm.$emit('change'); await flushPromises()
    select('库存加急状态').vm.$emit('update:modelValue', 'normal'); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查询')!.trigger('click'); await flushPromises()
    expect(headers()[0]).toBe('加急状态')
    select('库存搜索字段').vm.$emit('update:modelValue', 'last_activity_at'); select('库存搜索字段').vm.$emit('change'); await flushPromises()
    wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', '2026-09-18'); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '查询')!.trigger('click'); await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ query: '2026-09-18', search_field: 'last_activity_at' }))
    wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', null)
    // ElDatePicker forwards clear to its inner picker as an attribute listener.
    ;(wrapper.getComponent(ElDatePicker).vm.$attrs.onClear as () => void)(); await flushPromises()
    expect(vi.mocked(teamMaterialApi.teamInventory).mock.lastCall?.[1]?.query).toBeUndefined()
  })
  it('groups serial and material, displays nature and source, and pages detail rows', async () => {
    await render()
    expect(headers()).toEqual(['流水号', '材质 / 规格', '类型 / 业务', '来源', '当前结存', '累计收发', '最早在库接收', '操作'])
    expect(wrapper.findAll('td[rowspan="2"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('供应商 A外部来料')
    expect(wrapper.text()).toContain('检验车间转入')
    expect(wrapper.text()).toContain('共 28 条分类结存')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, { availability: 'current', page: 1, page_size: 10 })
    expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10,20,50,100])
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20); await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ page: 1, page_size: 20 }))
  })
  it('combines source/type/date and preserves them on pagination', async () => {
    const router = await render()
    select('库存来源筛选').vm.$emit('update:modelValue', 'internal')
    select('库存物料类型筛选').vm.$emit('update:modelValue', 'finished'); await flushPromises()
    await submit('000128')
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-17', to: '2026-09-17' }); await flushPromises()
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ receipt_source: 'internal', material_type: 'finished', query: '000128', date_from: '2026-09-17', date_to: '2026-09-17', page: 2 }))
    expect(router.currentRoute.value.query.receipt_source).toBe('internal')
  })
  it('shows purpose, weight-only balance and receipt age without pretending production is complete', async () => {
    vi.mocked(teamMaterialApi.teamInventory).mockResolvedValueOnce({ items: [warehouseFixture({
      purpose_name: '去毛刺', on_hand_quantity: 0, on_hand_weight: .625, current_batch_count: 1,
      received_quantity: 0, received_weight: 2, dispatched_quantity: 0, dispatched_weight: 1,
      reserved_quantity: 0, reserved_weight: .25, lost_quantity: 0, lost_weight: .125,
    })], total: 1, page: 1, page_size: 10 })
    await render()
    expect(wrapper.text()).toContain('去毛刺')
    expect(wrapper.get('.inventory-balance').text()).toContain('0.625 kg')
    expect(wrapper.get('.inventory-balance').text()).toContain('部分转出 · 1 批')
    expect(wrapper.get('.inventory-movement').text()).toContain('已转出0 件 / 1.25 kg')
    expect(wrapper.get('.movement-pending').text()).toContain('其中待确认0 件 / 0.25 kg')
    expect(wrapper.get('.movement-loss').text()).toContain('丢失0 件 / 0.125 kg')
    expect(wrapper.get('.inventory-receipt').text()).toContain('2026-09-01 11:00')
    expect(wrapper.text()).not.toContain('加工完成')
    expect(wrapper.findAll('button').find(button => button.text() === '出库')!.attributes('disabled')).toBeUndefined()
    select('库存搜索字段').vm.$emit('update:modelValue', 'purpose_name'); await flushPromises()
    await submit('去毛刺')
    expect(headers()[0]).toBe('本班组业务')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ search_field: 'purpose_name', query: '去毛刺' }))
  })
  it('does not merge different specifications when they share a material and serial', async () => {
    vi.mocked(teamMaterialApi.teamInventory).mockResolvedValueOnce({ items: [warehouseFixture(), warehouseFixture({ group_id: 12, transfer_specification: '40 × 30 × 2' })], total: 2, page: 1, page_size: 10 })
    await render()
    expect(wrapper.findAll('td[rowspan="2"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('100 × 80 × 5')
    expect(wrapper.text()).toContain('40 × 30 × 2')
  })
  it('promotes a searched hidden column and restores custom column order', async () => {
    await render('/team-workspaces/901?tab=stock&search_field=customer_code&query=C01')
    expect(headers()[0]).toBe('客户编号')
    const choices = warehouseColumns.map(column => ({ key: column.key, visible: column.key === 'source' || column.key === 'on_hand_weight' })).reverse()
    wrapper.getComponent({ name: 'InventoryColumnSettings' }).vm.$emit('change', choices); await flushPromises()
    expect(headers()).toEqual(['客户编号', '流水号', '当前重量 (kg)', '来源', '操作'])
    wrapper.findAllComponents(ElTag).find(item => item.text().includes('首列显示'))!.vm.$emit('close', new MouseEvent('click')); await flushPromises()
    expect(headers()).toEqual(['流水号', '当前重量 (kg)', '来源', '操作'])
  })
  it('validates numeric queries before requesting grouped amounts', async () => {
    await render()
    select('库存搜索字段').vm.$emit('update:modelValue', 'on_hand_quantity'); await flushPromises()
    const count = vi.mocked(teamMaterialApi.teamInventory).mock.calls.length
    await submit('2.4')
    expect(wrapper.text()).toContain('件数为整数')
    expect(teamMaterialApi.teamInventory).toHaveBeenCalledTimes(count)
    select('库存数值比较').vm.$emit('update:modelValue', 'gte'); await submit('20')
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ search_field: 'on_hand_quantity', search_operator: 'gte', query: '20' }))
    expect(headers()[0]).toBe('当前件数')
  })
  it('scopes row details and outbound picker to the selected group, while the serial opens full history', async () => {
    await render()
    await wrapper.findAll('button').find(item => item.text() === '明细')!.trigger('click')
    expect(wrapper.getComponent(TeamInventoryDetail).props('group')?.group_id).toBe(11)
    await wrapper.findAll('button').find(item => item.text() === '出库')!.trigger('click')
    expect(wrapper.getComponent(StockSourcePicker).props('groupId')).toBe(11)
    const sources = [{ transfer: { id: 11 } }] as StockBatch[]
    wrapper.getComponent(StockSourcePicker).vm.$emit('selected', sources); await flushPromises()
    expect(wrapper.emitted('action')).toEqual([['dispatch', sources]])
    expect(wrapper.findComponent(StockSourcePicker).exists()).toBe(false)
    await wrapper.findAll('button').find(item => item.text() === '000128')!.trigger('click')
    expect(wrapper.getComponent(SerialMaterialDrawer).props()).toMatchObject({ modelValue: true, serialNo: '000128' })
    await wrapper.setProps({ canWrite: false }); await flushPromises()
    expect(wrapper.findAll('button').some(item => item.text() === '出库')).toBe(false)
    wrapper.getComponent(TeamInventoryDetail).vm.$emit('action', 'loss', sources)
    expect(wrapper.emitted('action')).toHaveLength(1)
  })
  it('refreshes on pushed overview without destroying drafts/table or opened details', async () => {
    await render()
    await wrapper.get('input[aria-label="库存明细搜索"]').setValue('未提交')
    await wrapper.findAll('button').find(item => item.text() === '明细')!.trigger('click')
    const table = wrapper.get('.el-table').element
    vi.mocked(teamMaterialApi.teamInventory).mockResolvedValueOnce({ items: [warehouseFixture({ on_hand_quantity: 99 })], total: 28, page: 1, page_size: 10 })
    await wrapper.setProps({ overview: overview() }); await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.getComponent(TeamInventoryDetail).props('group')?.group_id).toBe(11)
    expect((wrapper.get('input[aria-label="库存明细搜索"]').element as HTMLInputElement).value).toBe('未提交')
    expect(wrapper.text()).toContain('99')
    vi.mocked(teamMaterialApi.teamInventory).mockRejectedValueOnce(new Error('offline'))
    await wrapper.setProps({ overview: overview() }); await flushPromises()
    expect(wrapper.text()).toContain('保留上次结果')
    expect(wrapper.text()).toContain('99')
  })
  it('discards late responses after switching team and recovers an exhausted last page', async () => {
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.teamInventory>>) => void
    vi.mocked(teamMaterialApi.teamInventory).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await render()
    await wrapper.setProps({ teamId: 902 }); await flushPromises()
    finish({ items: [warehouseFixture({ serial_no: 'STALE' })], total: 1, page: 1, page_size: 10 }); await flushPromises()
    expect(wrapper.text()).not.toContain('STALE')
    vi.mocked(teamMaterialApi.teamInventory).mockResolvedValueOnce({ items: [], total: 10, page: 2, page_size: 10 })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.teamInventory).toHaveBeenLastCalledWith(902, expect.objectContaining({ page: 1 }))
  })
})

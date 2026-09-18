// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination, ElSelect, ElTag } from 'element-plus'
import WarehouseInventory from './WarehouseInventory.vue'
import WarehouseInventoryDetail from './WarehouseInventoryDetail.vue'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import StockSourcePicker from './StockSourcePicker.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import { warehouseColumns } from '@/types/warehouseInventory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseFixture } from '@/testFixtures/warehouseInventory'
import type { StockBatch } from '@/types/teamMaterials'

let wrapper: VueWrapper
const data = () => [warehouseFixture(), warehouseFixture({ group_id: 12, material_type: 'finished', receipt_source: 'internal', source_team_id: 8, source_name: '检验', on_hand_quantity: 20, on_hand_weight: 2 }), warehouseFixture({ group_id: 13, serial_no: '000129' })]
const overview = () => ({ team_id: 901, totals: warehouseFixture(), materials: [], pending_incoming: { quantity: 0, weight: 0, count: 0 }, legacy_received_count: 0 })
beforeEach(() => { vi.spyOn(teamMaterialApi, 'warehouseInventory').mockResolvedValue({ items: data(), total: 28, page: 1, page_size: 10 }); localStorage.clear() })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(path = '/team-workspaces/901?tab=stock', canWrite = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(WarehouseInventory, { props: { teamId: 901, overview: overview(), canWrite }, global: { plugins: [router, createPinia()], stubs: { WarehouseInventoryDetail: true, SerialMaterialDrawer: true, StockSourcePicker: true, SerialUrgencyDialog: true } } })
  await flushPromises()
  return router
}
const headers = () => wrapper.findAll('thead th').map(item => item.text())
const select = (label: string) => wrapper.findAllComponents(ElSelect).find(item => item.find(`input[aria-label="${label}"]`).exists())!
async function submit(term: string) { await wrapper.get('input[aria-label="库房库存搜索"]').setValue(term); await wrapper.get('input[aria-label="库房库存搜索"]').trigger('keyup.enter'); await flushPromises() }

describe('warehouse grouped stock', () => {
  it('groups serial and material, displays nature and source, and pages detail rows', async () => {
    await render()
    expect(headers()).toEqual(['流水号', '材质', '规格', '物料类型', '来源', '当前件数', '当前重量 (kg)', '操作'])
    expect(wrapper.findAll('td[rowspan="2"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('外部来料 · 供应商 A')
    expect(wrapper.text()).toContain('车间转入 · 检验')
    expect(wrapper.text()).toContain('共 28 条库存明细')
    expect(teamMaterialApi.warehouseInventory).toHaveBeenLastCalledWith(901, { availability: 'current', page: 1, page_size: 10 })
    expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10,20,50,100])
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20); await flushPromises()
    expect(teamMaterialApi.warehouseInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ page: 1, page_size: 20 }))
  })
  it('combines source/type/date and preserves them on pagination', async () => {
    const router = await render()
    select('库存来源筛选').vm.$emit('update:modelValue', 'internal')
    select('库存物料类型筛选').vm.$emit('update:modelValue', 'finished'); await flushPromises()
    await submit('000128')
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-17', to: '2026-09-17' }); await flushPromises()
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.warehouseInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ receipt_source: 'internal', material_type: 'finished', query: '000128', date_from: '2026-09-17', date_to: '2026-09-17', page: 2 }))
    expect(router.currentRoute.value.query.receipt_source).toBe('internal')
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
    select('库房搜索字段').vm.$emit('update:modelValue', 'on_hand_quantity'); await flushPromises()
    const count = vi.mocked(teamMaterialApi.warehouseInventory).mock.calls.length
    await submit('2.4')
    expect(wrapper.text()).toContain('件数为整数')
    expect(teamMaterialApi.warehouseInventory).toHaveBeenCalledTimes(count)
    select('库房数值比较').vm.$emit('update:modelValue', 'gte'); await submit('20')
    expect(teamMaterialApi.warehouseInventory).toHaveBeenLastCalledWith(901, expect.objectContaining({ search_field: 'on_hand_quantity', search_operator: 'gte', query: '20' }))
    expect(headers()[0]).toBe('当前件数')
  })
  it('scopes row details and outbound picker to the selected group, while the serial opens full history', async () => {
    await render()
    await wrapper.findAll('button').find(item => item.text() === '明细')!.trigger('click')
    expect(wrapper.getComponent(WarehouseInventoryDetail).props('group')?.group_id).toBe(11)
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
    wrapper.getComponent(WarehouseInventoryDetail).vm.$emit('action', 'loss', sources)
    expect(wrapper.emitted('action')).toHaveLength(1)
  })
  it('refreshes on pushed overview without destroying drafts/table or opened details', async () => {
    await render()
    await wrapper.get('input[aria-label="库房库存搜索"]').setValue('未提交')
    await wrapper.findAll('button').find(item => item.text() === '明细')!.trigger('click')
    const table = wrapper.get('.el-table').element
    vi.mocked(teamMaterialApi.warehouseInventory).mockResolvedValueOnce({ items: [warehouseFixture({ on_hand_quantity: 99 })], total: 28, page: 1, page_size: 10 })
    await wrapper.setProps({ overview: overview() }); await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.getComponent(WarehouseInventoryDetail).props('group')?.group_id).toBe(11)
    expect((wrapper.get('input[aria-label="库房库存搜索"]').element as HTMLInputElement).value).toBe('未提交')
    expect(wrapper.text()).toContain('99')
    vi.mocked(teamMaterialApi.warehouseInventory).mockRejectedValueOnce(new Error('offline'))
    await wrapper.setProps({ overview: overview() }); await flushPromises()
    expect(wrapper.text()).toContain('保留上次结果')
    expect(wrapper.text()).toContain('99')
  })
  it('discards late responses after switching team and recovers an exhausted last page', async () => {
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.warehouseInventory>>) => void
    vi.mocked(teamMaterialApi.warehouseInventory).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await render()
    await wrapper.setProps({ teamId: 902 }); await flushPromises()
    finish({ items: [warehouseFixture({ serial_no: 'STALE' })], total: 1, page: 1, page_size: 10 }); await flushPromises()
    expect(wrapper.text()).not.toContain('STALE')
    vi.mocked(teamMaterialApi.warehouseInventory).mockResolvedValueOnce({ items: [], total: 10, page: 2, page_size: 10 })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(teamMaterialApi.warehouseInventory).toHaveBeenLastCalledWith(902, expect.objectContaining({ page: 1 }))
  })
})

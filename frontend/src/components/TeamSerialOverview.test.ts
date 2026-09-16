// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination, ElSelect } from 'element-plus'
import TeamSerialOverview from './TeamSerialOverview.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import { ElCheckbox } from 'element-plus'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { analyticsFixture, serialFixture } from '@/testFixtures/materialAnalytics'
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'analytics').mockResolvedValue(analyticsFixture())
  vi.spyOn(teamMaterialApi, 'serials').mockImplementation(async (_teamId, params = {}) => {
    const page = Number(params.page || 1), size = Number(params.page_size || 10), start = (page - 1) * size
    return { items: Array.from({ length: Math.max(0, Math.min(size, 42 - start)) }, (_, i) => serialFixture(`SERIAL-${start + i}`)), total: 42, page, page_size: size }
  })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(path = '/team-workspaces/914?tab=serials') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(TeamSerialOverview, { props: { teamId: 914, overview: { team_id: 914, totals: serialFixture(), materials: [], pending_incoming: { quantity: 0, weight: 0, count: 0 }, legacy_received_count: 0 } }, global: { plugins: [router, createPinia()], stubs: { TeamAnalyticsCharts: true, SerialMaterialDrawer: true } } })
  await flushPromises()
  return router
}
describe('standalone serial ledger', () => {
  it('updates current balances without replacing the table, search draft or open detail', async () => {
    const router = await render('/team-workspaces/914?tab=serials&query=AL&page=2')
    await wrapper.get('input[aria-label="流水号台账搜索"]').setValue('尚未提交')
    await wrapper.findAll('button').find(button => button.text() === 'SERIAL-10')!.trigger('click')
    const table = wrapper.get('.el-table').element
    let finish!: (value: Awaited<ReturnType<typeof teamMaterialApi.serials>>) => void
    vi.mocked(teamMaterialApi.serials).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const overview = { team_id: 914, totals: serialFixture(), materials: [], pending_incoming: { quantity: 0, weight: 0, count: 0 }, legacy_received_count: 0 }
    await wrapper.setProps({ overview })
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.getComponent(SerialMaterialDrawer).props('modelValue')).toBe(true)
    expect((wrapper.get('input[aria-label="流水号台账搜索"]').element as HTMLInputElement).value).toBe('尚未提交')
    expect(router.currentRoute.value.query.page).toBe('2')
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ query: 'AL', page: 2 }))
    finish({ items: [serialFixture('SERIAL-UPDATED')], total: 42, page: 2, page_size: 10 }); await flushPromises()
    expect(wrapper.text()).toContain('SERIAL-UPDATED')
    vi.mocked(teamMaterialApi.serials).mockRejectedValueOnce(new Error('offline'))
    await wrapper.setProps({ overview: { ...overview } }); await flushPromises()
    expect(wrapper.text()).toContain('保留上次结果')
    expect(wrapper.text()).toContain('SERIAL-UPDATED')
  })
  it('keeps six reading columns with ten rows by default and no fixed table height', async () => {
    await render()
    expect(wrapper.findAll('.serial-number-link')).toHaveLength(10)
    const columns = wrapper.findAllComponents({ name: 'ElTableColumn' })
    expect(columns.filter(column => column.props('className') === 'ledger-number').map(column => column.props('label'))).toEqual(['可用件数', '可用重量 (kg)'])
    expect(columns.map(column => column.props('label'))).toEqual(['流水号', '材质', '规格', '可用件数', '可用重量 (kg)', '操作'])
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    expect(wrapper.getComponent(ElPagination).props('pageSize')).toBe(10)
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page_size: 10 }))
  })

  it('grows the page when twenty rows are selected and can return to ten', async () => {
    await render()
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 20)
    await flushPromises()
    expect(wrapper.findAll('.serial-number-link')).toHaveLength(20)
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
    await flushPromises()
    expect(wrapper.findAll('.serial-number-link')).toHaveLength(10)
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page: 1, page_size: 10 }))
  })

  it('combines calendar and urgency filters server-side, resets paging and keeps them through pagination', async () => {
    const router = await render('/team-workspaces/914?tab=serials&page=2&page_size=50&query=铜')
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-11', to: '2026-09-12' })
    await flushPromises()
    wrapper.getComponent(ElCheckbox).vm.$emit('change', true)
    await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ query: '铜', date_from: '2026-09-11', date_to: '2026-09-12', urgent_only: true, page: 1, page_size: 50 }))
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ date_from: '2026-09-11', date_to: '2026-09-12', urgent_only: 'true', page: '2' })
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '', to: '' }); await flushPromises()
    expect(router.currentRoute.value.query.date_from).toBeUndefined()
    expect(router.currentRoute.value.query.urgent_only).toBe('true')
  })

  it('renders one row per serial, 10/20/50/100 paging, and opens serial rather than batch detail', async () => {
    await render()
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    expect(wrapper.text()).toContain('多规格')
    expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10,20,50,100])
    await wrapper.findAll('button').find(button => button.text() === 'SERIAL-0')!.trigger('click')
    expect(wrapper.getComponent(SerialMaterialDrawer).props()).toMatchObject({ modelValue: true, serialNo: 'SERIAL-0', teamId: 914 })
    wrapper.getComponent(ElPagination).vm.$emit('size-change', 100)
    await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ page_size: 100, page: 1 }))
  })
  it('accepts chart drill-down filters without loading or rendering charts', async () => {
    await render('/team-workspaces/914?tab=serials&stock_age=ge7&filter_label=库存停留：7天及以上')
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ stock_age: 'ge7', page: 1 }))
    expect(teamMaterialApi.analytics).not.toHaveBeenCalled()
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.text()).toContain('完整余额')
  })
  it('keeps searches on the serial page and refreshes the parent balance after detail changes', async () => {
    const router = await render('/team-workspaces/914?tab=serials&days=7')
    await wrapper.get('input[aria-label="流水号台账搜索"]').setValue('铜钼')
    await wrapper.get('input[aria-label="流水号台账搜索"]').trigger('keyup.enter'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'serials', days: '7', query: '铜钼' })
    wrapper.getComponent(SerialMaterialDrawer).vm.$emit('changed')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  it('shows failed serial data as an error, not invented zero data', async () => {
    vi.mocked(teamMaterialApi.serials).mockRejectedValue(new Error('台账服务不可用'))
    await render()
    expect(wrapper.text()).toContain('台账服务不可用')
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
  })
  it('combines server-side stock and material filters, preserves page size, and resets conditions', async () => {
    const router = await render('/team-workspaces/914?tab=serials&page=2&page_size=50&stock_age=ge7&filter_label=库存停留')
    await wrapper.get('.more-filters-button').trigger('click')
    const select = wrapper.findAllComponents(ElSelect).find(item => item.find('input[aria-label="台账库存筛选"]').exists())!
    select.vm.$emit('update:modelValue', 'available'); select.vm.$emit('change', 'available')
    await flushPromises()
    expect(teamMaterialApi.serials).toHaveBeenLastCalledWith(914, expect.objectContaining({ availability: 'available', page: 1, page_size: 50, stock_age: 'ge7' }))
    const material = wrapper.findAllComponents(ElSelect).find(item => item.find('input[aria-label="台账材质筛选"]').exists())!
    material.vm.$emit('update:modelValue', '铜钼'); material.vm.$emit('change', '铜钼')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ material_name: '铜钼', availability: 'available', stock_age: 'ge7' })
    await wrapper.findAll('button').find(item => item.text() === '重置')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'serials', page_size: '50' })
  })
})

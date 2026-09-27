// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ElPagination } from 'element-plus'
import TeamMaterialOverview from './TeamMaterialOverview.vue'
import type { TeamMaterialOverview as Overview } from '@/types/teamMaterials'

let wrapper: VueWrapper
const overview = (count = 25): Overview => ({
  team_id: 1, legacy_received_count: 0, pending_incoming: { count: 2, quantity: 20, weight: 2 },
  totals: {} as Overview['totals'],
  materials: Array.from({ length: count }, (_, i) => ({ material_name: `材质 ${i + 1}`, available_quantity: 10, available_weight: 1, reserved_quantity: 2, reserved_weight: .2, on_hand_quantity: 12, on_hand_weight: 1.2, received_quantity: 20, received_weight: 2, dispatched_quantity: 7, dispatched_weight: .7, lost_quantity: 1, lost_weight: .1, in_transit_quantity: 0, in_transit_weight: 0 })),
})
afterEach(() => wrapper?.unmount())
describe('compact material classification', () => {
  it('keeps actions with the material table and removes duplicate charts and summaries', async () => {
    wrapper = mount(TeamMaterialOverview, { props: { overview: overview() }, slots: { actions: '<button>手工入库</button><button>扫码查询</button>' } }); await flushPromises()
    expect(wrapper.get('.material-ledger header').text()).toContain('手工入库')
    expect(wrapper.get('.material-ledger header').text()).toContain('扫码查询')
    expect(wrapper.find('.material-chart').exists()).toBe(false)
    expect(wrapper.find('.balance-cards').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('材质库存分布')
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    expect(wrapper.get('.ledger-table').classes()).toContain('single-line-table')
    expect(wrapper.get('.material-amount').findAll('strong').map(value => value.text())).toEqual(['10', '1'])
    expect(wrapper.findAll('th').map(cell => cell.text())).toEqual(['材质', '正常料在库', '废料在库', '转出待确认', '在库合计', '累计接收', '确认转出', '累计丢失', '操作'])
  })
  it('retains material drill-down and 10/20/50/100 pagination', async () => {
    wrapper = mount(TeamMaterialOverview, { props: { overview: overview() } }); await flushPromises()
    await wrapper.get('.el-table__body button').trigger('click')
    expect(wrapper.emitted('filter')).toEqual([['材质 1']])
    const pager = wrapper.getComponent(ElPagination)
    expect(pager.props('pageSizes')).toEqual([10, 20, 50, 100])
    pager.vm.$emit('current-change', 2); await flushPromises()
    expect(wrapper.emitted('paginate')?.at(-1)).toEqual([2, 10])
    await wrapper.setProps({ page: 2 })
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
    expect(wrapper.get('.el-table__body .el-table__row').text()).toContain('材质 11')
    pager.vm.$emit('size-change', 50); await flushPromises()
    expect(wrapper.emitted('paginate')?.at(-1)).toEqual([1, 50])
    await wrapper.setProps({ page: 1, pageSize: 50 })
    expect(pager.props('currentPage')).toBe(1)
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(25)
  })
  it('expands only the empty table without creating placeholder rows', async () => {
    wrapper = mount(TeamMaterialOverview, { props: { overview: overview(0) } })
    expect(wrapper.text()).toContain('暂无库存')
    expect(wrapper.text()).toContain('共 0 种材质')
    expect(wrapper.find('.ledger-table--empty').exists()).toBe(true)
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
    await wrapper.setProps({ overview: overview(2) }); await flushPromises()
    expect(wrapper.find('.ledger-table--empty').exists()).toBe(false)
    expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(2)
  })
  it('separates material and nature summaries and opens the selected nature', async () => {
    const data = overview(2)
    data.material_types = [{ ...data.materials[0]!, material_type: 'semi_finished' }]
    wrapper = mount(TeamMaterialOverview, { props: { overview: data } }); await flushPromises()
    expect(wrapper.findAll('.ledger-table')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('物料性质结存')
    expect(wrapper.get('.material-ledger').element.lastElementChild?.tagName).toBe('FOOTER')
    expect(wrapper.get('footer').text()).toContain('共 2 种材质')
    await wrapper.setProps({ kind: 'type' }); await flushPromises()
    expect(wrapper.findAll('.ledger-table')).toHaveLength(1)
    expect(wrapper.get('.ledger-table').classes()).toContain('single-line-table')
    expect(wrapper.get('header h2').text()).toContain('物料性质结存')
    expect(wrapper.get('footer').text()).toContain('共 1 种物料性质')
    expect(wrapper.findAll('th').map(cell => cell.text())).toEqual(['物料性质', '正常料在库', '在库合计', '废料可处理余量', '操作'])
    await wrapper.findAll('.el-table__body button').find(button => button.text() === '查看详情')!.trigger('click')
    expect(wrapper.emitted('filter')).toEqual([['semi_finished']])
  })
  it('links missing categories to their exact unclassified filters instead of all stock', async () => {
    const data = overview(1)
    data.materials[0]!.material_name = null
    data.material_types = [{ ...data.materials[0]!, material_type: null }]
    wrapper = mount(TeamMaterialOverview, { props: { overview: data } }); await flushPromises()
    await wrapper.get('.el-table__body button').trigger('click')
    expect(wrapper.emitted('filter')?.at(-1)).toEqual(['未填写材质'])
    await wrapper.setProps({ kind: 'type' }); await flushPromises()
    await wrapper.get('.el-table__body button').trigger('click')
    expect(wrapper.emitted('filter')?.at(-1)).toEqual(['unknown'])
    await wrapper.setProps({ overview: overview(0) }); await flushPromises()
    expect(wrapper.get('footer').text()).toContain('共 0 种物料性质')
    expect(wrapper.text()).toContain('暂无库存')
  })
})

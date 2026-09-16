// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialDispatchPrintSheet from './MaterialDispatchPrintSheet.vue'
import BarcodeCard from './BarcodeCard.vue'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
describe('one batch one printed barcode', () => {
  it.each([1, 20, 100])('prints all %s rows and totals with exactly one CK barcode', count => {
    const wrapper = mount(MaterialDispatchPrintSheet, { props: { dispatch: dispatchFixture(count) }, global: { stubs: { BarcodeCard: true } } })
    expect(wrapper.findAllComponents(BarcodeCard)).toHaveLength(1)
    expect(wrapper.getComponent(BarcodeCard).props('value')).toBe('CK-GROUP')
    expect(wrapper.findAll('.dispatch-print-lines tbody tr')).toHaveLength(count)
    expect(wrapper.get('table[aria-label="批次单据资料"]').text()).toContain('创建时间')
    expect(wrapper.get('.dispatch-print-lines tfoot').text()).toContain('合计不含作废明细')
    expect(wrapper.text()).toContain(`QA-GROUP-${count}`)
    expect(wrapper.text()).not.toContain('TL-GROUP')
    expect(wrapper.text()).not.toContain('留存联')
    wrapper.unmount()
  })
  it('preserves voided rows, long destinations and full material names without changing aggregate totals', () => {
    const group = dispatchFixture(2, 'warehouse_outbound', { total_quantity: 10, total_weight: 1.005 })
    group.items[0]!.status = 'voided'; group.next_team.name = '收货去向'.repeat(60); group.items[1]!.material_name = '长材质'.repeat(50)
    const wrapper = mount(MaterialDispatchPrintSheet, { props: { dispatch: group }, global: { stubs: { BarcodeCard: true } } })
    expect(wrapper.text()).toContain(group.next_team.name); expect(wrapper.text()).toContain(group.items[1]!.material_name)
    expect(wrapper.text()).toContain('已作废'); expect(wrapper.text()).toContain('合计不含作废明细')
    expect(wrapper.text()).not.toContain('接收班组签字'); wrapper.unmount()
  })
})

// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import BarcodeCard from './BarcodeCard.vue'
import { dispatchFixture } from '@/testFixtures/materialDispatch'

describe('independent batch co-printing', () => {
  it('prints every batch barcode and customer fields without a CK header barcode', () => {
    const items = dispatchFixture(3).items
    Object.assign(items[0]!, { serial_no: '000012', customer_code: '客户 A', product_code: 'CP-009', quantity: 0, weight: .125, material_type: 'scrap_chips' })
    items[2]!.status = 'voided'
    const wrapper = mount(MaterialBatchPrintSheet, { props: { items }, global: { stubs: { BarcodeCard: true } } })
    expect(wrapper.findAllComponents(BarcodeCard).map(c => c.props('value'))).toEqual(items.map(row => row.batch_no))
    expect(wrapper.text()).not.toContain('CK-GROUP')
    expect(wrapper.text()).toContain('000012'); expect(wrapper.text()).toContain('废屑')
    expect(wrapper.text()).toContain('客户 A'); expect(wrapper.text()).toContain('CP-009')
    expect(wrapper.findAll('tbody')).toHaveLength(3)
    expect(wrapper.get('tfoot').text()).toContain('1.13')
    wrapper.unmount()
  })
  it('keeps all rows for long print jobs and includes independent destinations and statuses', () => {
    const items = dispatchFixture(25, 'warehouse_outbound').items
    const wrapper = mount(MaterialBatchPrintSheet, { props: { items }, global: { stubs: { BarcodeCard: true } } })
    expect(wrapper.findAll('tbody')).toHaveLength(25)
    expect(wrapper.text()).toContain(items[24]!.serial_no)
    expect(wrapper.text()).toContain('客户收货仓')
    expect(wrapper.text()).toContain('待出库确认')
    wrapper.unmount()
  })
})

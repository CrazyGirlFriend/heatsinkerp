// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import BarcodeCard from './BarcodeCard.vue'
import { dispatchFixture } from '@/testFixtures/materialDispatch'

describe('independent batch co-printing', () => {
  it('totals effective kg while retaining gross sludge and percentage by batch', () => {
    const items = dispatchFixture(1).items
    Object.assign(items[0]!, { material_type: 'sludge', quantity: 0, weight: 3, sludge_gross_weight: 10, sludge_content_percent: 30 })
    const wrapper = mount(MaterialBatchPrintSheet, { props: { items }, global: { stubs: { BarcodeCard: true } } })
    expect(wrapper.text()).toContain('废泥实重：10 kg；有效材料占比：30%；折算重量：3 kg')
    expect(wrapper.get('tfoot').findAll('td').map(td => td.text())).toEqual(['0', '3'])
    wrapper.unmount()
  })
  it('gives each batch its own purpose column alongside the destination, without repeating it in notes', () => {
    const items = dispatchFixture(4).items
    const purposes = ['去毛刺', '检验', null, '旧来源业务']
    items.forEach((item, index) => Object.assign(item, { next_team: { id: 8, name: '检验' }, purpose_name: purposes[index] }))
    Object.assign(items[3]!, { entry_kind: 'inspection_shipment', external_destination: '客户单位' })
    const wrapper = mount(MaterialBatchPrintSheet, { props: { items }, global: { stubs: { BarcodeCard: true } } })
    const headings = wrapper.findAll('thead th').map(th => th.text())
    const purposeIndex = headings.indexOf('接收业务')
    expect(purposeIndex).toBe(headings.indexOf('来源 / 去向') + 1)
    expect(wrapper.findAll('tbody').map(body => body.findAll('tr')[0]!.findAll('td')[purposeIndex]!.text())).toEqual(['去毛刺', '检验', '未指定', '—'])
    expect(wrapper.findAll('.batch-note').every(note => note.attributes('colspan') === '7' && !note.text().includes('接收业务'))).toBe(true)
    expect(wrapper.get('tfoot th').attributes('colspan')).toBe('5')
    expect(wrapper.findAllComponents(BarcodeCard).map(c => c.props('value'))).toEqual(items.map(item => item.batch_no))
    wrapper.unmount()
  })

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
    expect(wrapper.text()).toContain('待出库')
    wrapper.unmount()
  })
})

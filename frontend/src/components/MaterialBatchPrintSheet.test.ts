// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import BarcodeCard from './BarcodeCard.vue'
import { dispatchFixture } from '@/testFixtures/materialDispatch'

describe('unified multi-batch printing', () => {
  it('retains each batch barcode and business without preprinting receiver details', async () => {
    const items = dispatchFixture(3).items
    Object.assign(items[0]!, {
      purpose_name: '去毛刺',
      status: 'received',
      received_by: '王芳',
      received_at: '2026-10-12T02:30:00Z',
    })
    Object.assign(items[1]!, {
      purpose_name: '检验',
      status: 'received',
      received_by: '赵敏',
      received_at: '2026-10-12T03:30:00Z',
    })
    const wrapper = mount(MaterialBatchPrintSheet, {
      props: { items },
      global: { stubs: { BarcodeCard: true } },
    })
    await flushPromises()
    const copy = wrapper.get('.transfer-print-page .transfer-print-copy')
    expect(
      copy
        .findAllComponents(BarcodeCard)
        .map((barcode: VueWrapper) => (barcode.props() as { value: string }).value),
    ).toEqual(items.map((row) => row.batch_no))
    expect(
      copy.findAll('.transfer-print-material').map((row) => row.findAll('td')[6]!.text()),
    ).toEqual(['去毛刺', '检验', '未指定'])
    expect(copy.text()).toContain('接收方签字')
    for (const text of [
      '接收人',
      '签收时间',
      '王芳',
      '赵敏',
      '2026-10-12 10:30',
      '2026-10-12 11:30',
    ])
      expect(copy.text()).not.toContain(text)
    expect(copy.text()).not.toContain('CK-GROUP')
    wrapper.unmount()
  })
  it('totals effective weight without counting sludge/chips pieces or voided records', async () => {
    const items = dispatchFixture(4).items
    Object.assign(items[0]!, {
      material_type: 'sludge',
      quantity: 999,
      weight: 3,
      sludge_gross_weight: 10,
      sludge_content_percent: 30,
    })
    Object.assign(items[1]!, { material_type: 'scrap_chips', quantity: 888, weight: 0.125 })
    Object.assign(items[2]!, { material_type: 'defective', quantity: 7, weight: 1.005 })
    items[3]!.status = 'voided'
    const wrapper = mount(MaterialBatchPrintSheet, {
      props: { items },
      global: { stubs: { BarcodeCard: true } },
    })
    await flushPromises()
    const copy = wrapper.get('.transfer-print-page .transfer-print-copy')
    expect(copy.text()).toContain('废泥实重')
    expect(copy.text()).toContain('10 kg')
    expect(copy.text()).toContain('30%')
    expect(copy.text()).toContain('折算重量')
    expect(copy.get('.transfer-print-total').text()).toContain('账面重量')
    expect(copy.get('.transfer-print-total').text()).toContain('3 批（不含作废）')
    expect(
      copy
        .get('.transfer-print-total')
        .findAll('b')
        .map((cell) => cell.text()),
    ).toEqual(['7', '4.13'])
    expect(
      copy.findAll('.transfer-print-material').map((row) => row.findAll('td')[4]!.text()),
    ).toEqual(['—', '—', '7', '10'])
    wrapper.unmount()
  })
  it('separates incompatible teams, senders and external documents instead of sharing signatures', async () => {
    const items = dispatchFixture(4).items
    items[1]!.transferred_by = '另一位转料人'
    items[2]!.next_team = { id: 8, code: 'FACTORY-QC', name: '检验' }
    Object.assign(items[3]!, {
      entry_kind: 'inspection_shipment',
      external_destination: '客户仓库',
    })
    const wrapper = mount(MaterialBatchPrintSheet, {
      props: { items },
      global: { stubs: { BarcodeCard: true } },
    })
    await flushPromises()
    expect(wrapper.findAll('.transfer-print-page')).toHaveLength(4)
    expect(wrapper.findAll('.transfer-print-page .transfer-print-copy')).toHaveLength(8)
    expect(wrapper.findAll('.transfer-print-page')[3]!.text()).toContain('客户仓库')
    wrapper.unmount()
  })
  it('retains every independent batch in a large print job', async () => {
    const items = dispatchFixture(25, 'warehouse_outbound').items
    const wrapper = mount(MaterialBatchPrintSheet, {
      props: { items },
      global: { stubs: { BarcodeCard: true } },
    })
    await flushPromises()
    expect(
      wrapper.get('.transfer-print-page .transfer-print-copy').findAll('.transfer-print-material'),
    ).toHaveLength(25)
    expect(wrapper.text()).toContain(items[24]!.serial_no)
    expect(wrapper.text()).toContain('客户收货仓')
    expect(wrapper.text()).toContain('待出库')
    wrapper.unmount()
  })
})

// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MaterialTransferPrintSheet from './MaterialTransferPrintSheet.vue'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import type { MaterialTransfer } from '@/types/materialTransfer'

vi.mock('jsbarcode', () => ({
  default: vi.fn((element: SVGSVGElement, value: string) =>
    element.setAttribute('data-code128-value', value),
  ),
}))
const transfer = {
  ...dispatchFixture(1).items[0]!,
  batch_no: 'TL20261012000027',
  serial_no: 'YS-027',
  material_name: '材料2',
  sent_employee_id: 22,
  sent_employee_name: '张建国',
  transferred_by: '开单账号',
  transferred_at: '2026-10-12T01:00:00Z',
  source_transfer_batch_no: 'TL-PARENT',
}

describe('shared transfer print template', () => {
  it('prints the sending employee instead of the login account and leaves legacy identity unfilled', async () => {
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer } })
    await flushPromises()
    expect(wrapper.text()).toContain('张建国')
    expect(wrapper.text()).not.toContain('开单账号')
    await wrapper.setProps({
      transfer: { ...transfer, sent_employee_name: null, sent_employee_id: null },
    })
    expect(wrapper.text()).toContain('未登记')
    expect(wrapper.text()).not.toContain('开单账号')
    wrapper.unmount()
  })
  it('uses identical fields and layout for one selected batch and single-batch printing', async () => {
    const single = mount(MaterialTransferPrintSheet, { props: { transfer } })
    const batch = mount(MaterialBatchPrintSheet, { props: { items: [transfer] } })
    await flushPromises()
    expect(single.get('.transfer-print-page').text()).toBe(batch.get('.transfer-print-page').text())
    const copies = single.findAll('.transfer-print-page .transfer-print-copy')
    expect(copies).toHaveLength(2)
    expect(copies[0]!.get('.transfer-print-lines').text()).toBe(
      copies[1]!.get('.transfer-print-lines').text(),
    )
    expect(
      single.findAll('.transfer-print-page svg[data-code128-value="TL20261012000027"]'),
    ).toHaveLength(2)
    expect(copies[0]!.text()).toContain('TL-PARENT')
    single.unmount()
    batch.unmount()
  })
  it.each(['库房', '轧制', '退火', '研磨', '线切割', '雕刻', '电镀', '检验'])(
    'keeps the same columns and internal transfer title for %s',
    async (name) => {
      const wrapper = mount(MaterialTransferPrintSheet, {
        props: { transfer: { ...transfer, source_team: { ...transfer.source_team, name } } },
      })
      await flushPromises()
      const copy = wrapper.get('.transfer-print-page .transfer-print-copy')
      expect(copy.get('h1').text()).toBe('物料转料单')
      expect(copy.findAll('thead th').map((cell) => cell.text())).toEqual([
        '流水号',
        '材质',
        '物料类型',
        '实际尺寸',
        '件数',
        '重量 (kg)',
        '接收业务',
        '本次批次 / 条码',
      ])
      expect(copy.text()).toContain(name)
      wrapper.unmount()
    },
  )
  it.each(['pending', 'received'] as const)(
    'leaves only a blank receiver signature for %s transfers',
    async (status) => {
      const wrapper = mount(MaterialTransferPrintSheet, {
        props: {
          transfer: {
            ...transfer,
            status,
            received_by: '李明',
            received_at: '2026-10-12T02:30:00Z',
          },
        },
      })
      await flushPromises()
      for (const copy of wrapper.findAll('.transfer-print-page .transfer-print-copy')) {
        expect(copy.text()).toContain('接收班组')
        expect(copy.text()).toContain('张建国')
        expect(copy.text()).toContain('接收方签字')
        for (const text of ['接收人', '签收时间', '李明', '2026-10-12 10:30'])
          expect(copy.text()).not.toContain(text)
      }
      wrapper.unmount()
    },
  )
  it.each([
    ['processing_output', '加工实物登记单', '加工登记联', '加工类别'],
    ['opening_stock', '初始库存登记单', '班组留存联', '登记班组'],
    ['warehouse_receipt', '库房入库单', '库房留存联', '入库来源类别'],
    ['warehouse_outbound', '出库单', '出库留存联', '出库去向'],
    ['inspection_shipment', '发货单', '发货留存联', '发货去向'],
    ['serial_reallocation', '流水号转投单', '转投留存联', '转投原因'],
  ] as const)('preserves the business meaning of %s', async (kind, title, copyName, label) => {
    const wrapper = mount(MaterialTransferPrintSheet, {
      props: {
        transfer: {
          ...transfer,
          entry_kind: kind,
          processing_role: 'produced',
          notes: '示例说明',
          external_destination: '客户收货仓',
          next_team: { id: 15, code: 'FACTORY-WAREHOUSE', kind: 'warehouse', name: '库房' },
          warehouse_location: 'A-01',
        },
      },
    })
    await flushPromises()
    const copy = wrapper.get('.transfer-print-page .transfer-print-copy')
    expect(copy.attributes('aria-label')).toBe(copyName)
    expect(copy.get('h1').text()).toBe(title)
    expect(copy.text()).toContain(label)
    expect(copy.text()).not.toContain('接收方签字')
    expect(copy.text()).toContain('A-01')
    if (kind === 'warehouse_outbound' || kind === 'inspection_shipment') {
      expect(copy.text()).toContain('转料人签字')
      expect(copy.text()).toContain('张建国')
      expect(copy.text()).not.toContain('开单账号')
    }
    wrapper.unmount()
  })
  it('retains every optional document field and every character of long notes in both copies', async () => {
    const technical = `首行\n${'技术要求完整保留，'.repeat(350)}末行`
    const document: MaterialTransfer = {
      ...transfer,
      source_batch_no: 'RAW-009',
      material_type: 'scrap_chips',
      quantity: 99,
      finished_quantity: 132,
      customer_code: '001440',
      finished_specification: 'Φ20×4',
      transfer_specification: '散装',
      technical_requirements: technical,
      product_code: 'P-01',
      part_no: 'PART-2',
      material_shape: '圆',
      material_description: '完整物料说明',
      outsourced_unit: '外委单位甲',
      purpose_category: '样品',
      category_level3: '三级A',
      order_category: '生产',
      special_process: '特殊工艺文本说明',
      delivery_date: '2026-10-20',
      delivery_quantity: 123,
      delivery_origin_batch_no: 'TL-ORIGIN',
    }
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer: document } })
    await flushPromises()
    for (const copy of wrapper.findAll('.transfer-print-page .transfer-print-copy')) {
      const parts = copy
        .findAll('.transfer-print-pairs > div')
        .filter((field) => field.get('strong').text().startsWith('技术要求'))
        .map((field) => field.get('span').element.textContent)
      expect(parts.join('')).toBe(technical)
      for (const value of [
        'RAW-009',
        '001440',
        '132 件',
        'P-01',
        'PART-2',
        '外委单位甲',
        '三级A',
        '特殊工艺文本说明',
        '123 件',
        'TL-ORIGIN',
      ])
        expect(copy.text()).toContain(value)
      expect(copy.get('.transfer-print-material').findAll('td')[4]!.text()).toBe('—')
      expect(copy.get('.transfer-print-total').text()).not.toContain('99')
    }
    wrapper.unmount()
  })
})

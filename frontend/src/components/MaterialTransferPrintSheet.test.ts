// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { MaterialTransfer } from '@/types/materialTransfer'
import MaterialTransferPrintSheet from './MaterialTransferPrintSheet.vue'
import source from './MaterialTransferPrintSheet.vue?raw'

vi.mock('jsbarcode', () => ({
  default: vi.fn((element: SVGSVGElement, value: string) => element.setAttribute('data-code128-value', value)),
}))

const transfer: MaterialTransfer = {
  id: 7,
  batch_no: 'TL20260906000007',
  barcode_payload: 'TL20260906000007',
  barcode_type: 'CODE128',
  serial_no: 'LS-2026-007',
  source_team: { id: 2, code: 'ZB', name: '扎板' },
  next_team: { id: 3, code: 'TH', name: '退火' },
  quantity: 120,
  quantity_unit: '件',
  weight: 18.75,
  weight_unit: 'kg',
  status: 'received',
  notes: '当班转料',
  transferred_by: '扎板班组长',
  transferred_at: '2026-09-06T01:20:00Z',
  received_by: '退火班组长',
  received_at: '2026-09-06T02:10:00Z',
  voided_by: null,
  voided_at: null,
  updated_at: '2026-09-06T02:10:00Z',
  locked: true,
  locked_at: '2026-09-06T02:10:00Z',
  allowed_actions: [],
}

describe('material transfer print sheet', () => {
  it.each([['warehouse_outbound', '出库'], ['inspection_shipment', '发货']] as const)('prints %s as an external confirmation with no receiving team', async (kind, verb) => {
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer: { ...transfer, entry_kind: kind, external_destination: '客户外部收货仓', next_team: { id: '', code: '', name: '客户外部收货仓' }, status: 'dispatched', dispatched_by: '本班组确认人', dispatched_at: '2026-09-07T01:00:00Z' } } })
    await flushPromises()
    expect(wrapper.attributes('aria-label')).toBe(`A4 双联${verb}单`)
    expect(wrapper.get(`[aria-label="${verb}留存联"]`).text()).toContain(`${verb}去向`)
    expect(wrapper.get(`[aria-label="${verb}凭证联"]`).text()).toContain('客户外部收货仓')
    expect(wrapper.text()).toContain(`已${verb}`); expect(wrapper.text()).toContain('本班组确认人')
    expect(wrapper.text()).not.toContain('接收班组'); expect(wrapper.text()).not.toContain('接收方签字')
  })
  it('prints warehouse intake copies as a stock origin rather than a team-to-team handoff', async () => {
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer: { ...transfer, entry_kind: 'warehouse_receipt', source_team: { id: '', code: '', name: '库房手工入库' }, next_team: { id: 1, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse' }, notes: '到货登记' } } })
    await flushPromises()
    expect(wrapper.attributes('aria-label')).toBe('A4 双联入库单')
    expect(wrapper.get('[aria-label="库房留存联"]').text()).toContain('入库来源')
    expect(wrapper.get('[aria-label="入库凭证联"]').text()).toContain('外部来源未登记')
    expect(wrapper.text()).toContain('已入库'); expect(wrapper.text()).toContain('入库说明')
    expect(wrapper.text()).not.toContain('转出班组'); expect(wrapper.text()).not.toContain('接收确认联')
    expect(wrapper.findAll('svg[data-code128-value="TL20260906000007"]')).toHaveLength(2)
  })
  it('prints semi-finished inbound material and its explanation by destination kind', async () => {
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer: { ...transfer, next_team: { ...transfer.next_team, name: '中央收发站', kind: 'warehouse' }, material_type: 'semi_finished', notes: '中途退回，表面未处理' } } })
    await flushPromises()
    for (const copy of wrapper.findAll('.material-transfer-print-copy')) {
      expect(copy.text()).toContain('半成品')
      expect(copy.text()).toContain('入库说明')
      expect(copy.text()).toContain('中途退回，表面未处理')
    }
  })

  it('renders two bounded handoff copies with the same Code 128 batch barcode', async () => {
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer } })
    await flushPromises()
    expect(wrapper.findAll('.material-transfer-print-copy')).toHaveLength(2)
    expect(wrapper.findAll('table.print-fields')).toHaveLength(2)
    expect(wrapper.find('dl.print-fields').exists()).toBe(false)
    expect(wrapper.get('[aria-label="转出留存联"]').text()).toContain('扎板')
    expect(wrapper.get('[aria-label="接收确认联"]').text()).toContain('退火')
    expect(wrapper.text()).toContain('LS-2026-007')
    expect(wrapper.text()).toContain('120 件')
    expect(wrapper.text()).toContain('18.75 kg')
    expect(wrapper.findAll('svg[data-code128-value="TL20260906000007"]')).toHaveLength(2)
  })

  it('uses a teleported-body-compatible A4 print selector without a process workflow', () => {
    expect(source).toContain('@page { size: A4 portrait; margin: 12mm; }')
    expect(source).toContain('body.material-transfer-printing > :not(.material-transfer-print-sheet)')
    expect(source).not.toMatch(/工单号|工艺路线|报工/)
  })

  it('prints complete identical document fields in both copies and permits long text to paginate', async () => {
    const technical = `首行\n${'技术要求完整保留，'.repeat(350)}末行`
    const document = { ...transfer, material_type: 'scrap_chips' as const, quantity: 0, finished_quantity: 132, source_batch_no: 'RAW-009', material_name: 'Mo70Cu30', customer_code: '001440', finished_specification: 'Φ20×4', transfer_specification: '散装', technical_requirements: technical, product_code: 'P-01', part_no: 'PART-2', material_shape: '圆', material_description: '完整物料说明', outsourced_unit: '外委单位甲', purpose_category: '样品', category_level3: '三级A', order_category: '生产', special_process: '特殊工艺文本说明' }
    const wrapper = mount(MaterialTransferPrintSheet, { props: { transfer: document } })
    await flushPromises()
    const copies = wrapper.findAll('.material-transfer-print-copy')
    expect(copies[0]!.get('.print-fields').text()).toBe(copies[1]!.get('.print-fields').text())
    for (const copy of copies) {
      expect(copy.text()).toContain('废屑')
      expect(copy.text()).toContain('0 件')
      expect(copy.text()).toContain('132 件')
      expect(copy.text()).toContain('RAW-009')
      expect(copy.text()).toContain('001440')
      expect(copy.text()).toContain(technical)
      expect(copy.text()).toContain('特殊工艺文本说明')
      expect(copy.text()).toContain('接收时间')
      expect(copy.get('svg').attributes('data-code128-value')).toBe(transfer.batch_no)
    }
    expect(wrapper.classes()).toContain('material-transfer-print-sheet--extended')
  })
})

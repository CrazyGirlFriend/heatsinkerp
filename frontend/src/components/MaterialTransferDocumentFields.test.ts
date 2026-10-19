// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialTransferDocumentFields from './MaterialTransferDocumentFields.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'

describe('transfer destination fields', () => {
  it('shows a processing child as local physical stock with its role, dimensions and parent batch', () => {
    const wrapper = mount(MaterialTransferDocumentFields, {
      props: {
        group: 'all',
        transfer: normalizeMaterialTransfer({
          entry_kind: 'processing_output',
          processing_role: 'remaining',
          batch_no: 'JG-20',
          source_transfer_batch_no: 'TL-1',
          next_team: { id: 2, name: '轧制' },
          status: 'received',
          transfer_specification: '20 × 10 × 2 mm',
        }),
      },
    })
    expect(wrapper.text()).toContain('本班组加工')
    expect(wrapper.text()).toContain('未加工余料')
    expect(wrapper.text()).toContain('TL-1')
    expect(wrapper.findAll('th').map((th) => th.text())).toEqual(
      expect.arrayContaining(['加工班组', '实物件数', '实际尺寸', '加工时间']),
    )
    expect(wrapper.text()).not.toContain('接收班组')
    expect(wrapper.text()).not.toContain('接收时间')
    wrapper.unmount()
  })
  it('shows actual sludge, percentage and accounting kg separately', () => {
    const wrapper = mount(MaterialTransferDocumentFields, {
      props: {
        group: 'all',
        transfer: normalizeMaterialTransfer({
          material_type: 'sludge',
          quantity: 0,
          weight: 3,
          sludge_gross_weight: 10,
          sludge_content_percent: 30,
        }),
      },
    })
    const cells = wrapper.findAll('th').map((th) => th.text())
    expect(cells).toContain('废泥实重')
    expect(cells).toContain('有效材料占比')
    expect(cells).toContain('折算重量')
    expect(wrapper.text()).toContain('10 kg')
    expect(wrapper.text()).toContain('30%')
    expect(wrapper.text()).toContain('3 kg')
    wrapper.unmount()
  })
  it.each(['去毛刺', '检验', '发货', null])(
    'pairs the receiving team with the batch purpose %s',
    (purpose_name) => {
      const wrapper = mount(MaterialTransferDocumentFields, {
        props: {
          group: 'all',
          transfer: normalizeMaterialTransfer({
            batch_no: 'BATCH-QC',
            serial_no: '000012',
            source_team: { id: 7, name: '电镀' },
            next_team: { id: 8, name: '检验' },
            purpose_name,
          }),
        },
      })
      const row = wrapper
        .findAll('tr')
        .find((item) => item.findAll('th').some((th) => th.text() === '接收班组'))!
      expect(row.findAll('th').map((th) => th.text())).toEqual(['接收班组', '接收业务'])
      expect(row.findAll('td').map((td) => td.text())).toEqual(['检验', purpose_name || '未指定'])
      wrapper.unmount()
    },
  )

  it('does not attach a source purpose to an external recipient', () => {
    const wrapper = mount(MaterialTransferDocumentFields, {
      props: {
        group: 'all',
        transfer: normalizeMaterialTransfer({
          batch_no: 'BATCH-EXTERNAL',
          serial_no: '000012',
          source_team: { id: 8, name: '检验' },
          entry_kind: 'inspection_shipment',
          external_destination: '客户单位',
          purpose_name: '去毛刺',
        }),
      },
    })
    const row = wrapper
      .findAll('tr')
      .find((item) => item.findAll('th').some((th) => th.text() === '发货去向'))!
    expect(row.findAll('td').map((td) => td.text())).toEqual(['客户单位', '—'])
    expect(wrapper.text()).not.toContain('接收班组')
    expect(wrapper.text()).not.toContain('去毛刺')
    wrapper.unmount()
  })
})

it('shows returned rework state during receiving without inventing completed rounds', () => {
  const wrapper = mount(MaterialTransferDocumentFields, {
    props: {
      group: 'all',
      transfer: normalizeMaterialTransfer({ rework_pending: true, rework_count: 0 }),
    },
  })
  expect(wrapper.text()).toContain('待返工')
  expect(wrapper.text()).toContain('已完成返工次数')
  expect(wrapper.text()).toContain('0 次')
  wrapper.unmount()
})

// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialTransferDocumentFields from './MaterialTransferDocumentFields.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'

describe('transfer destination fields', () => {
  it.each(['去毛刺', '检验', '发货', null])('pairs the receiving team with the batch purpose %s', purpose_name => {
    const wrapper = mount(MaterialTransferDocumentFields, { props: { group: 'all', transfer: normalizeMaterialTransfer({
      batch_no: 'BATCH-QC', serial_no: '000012', source_team: { id: 7, name: '电镀' }, next_team: { id: 8, name: '检验' }, purpose_name,
    }) } })
    const row = wrapper.findAll('tr').find(item => item.findAll('th').some(th => th.text() === '接收班组'))!
    expect(row.findAll('th').map(th => th.text())).toEqual(['接收班组', '接收业务'])
    expect(row.findAll('td').map(td => td.text())).toEqual(['检验', purpose_name || '未指定'])
    wrapper.unmount()
  })

  it('does not attach a source purpose to an external recipient', () => {
    const wrapper = mount(MaterialTransferDocumentFields, { props: { group: 'all', transfer: normalizeMaterialTransfer({
      batch_no: 'BATCH-EXTERNAL', serial_no: '000012', source_team: { id: 8, name: '检验' }, entry_kind: 'inspection_shipment', external_destination: '客户单位', purpose_name: '去毛刺',
    }) } })
    const row = wrapper.findAll('tr').find(item => item.findAll('th').some(th => th.text() === '发货去向'))!
    expect(row.findAll('td').map(td => td.text())).toEqual(['客户单位', '—'])
    expect(wrapper.text()).not.toContain('接收班组')
    expect(wrapper.text()).not.toContain('去毛刺')
    wrapper.unmount()
  })
})

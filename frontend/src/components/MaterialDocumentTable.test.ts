// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialDocumentTable from './MaterialDocumentTable.vue'

describe('document field table', () => {
  it('pairs short fields while reserving a complete row for notes and odd fields', () => {
    const wrapper = mount(MaterialDocumentTable, { props: { label: '单据资料', fields: [
      { label: '流水号', value: 'LS-001' }, { label: '件数', value: '0 件' },
      { label: '说明', value: '第一行\n第二行', fullWidth: true },
      { label: '重量', value: '0.001 kg' },
    ] } })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.findAll('th')).toHaveLength(2)
    expect(rows[1]!.get('td').attributes('colspan')).toBe('3')
    expect(wrapper.get('table').classes()).toContain('business-document-table')
    expect(rows[1]!.get('td').classes()).toContain('table-prose')
    expect(rows[0]!.get('td').classes()).not.toContain('table-prose')
    expect(rows[1]!.text()).toContain('第一行\n第二行')
    expect(rows[2]!.get('td').attributes('colspan')).toBe('3')
    expect(wrapper.text()).toContain('0 件')
    expect(wrapper.text()).toContain('0.001 kg')
  })
})

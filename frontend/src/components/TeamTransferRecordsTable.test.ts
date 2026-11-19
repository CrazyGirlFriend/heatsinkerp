// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TeamTransferRecordsTable from './TeamTransferRecordsTable.vue'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import { tableColumnScopeKey } from '@/utils/tableColumnLayout'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  localStorage.clear()
})
const row = (id = 1) =>
  normalizeMaterialTransfer({
    id,
    batch_no: `TL${id}`,
    serial_no: '691236-50',
    task_batch_number: id,
    quantity: 100,
    weight: 10,
    material_name: 'Mo70Cu30',
    material_type: 'finished',
    entry_kind: 'transfer',
    status: 'pending',
    source_team: { id: 1, name: '库房' },
    next_team: { id: 2, name: '线切割' },
    received_employee_name: '接收人甲',
    warehouse_location: 'A01',
  })
function headings() {
  return wrapper
    .findAll('.el-table__header-wrapper th')
    .map((cell) => cell.text().replace(/\s+/g, ''))
}

describe('shared team transfer records', () => {
  it.each(['pending', 'receipts', 'outgoing'] as const)(
    'shows the associated serials directly in the %s list until allocation',
    async (kind) => {
      const shared = normalizeMaterialTransfer({
        ...row(),
        serial_no: '共投-TL1',
        shared_group_id: 7,
        shared_unallocated: true,
        shared_serials: [{ serial_no: '691236-50' }, { serial_no: '691236-51' }],
      })
      const allocated = {
        ...shared,
        id: 2,
        batch_no: 'TL2',
        shared_unallocated: false,
        serial_no: '691236-51',
      }
      wrapper = mount(TeamTransferRecordsTable, {
        props: { kind, rows: [shared, allocated, row(3)], emptyTitle: '' },
      })
      await flushPromises()
      const serials = wrapper.findAll('.el-table__body .record-serial > span')
      const labels = ['共投 · 691236-50 / 691236-51', '691236-51', '691236-50']
      expect(serials.map((cell) => cell.text())).toEqual(labels)
      expect(serials.map((cell) => cell.attributes('title'))).toEqual(labels)
    },
  )

  it.each(['glass', 'watermelon'] as const)(
    'keeps list-specific columns, saved preferences and receiver gating in %s',
    async (appearance) => {
      wrapper = mount(TeamTransferRecordsTable, {
        props: { kind: 'pending', rows: [row()], emptyTitle: '暂无来料', canWrite: true },
        global: {
          provide: {
            [workspaceAppearanceKey as symbol]: computed(() => appearance),
            [tableColumnScopeKey as symbol]: ref('operator'),
          },
        },
      })
      await flushPromises()
      expect(headings()).toEqual([
        '批次号',
        '流水号',
        '材质',
        '物料类型',
        '件数',
        '重量(kg)',
        '上序',
        '转出人',
        '转出时间',
        '操作',
      ])
      const confirm = () =>
        wrapper.findAll('button').find((button) => button.text() === '核对接收')!
      expect(confirm().attributes('disabled')).toBeDefined()
      await wrapper.setProps({ receiverSelected: true })
      await confirm().trigger('click')
      expect(wrapper.emitted('detail')?.at(-1)).toEqual([row()])
      const settings = () => wrapper.getComponent({ name: 'InventoryColumnSettings' })
      expect(settings().props('storageKey')).toBe(
        'heatsink.table-columns.v1:operator:TeamWorkspacePage-1',
      )

      await wrapper.setProps({ kind: 'receipts', warehouse: true })
      await flushPromises()
      expect(headings()).toEqual([
        '仓位',
        '批次号',
        '流水号',
        '入库时间',
        '来源类别',
        '来源',
        '材质',
        '物料类型',
        '件数',
        '重量(kg)',
        '状态',
        '接收/登记人',
        '操作',
      ])
      expect(wrapper.get('.el-table__body').text()).toContain('接收人甲')
      expect(wrapper.find('.el-table__body .el-checkbox').exists()).toBe(false)
      expect(settings().props('storageKey')).toBe(
        'heatsink.table-columns.v1:operator:TeamWorkspacePage-2',
      )

      await wrapper.setProps({ warehouse: false })
      await flushPromises()
      expect(headings()).not.toContain('仓位')
      expect(headings()).not.toContain('来源类别')
      await wrapper.setProps({ kind: 'pending', canWrite: false, receiverSelected: false })
      await flushPromises()
      const view = wrapper.findAll('button').find((button) => button.text() === '查看详情')!
      expect(view.attributes('disabled')).toBeUndefined()
    },
  )

  it('selects distinct physical batches with the same serial for combined printing', async () => {
    const rows = [row(1), row(2)]
    wrapper = mount(TeamTransferRecordsTable, {
      props: { kind: 'outgoing', rows, emptyTitle: '暂无转出' },
      global: { provide: { [tableColumnScopeKey as symbol]: ref('operator') } },
    })
    await flushPromises()
    expect(headings()).toEqual([
      '',
      '批次号',
      '流水号',
      '排期批次',
      '材质',
      '物料类型',
      '出库方式',
      '下序/去向',
      '件数',
      '重量(kg)',
      '状态',
      '转料/登记人',
      '登记时间',
      '操作',
    ])
    expect(wrapper.getComponent({ name: 'InventoryColumnSettings' }).props('storageKey')).toBe(
      'heatsink.table-columns.v1:operator:TeamWorkspacePage-3',
    )
    const cells = wrapper.findAll('.el-table__body .el-table__row')
    expect(cells[0]!.text()).toContain('第1批')
    expect(cells[1]!.text()).toContain('第2批')
    await cells[0]!.get('input[type=checkbox]').setValue(true)
    await cells[1]!.get('input[type=checkbox]').setValue(true)
    expect(wrapper.emitted('selectionChange')?.at(-1)).toEqual([rows])
    await cells[1]!.get('.batch-link').trigger('click')
    expect(wrapper.emitted('detail')?.at(-1)).toEqual([rows[1]])
    await wrapper.setProps({ rows: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无转出')
  })
})

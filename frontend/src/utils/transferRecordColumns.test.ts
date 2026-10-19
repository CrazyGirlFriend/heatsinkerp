import { describe, expect, it } from 'vitest'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
import { formatDateTime } from './format'
import { tableExportSource } from './tableExport'
import { globalTransferExportFields } from './teamTableExport'
import { transferRecordColumns, type TransferRecordColumnKey } from './transferRecordColumns'

function transfer(overrides: Partial<MaterialTransfer> = {}): MaterialTransfer {
  return {
    ...normalizeMaterialTransfer({
      id: 1,
      serial_no: '0000123',
      batch_no: 'TL-001',
      entry_kind: 'transfer',
      material_name: '铜钼合金',
      material_type: 'semi_finished',
      quantity: 12,
      weight: 0.123456,
      source_team: { id: 1, name: '库房', code: 'FACTORY-WAREHOUSE' },
      next_team: { id: 2, name: '旧轧制名称', code: 'FACTORY-ROLL' },
      status: 'received',
      sent_employee_name: '实际转料员工',
      received_employee_name: '实际接收员工',
      transferred_by: '开单登录账号',
      received_by: '签收登录账号',
      transferred_at: '2026-10-10T01:00:00Z',
      received_at: '2026-10-10T02:00:00Z',
    }),
    ...overrides,
  }
}

function value(key: TransferRecordColumnKey, row: MaterialTransfer) {
  return transferRecordColumns.find((column) => column.key === key)!.value(row)
}

describe('global transfer record columns', () => {
  it('keeps the original display keys and adds the four default details', () => {
    expect(
      transferRecordColumns.filter((column) => column.defaultVisible).map(({ key }) => key),
    ).toEqual([
      'material',
      'source',
      'destination',
      'purpose',
      'material_type',
      'quantity',
      'weight',
      'status',
      'transfer_specification',
      'sent_employee_name',
      'received_employee_name',
      'received_at',
    ])
    expect(transferRecordColumns).toHaveLength(23)
    expect(new Set(transferRecordColumns.map(({ key }) => key)).size).toBe(23)
    expect(new Set(globalTransferExportFields.map(({ key }) => key)).size).toBe(26)
  })

  it('exports every selectable column once between the fixed serial/date and batch columns', async () => {
    const row = transfer({
      transfer_specification: '实际 80 × 30 × 4 mm',
      finished_specification: '成品 75 × 25 × 3 mm',
      source_transfer_batch_no: 'TL-PREVIOUS',
      source_batch_no: '0000088',
      customer_code: 'C-008',
      delivery_date: '2026-11-30',
      delivery_quantity: 20,
      warehouse_location: 'A-08',
      notes: '第一行说明\n第二行说明',
    })
    expect(globalTransferExportFields.map(({ key }) => key)).toEqual([
      'serial_no',
      'transferred_at',
      ...transferRecordColumns.map(({ exportKey }) => exportKey),
      'batch_no',
    ])
    for (const column of transferRecordColumns) {
      expect(globalTransferExportFields.find(({ key }) => key === column.exportKey)).toEqual({
        key: column.exportKey,
        label:
          column.key === 'weight' ? '重量 (kg)' : column.key === 'quantity' ? '件数' : column.label,
        value: column.value,
      })
    }
    const source = tableExportSource('转料记录', 1, globalTransferExportFields, async () => [row])
    const exported = await source.load(new AbortController().signal, () => {})
    expect(exported).toEqual([
      {
        serial_no: '0000123',
        transferred_at: formatDateTime(row.transferred_at),
        material_name: '铜钼合金',
        source: '库房',
        destination: '轧制',
        purpose: '未指定',
        material_type: '半成品',
        quantity: 12,
        weight: 0.123456,
        status: '已接收',
        transfer_specification: '实际 80 × 30 × 4 mm',
        sent_employee_name: '实际转料员工',
        received_employee_name: '实际接收员工',
        received_at: formatDateTime(row.received_at),
        entry_kind: '内部转料',
        sent_processing_status: '未登记',
        finished_specification: '成品 75 × 25 × 3 mm',
        source_transfer_batch_no: 'TL-PREVIOUS',
        source_batch_no: '0000088',
        customer_code: 'C-008',
        delivery_date: '2026-11-30',
        delivery_quantity: 20,
        warehouse_location: 'A-08',
        notes: '第一行说明\n第二行说明',
        transferred_by: '开单登录账号',
        batch_no: 'TL-001',
      },
    ])
  })

  it.each(['transfer', undefined] as const)(
    'uses real employees rather than login accounts for an internal %s record',
    (entry_kind) => {
      const row = transfer({ entry_kind })
      expect(value('sent_employee_name', row)).toBe('实际转料员工')
      expect(value('received_employee_name', row)).toBe('实际接收员工')
      expect(value('transferred_by', row)).toBe('开单登录账号')
      expect(value('received_at', row)).toBe(formatDateTime(row.received_at))
      const missingEmployees = { ...row, sent_employee_name: null, received_employee_name: null }
      expect(value('sent_employee_name', missingEmployees)).toBe('未登记')
      expect(value('received_employee_name', missingEmployees)).toBe('未登记')
    },
  )

  it('shows no receiver for a transfer that has not been signed for', () => {
    const row = transfer({ status: 'pending', received_at: null })
    expect(value('received_employee_name', row)).toBe('—')
    expect(value('received_at', row)).toBe('—')
    expect(value('status', row)).toBe('待签收')
  })

  it.each(['warehouse_outbound', 'inspection_shipment'] as const)(
    'uses the external destination and keeps dispatch confirmation out of receipt fields for %s',
    (entry_kind) => {
      const row = transfer({
        entry_kind,
        status: 'dispatched',
        external_destination: '客户收货仓',
        sent_employee_name: null,
        dispatched_by: '发货确认账号',
        dispatched_at: '2026-10-10T03:00:00Z',
      })
      expect(value('destination', row)).toBe('客户收货仓')
      expect(value('sent_employee_name', row)).toBe('未登记')
      expect(value('received_employee_name', row)).toBe('—')
      expect(value('received_at', row)).toBe('—')
      expect(value('purpose', row)).toBe('—')
    },
  )

  it.each([
    ['warehouse_receipt', '外部供应商'],
    ['opening_stock', '初始库存'],
    ['serial_reallocation', '原流水号-001 转投入'],
    ['processing_output', '旧轧制名称 · 本班组加工'],
  ] as const)(
    'keeps registration accounts separate from transfer employees for %s',
    (entry_kind, expectedSource) => {
      const row = transfer({
        entry_kind,
        external_source: '外部供应商',
        source_serial_no: '原流水号-001',
      })
      expect(value('source', row)).toBe(expectedSource)
      expect(value('sent_employee_name', row)).toBe('—')
      expect(value('transferred_by', row)).toBe('开单登录账号')
      expect(value('received_employee_name', row)).toBe('—')
      expect(value('received_at', row)).toBe('—')
    },
  )

  it('preserves zero quantities and weights while rendering empty optional fields consistently', () => {
    const row = transfer({ quantity: 0, weight: 0, delivery_quantity: 0 })
    expect(value('quantity', row)).toBe(0)
    expect(value('weight', row)).toBe(0)
    expect(value('delivery_quantity', row)).toBe(0)
    for (const empty of [null, undefined, '', '   ']) {
      expect(value('transfer_specification', { ...row, transfer_specification: empty })).toBe('—')
      expect(value('notes', { ...row, notes: empty ?? null })).toBe('—')
    }
    expect(value('delivery_quantity', { ...row, delivery_quantity: null })).toBe('—')
    expect(value('delivery_date', { ...row, delivery_date: null })).toBe('—')
  })
})

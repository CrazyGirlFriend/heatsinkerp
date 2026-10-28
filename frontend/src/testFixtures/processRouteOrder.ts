import type { RouteMaterialField, RouteOrderDocument } from '@/types/processRoute'

export const field = (value: string | number): RouteMaterialField => ({
  value,
  label: '客户代码',
  source_row: '1:2',
  source_label: '客户代码',
})
export const orderFixture: RouteOrderDocument = {
  filename: '订单.xlsx',
  sheet: 'Sheet1',
  headers: ['流水号', '客户代码', '数量'],
  values: ['S-001', '11600', '18100'],
  serial_no: 'S-001',
  warnings: [],
  receipt_fields: {
    serial_no: { ...field('S-001'), source_kind: 'excel' },
    customer_code: { ...field('11600'), source_kind: 'excel' },
    delivery_quantity: { ...field(18100), label: '应发成品件数', source_kind: 'excel' },
  },
}

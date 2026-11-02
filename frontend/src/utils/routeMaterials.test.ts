import { expect, it } from 'vitest'
import { reactive } from 'vue'
import { mergeRouteMaterials } from './routeMaterials'
import { field, orderFixture } from '@/testFixtures/processRouteOrder'

it('merges reactive imports in either order with Word priority and independent source values', () => {
  const word = { serial_no: field('S-001'), customer_code: field('11600-T3') }
  const order = reactive(structuredClone(orderFixture))
  const first = mergeRouteMaterials({ tables: [], issues: [], word_fields: word }, order)
  const second = mergeRouteMaterials({
    ...mergeRouteMaterials({ tables: [], issues: [] }, order),
    word_fields: word,
  })
  expect(first.receipt_fields).toEqual(second.receipt_fields)
  expect(first.receipt_fields!.customer_code!.value).toBe('11600-T3')
  expect(first.receipt_fields!.customer_code!.alternative!.value).toBe('11600')
  expect(first.receipt_fields!.delivery_quantity!.value).toBe(18100)
  first.receipt_fields!.delivery_quantity!.value = '18000'
  expect(order.receipt_fields.delivery_quantity!.value).toBe(18100)
})
it('keeps process and order serials independent with the process value taking priority', () => {
  const word = { serial_no: field('PROCESS-001') }
  const merged = mergeRouteMaterials({ tables: [], issues: [], word_fields: word }, orderFixture)
  expect(merged.word_fields!.serial_no!.value).toBe('PROCESS-001')
  expect(merged.receipt_fields!.serial_no).toMatchObject({
    value: 'PROCESS-001',
    alternative: { value: 'S-001', source_kind: 'excel' },
  })
  expect(merged.order_document!.serial_no).toBe('S-001')
  expect(merged.order_document!.receipt_fields.serial_no!.value).toBe('S-001')
  expect(word.serial_no.value).toBe('PROCESS-001')
})
it('keeps an older process serial when its independent order is retained during a merge', () => {
  const merged = mergeRouteMaterials({
    tables: [],
    issues: [],
    receipt_fields: { serial_no: field('PROCESS-002') },
    order_document: orderFixture,
  })
  expect(merged.receipt_fields!.serial_no!.value).toBe('PROCESS-002')
  expect(merged.word_fields!.serial_no!.value).toBe('PROCESS-002')
  expect(merged.order_document!.serial_no).toBe('S-001')
})

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
it('rejects a spreadsheet for another serial', () => {
  expect(() =>
    mergeRouteMaterials(
      { tables: [], issues: [], receipt_fields: { serial_no: field('OTHER') } },
      orderFixture,
    ),
  ).toThrow('流水号不一致')
})

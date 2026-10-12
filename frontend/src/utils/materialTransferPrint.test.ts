import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { describe, expect, it } from 'vitest'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import { groupTransferPrintItems, paginateTransferBlocks, printTextParts, transferPrintTotals } from './materialTransferPrint'

describe('print grouping and pagination', () => {
  it('groups the same route/date/person but never combines different senders or destinations', () => {
    const items = dispatchFixture(5).items
    items[1]!.transferred_by = '张三'
    items[2]!.next_team = { ...items[2]!.next_team, id: 99 }
    items[3]!.source_team = { ...items[3]!.source_team, id: 98 }
    items[4]!.transferred_at = '2026-10-12T12:00:00Z'
    expect(groupTransferPrintItems(items)).toHaveLength(5)
    expect(groupTransferPrintItems([items[0]!, items[0]!])[0]!.items).toHaveLength(1)
  })
  it('retains long text and explicit line breaks exactly', () => {
    const text = '逐行说明\n'.repeat(400) + '😀末尾'
    const parts = printTextParts(text)
    expect(parts.join('')).toBe(text)
    expect(parts.every(part => Array.from(part).length <= 80 && (part.match(/\n/g) || []).length <= 3)).toBe(true)
  })
  it('keeps a complete batch together when it fits and adds its barcode on continued pages', () => {
    const group = groupTransferPrintItems(dispatchFixture(2).items)[0]!
    const heights = group.blocks.map(block => block.fields ? 10 : 20)
    const pages = paginateTransferBlocks(group.blocks, heights, 90)
    expect(pages).toHaveLength(2)
    expect(pages.every(page => new Set(page.map(block => block.transfer.batch_no)).size === 1)).toBe(true)
    const continued = paginateTransferBlocks(group.blocks, heights, 45)
    expect(continued.every(page => !page[0]!.fields)).toBe(true)
    expect(continued.flat().filter(block => block.fields).map(block => block.key)).toEqual(group.blocks.filter(block => block.fields).map(block => block.key))
    for (const page of continued) expect(page.reduce((sum, block) => sum + (block.fields ? 10 : 20), 0)).toBeLessThanOrEqual(45)
  })
  it('fails explicitly rather than printing an overheight fragment', () => {
    const group = groupTransferPrintItems(dispatchFixture(1).items)[0]!
    expect(() => paginateTransferBlocks(group.blocks, group.blocks.map(() => 100), 50)).toThrow('打印内容超出纸张范围')
  })
  it('does not round batch weights to three decimals before summation', () => {
    const items = dispatchFixture(2).items
    items[0]!.weight = .123456; items[1]!.weight = .654321
    expect(transferPrintTotals(items).weight).toBe('0.777777')
  })
})

 it('prints every shared requirement and counts the unsplit physical batch only once', () => {
  const item = normalizeMaterialTransfer({ id: 900, batch_no: 'SHARED-1', serial_no: '共投-SHARED-1', shared_group_id: 1, shared_unallocated: true, shared_origin_batch_no: 'SHARED-1', quantity: 1, weight: 100, status: 'received', shared_serials: Array.from({ length: 20 }, (_, i) => ({ serial_no: `ORDER-${i + 1}`, customer_code: `C${i + 1}`, finished_specification: `${i + 1} × 20 × 2 mm`, delivery_date: '2026-11-01', delivery_quantity: 30 + i })) })
  const groups = groupTransferPrintItems([item]), text = JSON.stringify(groups[0]!.blocks.flatMap(block => block.fields || []))
  expect(text).toContain('ORDER-20'); expect(text).toContain('49 件'); expect(text).toContain('C20')
  expect(transferPrintTotals([item])).toMatchObject({ quantity: '1', weight: '100', batches: 1 })
})

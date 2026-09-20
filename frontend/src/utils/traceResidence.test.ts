import { describe, expect, it } from 'vitest'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { TraceBatch } from '@/types/materialTrace'
import type { MaterialTransferHistoryEntry } from '@/types/materialTransfer'
import { traceDuration, traceFlowModel, traceFlowOption, traceTimestamp } from './flowPreview'

const at = (day: number, hour = 8) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`
const stamp = (day: number, hour = 8) => traceTimestamp(at(day, hour))!
const warehouse = { id: 1, code: 'warehouse', name: '库房' }
const rolling = { id: 2, code: 'rolling', name: '轧制' }
function lot(id: number, overrides: Partial<TraceBatch> = {}): TraceBatch {
  return { ...normalizeMaterialTransfer({ id, batch_no: `TL-${id}`, serial_no: '000012', entry_kind: id === 1 ? 'warehouse_receipt' : 'transfer',
    source_transfer_id: id === 1 ? null : 1, source_team: warehouse, next_team: id === 1 ? warehouse : rolling,
    quantity: 100, weight: 10, status: 'received', stock_tracked: true, created_at: at(10), received_at: at(10) }),
    on_hand_quantity: 100, on_hand_weight: 10, ...overrides }
}
function event(id: number, action: MaterialTransferHistoryEntry['action'], day: number, quantity?: number): MaterialTransferHistoryEntry {
  return { id, action, actor: '测试', occurred_at: at(day), changes: quantity === undefined ? {} : {
    quantity: { before: null, after: quantity }, weight: { before: null, after: quantity / 10 },
  } }
}

describe('full-chain residence from committed stock history', () => {
  it('deducts pending splits immediately and extends only the remaining received stock to the observation time', () => {
    const root = lot(1, { on_hand_quantity: 50, on_hand_weight: 5 })
    const pending = lot(2, { quantity: 30, weight: 3, transferred_at: at(12), status: 'pending', received_at: null, on_hand_quantity: null, on_hand_weight: null })
    const received = lot(3, { quantity: 20, weight: 2, transferred_at: at(13), received_at: at(14), on_hand_quantity: 20, on_hand_weight: 2 })
    const model = traceFlowModel([root, pending, received], at(17))
    expect(model.byId.get('1')?.stays).toEqual([
      { start: stamp(10), end: stamp(12), quantity: 100, weight: 10, current: false },
      { start: stamp(12), end: stamp(13), quantity: 70, weight: 7, current: false },
      { start: stamp(13), end: stamp(17), quantity: 50, weight: 5, current: true },
    ])
    expect(model.byId.get('2')).toMatchObject({ finishedAt: null, stays: [] })
    expect(model.byId.get('3')?.stays[0]).toMatchObject({ start: stamp(14), end: stamp(17), quantity: 20, weight: 2 })
    expect(model.span).toBe(7 * 86400000)
    expect(model.nodes.some(node => node.residenceIssue)).toBe(false)
  })
  it('replays edits and void returns at their own timestamps without counting receipt as another deduction', () => {
    const child = lot(2, { quantity: 10, weight: 1, transferred_at: at(11), received_at: null, status: 'voided', voided_at: at(15), on_hand_quantity: null, on_hand_weight: null,
      history: [event(1, 'created', 11, 20), event(2, 'updated', 12, 35), event(3, 'updated', 13, 10), event(4, 'voided', 15)] })
    const model = traceFlowModel([lot(1), child], at(17))
    expect(model.byId.get('1')?.stays.map(stay => stay.quantity)).toEqual([100, 80, 65, 90, 100])
    expect(model.byId.get('1')?.stays.at(-1)).toMatchObject({ start: stamp(15), end: stamp(17), current: true })
    expect(model.byId.get('2')?.stays).toEqual([])
  })
  it('leaves a real empty gap when all stock was dispatched and later restored by void', () => {
    const child = lot(2, { transferred_at: at(11), status: 'voided', received_at: null, voided_at: at(14), on_hand_quantity: null, on_hand_weight: null })
    const stays = traceFlowModel([lot(1), child], at(17)).byId.get('1')!.stays
    expect(stays.map(stay => [stay.start, stay.end])).toEqual([[stamp(10), stamp(11)], [stamp(14), stamp(17)]])
  })
  it('deducts losses including weight-only scrap without inventing pieces', () => {
    const root = lot(1, { quantity: 0, weight: 10, on_hand_quantity: 0, on_hand_weight: 9.875,
      loss_records: [{ id: 1, loss_no: 'LOSS', source_transfer_id: 1, batch_no: 'TL-1', serial_no: '000012', material_name: null, quantity: 0, weight: .125, reason: '称重损耗', created_by: '测试', created_at: at(12), team_id: 1 }] })
    const node = traceFlowModel([root], at(17)).byId.get('1')!
    expect(node.residenceIssue).toBe(false)
    expect(node.stays.map(stay => [stay.quantity, stay.weight])).toEqual([[0, 10], [0, 9.875]])
  })
  it('keeps returned and original lots separate within the same team and branches from the source track', () => {
    const root = lot(1, { on_hand_quantity: 60, on_hand_weight: 6 })
    const child = lot(2, { quantity: 40, weight: 4, transferred_at: at(11), received_at: at(12), on_hand_quantity: 30, on_hand_weight: 3 })
    const returned = lot(3, { source_transfer_id: 2, source_team: rolling, next_team: warehouse, quantity: 10, weight: 1, transferred_at: at(13), received_at: at(14), on_hand_quantity: 10, on_hand_weight: 1 })
    const model = traceFlowModel([root, child, returned], at(17))
    expect(model.byId.get('1')?.targetOffset).not.toBe(model.byId.get('3')?.targetOffset)
    expect(model.byId.get('2')?.sourceOffset).toBe(model.byId.get('1')?.targetOffset)
    expect(model.byId.get('3')?.sourceOffset).toBe(model.byId.get('2')?.targetOffset)
    expect(model.nodes.every(node => !node.residenceIssue)).toBe(true)
  })
  it('does not stretch exhausted history to today or invent balance history for inconsistent legacy imports', () => {
    const root = lot(1, { on_hand_quantity: 0, on_hand_weight: 0 })
    const child = lot(2, { transferred_at: at(11), status: 'dispatched', entry_kind: 'warehouse_outbound', received_at: null, dispatched_at: at(12), on_hand_quantity: null, on_hand_weight: null })
    const model = traceFlowModel([root, child], at(20))
    expect(model.last).toBe(stamp(12))
    expect(model.ongoing).toBe(false)
    expect(model.byId.get('1')?.stays).toEqual([{ start: stamp(10), end: stamp(11), quantity: 100, weight: 10, current: false }])
    const invalid = traceFlowModel([lot(1, { on_hand_quantity: 999 })], at(17)).nodes[0]!
    expect(invalid.residenceIssue).toBe(true)
    expect(invalid.stays).toEqual([])
  })
  it('changes date labels to minute/second detail on zoom without changing event timestamps', () => {
    const model = traceFlowModel([lot(1)], at(17))
    const axis = (zoom: number) => (traceFlowOption(model, 'weight', '', false, 'select', zoom).xAxis as Array<{ axisLabel: { formatter: (at: number) => string } }>)[0]!
    expect(axis(100).axisLabel.formatter(stamp(12))).toBe('09-12')
    expect(axis(100)).toMatchObject({ minInterval: 86400000 })
    expect(axis(10000).axisLabel.formatter(stamp(12, 9))).toBe('09:00')
    expect(axis(10000000).axisLabel.formatter(stamp(12, 9))).toBe('09:00:00')
    expect(traceDuration(stamp(10), stamp(12, 14))).toBe('2 天 6 小时')
    const zoom = traceFlowOption(model, 'weight').dataZoom as Array<{ id: string; minSpan: number }>
    expect(zoom.find(item => item.id === 'time')!.minSpan).toBeLessThan(.001)
  })
  it('shows hovered interval amounts and current balance together instead of mistaking one for the other', () => {
    const root = lot(1, { on_hand_quantity: 70, on_hand_weight: 7 })
    const child = lot(2, { quantity: 30, weight: 3, transferred_at: at(12), status: 'pending', received_at: null, on_hand_quantity: null, on_hand_weight: null })
    const model = traceFlowModel([root, child], at(17))
    const tooltip = traceFlowOption(model, 'weight').tooltip as { formatter: (params: unknown) => string; triggerOn: string }
    expect(tooltip.triggerOn).toBe('mousemove')
    expect(tooltip.formatter({ dataIndex: 0, seriesId: 'residence-bars' })).toContain('本段结存 100 件 / 10 kg')
    expect(tooltip.formatter({ dataIndex: 0, seriesId: 'residence-bars' })).toContain('当前结存 70 件 / 7 kg')
    expect(tooltip.formatter({ dataIndex: 1, seriesId: 'residence-bars' })).toContain('本段结存 70 件 / 7 kg')
    expect(tooltip.formatter({ dataIndex: 1 })).toContain('接收 未记录')
  })
  it('escapes batch and note text before displaying HTML hover details', () => {
    const model = traceFlowModel([lot(1, { notes: '<img src=x onerror="alert(1)">' })], at(17))
    const tooltip = traceFlowOption(model, 'weight').tooltip as { formatter: (params: unknown) => string }
    const html = tooltip.formatter({ dataIndex: 0 })
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).not.toContain('<img')
  })
})

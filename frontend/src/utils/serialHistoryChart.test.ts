import { describe, expect, it } from 'vitest'
import { serialHistoryChart, historyTimeline, historyEventAt, purposeColors } from './serialHistoryChart'
import type { SerialHistoryGroup } from '@/types/teamBusiness'
import type { EChartsOption, LineSeriesOption } from 'echarts'

export const historyGroup = (name = '检验'): SerialHistoryGroup => ({
  key: name, name, purpose_id: 1, incoming_quantity: 100, incoming_weight: 10,
  outgoing_quantity: 40, outgoing_weight: 4, lost_quantity: 1, lost_weight: .1,
  on_hand_quantity: 59, on_hand_weight: 5.9, baseline_quantity: 100, baseline_weight: 10,
  events: [
    { id: 'event-1', at: '2026-09-18T01:00:00Z', kind: 'outgoing', batch_no: 'TL1', source_batch_no: 'TL0', counterpart: '发货', material_type: 'finished', source_material_type: 'semi_finished', quantity: 40, weight: 4, delta_quantity: -40, delta_weight: -4, balance_quantity: 60, balance_weight: 6, status: 'pending' },
    { id: 'loss-1', at: '2026-09-18T02:00:00Z', kind: 'loss', batch_no: 'TL0', source_batch_no: 'TL0', counterpart: '<img onerror=alert(1)>', material_type: 'semi_finished', source_material_type: 'semi_finished', quantity: 1, weight: .1, delta_quantity: -1, delta_weight: -.1, balance_quantity: 59, balance_weight: 5.9, status: 'received' },
  ],
})

describe('purpose receipt/dispatch charts', () => {
  const lines = (option: EChartsOption) => option.series as LineSeriesOption[]
  const values = (series: LineSeriesOption) => series.data!.map(point => (point as { value: number }).value)
  it('keeps quantities and weights separate and preserves baseline balances', () => {
    const quantity = serialHistoryChart([historyGroup()], 'quantity')
    const weight = serialHistoryChart([historyGroup()], 'weight')
    expect(values(lines(quantity)[0]!)).toEqual([100, 60, 59])
    expect(values(lines(weight)[0]!)).toEqual([10, 6, 5.9])
    expect(lines(quantity)[0]!.step).toBe('end')
    expect(quantity.tooltip).toMatchObject({ renderMode: 'richText' })
  })
  it('represents opening stock and returned deductions without inventing processing states', () => {
    const group = historyGroup()
    group.events = [{ ...group.events[0]!, kind: 'opening', delta_quantity: 100, balance_quantity: 100 }, { ...group.events[0]!, kind: 'voided', delta_quantity: 40, balance_quantity: 100 }]
    const result = serialHistoryChart([group], 'quantity')
    expect(values(lines(result)[0]!)).toEqual([100, 100, 100])
  })
  it('draws all purposes on one timeline and only real event nodes open details', () => {
    const a = historyGroup(), b = historyGroup('去毛刺')
    b.events = [{ ...b.events[0]!, id: 'event-3', at: '2026-09-18T01:30:00Z', balance_quantity: 80 }]
    const option = serialHistoryChart([a, b], 'quantity')
    expect(lines(option)).toHaveLength(2)
    expect(values(lines(option)[0]!)).toEqual([100, 60, 60, 59])
    expect(values(lines(option)[1]!)).toEqual([100, 100, 80, 80])
    expect(historyEventAt([a, b], 0, 2)).toBeUndefined()
    expect(historyEventAt([a, b], 1, 2)?.id).toBe('event-3')
    expect(lines(option)[0]!.lineStyle?.color).not.toBe(lines(option)[1]!.lineStyle?.color)
    expect(lines(serialHistoryChart([a, b], 'quantity', b.key))[0]!.lineStyle?.opacity).toBe(.12)
  })
  it('retains same-second events in numeric order and dates are not falsified', () => {
    const group = historyGroup()
    group.events = [10, 2].map(id => ({ ...group.events[0]!, id: `event-${id}` }))
    const points = historyTimeline([group])
    expect(points.map(point => point.event.id)).toEqual(['event-2', 'event-10'])
    expect(points[0]!.event.at).toBe(points[1]!.event.at)
    expect(purposeColors([group, historyGroup('去毛刺')])).toEqual(purposeColors([historyGroup('去毛刺'), group]))
  })
})

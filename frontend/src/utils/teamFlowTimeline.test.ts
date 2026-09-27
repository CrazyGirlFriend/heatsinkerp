import { describe, expect, it } from 'vitest'
import { teamTimelineModel, teamTimelineOption } from './teamFlowTimeline'
import type { SerialHistory } from '@/types/teamBusiness'
import snapshot from '@/fixtures/flowPurposeSnapshot.json'
import type { CustomSeriesOption } from 'echarts'

const data = () => structuredClone(snapshot.history) as SerialHistory
describe('team batch timeline', () => {
  it('makes one track per received batch and attaches every deduction to its actual source', () => {
    const model = teamTimelineModel(data())
    expect(model.rows).toHaveLength(3)
    expect(model.rows.reduce((sum, row) => sum + row.lot.closing_quantity, 0)).toBe(153)
    expect(model.rows.reduce((sum, row) => sum + row.lot.closing_weight, 0)).toBe(19.125)
    for (const node of model.nodes.filter(node => node.event)) {
      expect(node.event!.source_batch_no).toBe(model.rows[node.row]!.lot.batch_no)
    }
  })
  it('does not merge two received batches of the same purpose', () => {
    const h = data(), first = h.groups[0]!.events.find(event => event.kind === 'incoming')!
    h.groups[0]!.events.push({ ...first, id: 'receipt-999', batch_no: 'SECOND', source_batch_no: 'SECOND' })
    const model = teamTimelineModel(h)
    expect(model.rows).toHaveLength(4)
    expect(model.rows.filter(row => row.name === h.groups[0]!.name)).toHaveLength(2)
    expect(model.rows.find(row => row.lot.batch_no === 'SECOND')!.events).toHaveLength(1)
  })
  it('uses server lot balances for a filtered period without pretending today is the period end', () => {
    const h = data(), lot = teamTimelineModel(h).rows[0]!.lot
    h.lots = [{ ...lot, on_hand_quantity: 0, on_hand_weight: 0, baseline_quantity: 60, baseline_weight: 7.5, closing_quantity: 50, closing_weight: 6.25 }]
    h.groups.forEach(group => { group.events = [] })
    h.date_from = '2026-09-19'; h.date_to = '2026-09-19'; h.closing_at = '2026-09-19T16:00:00Z'
    const row = teamTimelineModel(h).rows[0]!
    expect(row.beforeRange).toBe(true)
    expect(row.lot.closing_quantity).toBe(50)
    expect(row.lot.on_hand_quantity).toBe(0)
    expect(row.end).toBe(Date.parse(h.closing_at))
    const model = teamTimelineModel(h)
    const series = (teamTimelineOption(model).series as CustomSeriesOption[])[0]!
    const graphic = series.renderItem!({ dataIndex: 0, context: {}, coordSys: { x: 0, y: 0, width: 1000, height: 500 } } as never,
      { coord: ([at, lane]: number[]) => [(at! - model.first!) / model.span * 950, 80 + lane! * 100] } as never)
    expect(JSON.stringify(graphic)).toContain('所选时间开始时未转出')
    expect(JSON.stringify(graphic)).toContain('60 件 / 7.5 kg')
    expect(JSON.stringify(graphic)).toContain('opening-cap')
  })
  it('keeps weight-only lots and stops exhausted lots at their last event', () => {
    const h = data(), lots = teamTimelineModel(h).rows.map(row => row.lot)
    h.lots = [{ ...lots[0]!, closing_quantity: 0, closing_weight: 1.25 }, { ...lots[1]!, closing_quantity: 0, closing_weight: 0 }]
    h.closing_at = '2026-09-19T16:00:00Z'
    const model = teamTimelineModel(h)
    expect(model.rows).toHaveLength(2)
    const weight = model.rows.find(row => row.lot.closing_weight === 1.25)!
    const empty = model.rows.find(row => row.lot.closing_weight === 0)!
    expect(weight.end).toBe(Date.parse(h.closing_at))
    expect(empty.end).toBe(Date.parse(empty.lot.last_event_at))
  })
  it('separates simultaneous points vertically, never by fabricating time', () => {
    const h = data(), group = h.groups.find(g => g.events.some(e => e.kind === 'outgoing'))!
    const event = group.events.find(e => e.kind === 'outgoing')!
    group.events.push({ ...event, id: 'event-999' })
    const nodes = teamTimelineModel(h).nodes.filter(node => node.event?.id === event.id || node.event?.id === 'event-999')
    expect(nodes).toHaveLength(2)
    expect(nodes[0]!.at).toBe(nodes[1]!.at)
    expect(nodes[0]!.offset).not.toBe(nodes[1]!.offset)
  })
  it('does not invent source tracks for orphan events or draw invalid timestamps', () => {
    const h = data()
    h.groups.forEach(group => { group.events = group.events.filter(event => event.kind !== 'incoming') })
    expect(teamTimelineModel(h).rows).toHaveLength(0)
    expect(teamTimelineModel({ ...data(), lots: [] }).extent).toBeNull()
  })
  it('uses stable custom series, both units and wheel zoom with an independent pan mode', () => {
    const model = teamTimelineModel(data())
    const option = teamTimelineOption(model)
    expect(option.series).toEqual([expect.objectContaining({ id: 'team-batch-timeline', type: 'custom' })])
    expect(option.dataZoom).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'time', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: false })]))
    expect(teamTimelineOption(model, '', 'pan').series).toEqual([expect.objectContaining({ silent: true })])
  })
  it('shows actual receipt batch IDs, directional wording and owned balances in separate columns', () => {
    const h = data(), lots = teamTimelineModel(h).rows.map(row => row.lot)
    h.lots = [{ ...lots[0]!, from_name: '库房', owned_quantity: 30, owned_weight: 3.75, on_hand_quantity: 0, on_hand_weight: 0 }]
    const model = teamTimelineModel(h)
    const series = (teamTimelineOption(model).series as CustomSeriesOption[])[0]!
    const graphic = series.renderItem!({ dataIndex: 0, context: {}, coordSys: { x: 220, y: 48, width: 600, height: 500 } } as never,
      { coord: ([at, lane]: number[]) => [240 + (at! - model.first!) / model.span * 540, 120 + lane! * 150] } as never)
    const content = JSON.stringify(graphic)
    expect(content).toContain(lots[0]!.batch_no)
    expect(content).toContain('从库房接收')
    expect(content).toContain('30 件')
    expect(content).toContain('3.75 kg')
    expect(content).not.toContain('已转完')
    expect(content).not.toContain('库房收进')
  })
  it('never overlaps captions for close handoffs and retains every outgoing event in hover details', () => {
    const h = data(), lot = teamTimelineModel(h).rows[0]!.lot
    const group = h.groups.find(g => g.key === lot.group_key)!
    const incoming = group.events.find(e => e.kind === 'incoming')!
    group.events = [incoming, ...Array.from({ length: 4 }, (_, index) => ({ ...incoming,
      id: `out-${index}`, batch_no: `OUT-${index}`, source_batch_no: lot.batch_no, kind: 'outgoing' as const,
      at: '2026-09-18T08:45:00Z', counterpart: `班组${index + 1}`, quantity: 10, weight: 1,
      delta_quantity: -10, delta_weight: -1, status: 'pending',
    }))]
    h.groups = [group]
    const model = teamTimelineModel(h), option = teamTimelineOption(model)
    const series = (option.series as CustomSeriesOption[])[0]!, context: { labels?: Array<{ x: number; y: number; width: number }> } = {}
    model.nodes.forEach((_, dataIndex) => series.renderItem!({ dataIndex, context, coordSys: { x: 220, y: 48, width: 600, height: 500 } } as never,
      { coord: ([at, lane]: number[]) => [240 + (at! - model.first!) / model.span * 540, 130 + lane! * 150] } as never))
    expect(context.labels!.length).toBeGreaterThanOrEqual(3)
    context.labels!.forEach((label, index) => {
      for (const other of context.labels!.slice(index + 1)) {
        expect(label.x + label.width <= other.x || other.x + other.width <= label.x || Math.abs(label.y - other.y) >= 24).toBe(true)
      }
    })
    const tooltip = option.tooltip as { formatter: (params: { dataIndex: number }) => string }
    model.nodes.forEach((node, dataIndex) => {
      if (node.event) expect(tooltip.formatter({ dataIndex })).toContain(`转给${node.event.counterpart}`)
    })
  })
  it('labels piece adjustments and signed changes accurately instead of presenting them as shipments', () => {
    const h = data(), group = h.groups[0]!, incoming = group.events.find(e => e.kind === 'incoming')!
    group.events.push({ ...incoming, id: 'adjust-pieces', kind: 'quantity_changed', delta_quantity: -3, delta_weight: 0, quantity: 3, weight: 0 })
    const model = teamTimelineModel(h), option = teamTimelineOption(model)
    const tooltip = option.tooltip as { formatter: (params: { dataIndex: number }) => string }
    const content = tooltip.formatter({ dataIndex: model.nodes.findIndex(node => node.id === 'adjust-pieces') })
    expect(content).toContain('加工件数调整')
    expect(content).toContain('-3 件 · 重量不变')
    expect(content).not.toContain('转给')
  })
})

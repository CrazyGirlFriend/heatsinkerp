import { describe, expect, it } from 'vitest'
import type { SankeySeriesOption, CustomSeriesOption, CustomSeriesRenderItemParams, CustomSeriesRenderItemAPI } from 'echarts'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { TraceBatch } from '@/types/materialTrace'
import type { SerialHistory, SerialHistoryFlow, SerialHistoryGroup } from '@/types/teamBusiness'
import { teamFlowModel, teamFlowOption, traceFlowModel, traceRelated, traceFlowOption, traceTimestamp, traceTime, traceDuration } from './flowPreview'

function group(key: string, name: string): SerialHistoryGroup {
  return { key, name, purpose_id: 1, incoming_quantity: 100, incoming_weight: 10, outgoing_quantity: 30, outgoing_weight: 3, on_hand_quantity: 68, on_hand_weight: 6.8, lost_quantity: 2, lost_weight: .2, baseline_quantity: 0, baseline_weight: 0, events: [] }
}
function flow(id: string, direction: 'incoming' | 'outgoing', groupKey = 'a'): SerialHistoryFlow {
  return { id, group_key: groupKey, direction, batch_no: id, at: '2026-09-19T01:00:00Z', from_name: direction === 'incoming' ? '电镀' : '检验', to_name: direction === 'incoming' ? '检验' : '库房', status: direction === 'incoming' ? 'received' : 'pending', entry_kind: 'transfer', quantity: direction === 'incoming' ? 100 : 30, weight: direction === 'incoming' ? 10 : 3 }
}
function history(): SerialHistory {
  return { serial_no: '000012', team_name: '检验', found: true, date_from: null, date_to: null, untracked_count: 0, pending_incoming_count: 1, groups: [group('a', '检验'), group('b', '去毛刺')], flows: [flow('1', 'incoming'), flow('2', 'outgoing'), flow('3', 'incoming', 'b'), flow('4', 'outgoing', 'b')] }
}
function batch(id: number, parent: number | null = null, team = 1): TraceBatch {
  return { ...normalizeMaterialTransfer({ id, batch_no: `B${id}`, serial_no: '000012', source_transfer_id: parent, next_team: { id: team, name: `班组${team}` }, entry_kind: parent ? 'transfer' : 'warehouse_receipt', quantity: 10, weight: 1, status: 'received', created_at: '2026-09-19T00:00:00Z' }), on_hand_quantity: 4, on_hand_weight: .4 }
}

describe('ECharts flow preview data', () => {
  it('conserves both measures at each purpose and counts pending outbound as transferred, not stock', () => {
    const model = teamFlowModel(history())
    for (const node of model.nodes.filter(node => node.depth === 1)) {
      for (const metric of ['quantity', 'weight'] as const) {
        const input = model.links.filter(link => link.target === node.name).reduce((sum, link) => sum + link[metric], 0)
        const output = model.links.filter(link => link.source === node.name).reduce((sum, link) => sum + link[metric], 0)
        expect(output).toBeCloseTo(input)
        expect(node[metric]).toBe(input)
      }
    }
    expect(model.nodes.find(node => node.name === 'stock')).toMatchObject({ quantity: 136, weight: 13.6 })
    expect(model.nodes.find(node => node.title === '库房 · 待确认')).toMatchObject({ quantity: 60, weight: 6 })
    expect(model.nodes.filter(node => node.depth === 1).map(node => node.color)[0]).not.toBe(model.nodes.filter(node => node.depth === 1).map(node => node.color)[1])
  })
  it('uses effective flows instead of audit events and keeps voided transfers out of flow widths', () => {
    const data = history()
    data.flows.push({ ...flow('void', 'outgoing'), status: 'voided', quantity: 900 })
    const model = teamFlowModel(data)
    expect(model.links.some(link => link.batches.includes('void'))).toBe(false)
    expect(model.nodes.find(node => node.depth === 0)?.quantity).toBe(200)
    expect(model.nodes.find(node => node.name === 'stock')?.batches).toEqual(['1', '3'])
  })
  it('supports weight-only scrap without inventing pieces and retains true counts in tooltips', () => {
    const data = history()
    data.groups = [{ ...group('a', '废屑'), incoming_quantity: 0, outgoing_quantity: 0, on_hand_quantity: 0, lost_quantity: 0 }]
    data.flows = [flow('1', 'incoming'), flow('2', 'outgoing')].map(row => ({ ...row, quantity: 0 }))
    const model = teamFlowModel(data)
    const weight = (teamFlowOption(model, 'weight').series as SankeySeriesOption[])[0]!
    const quantity = (teamFlowOption(model, 'quantity').series as SankeySeriesOption[])[0]!
    expect(weight.links).toHaveLength(4)
    expect(quantity.links).toHaveLength(0)
    expect(weight.links?.[0]).toMatchObject({ value: 10, quantity: 0, weight: 10 })
  })
  it('separates an upstream and downstream team even with the same name, avoiding Sankey cycles', () => {
    const data = history()
    data.flows[1]!.to_name = '电镀'
    const nodes = teamFlowModel(data).nodes.filter(node => node.title.startsWith('电镀'))
    expect(nodes).toHaveLength(2)
    expect(nodes[0]?.name).not.toBe(nodes[1]?.name)
  })
  it('preserves real batch ancestry, split branches and repeated-team returns, without connecting orphan lots', () => {
    const model = traceFlowModel([batch(4, 2, 1), batch(3, 1, 3), batch(1), batch(2, 1, 2), batch(5, 999, 3)])
    expect(model.nodes).toHaveLength(5)
    expect(model.byId.get('4')?.depth).toBe(2)
    expect(model.byId.get('5')).toMatchObject({ depth: 0, detached: true })
    expect(model.byId.get('2')?.lane).not.toBe(model.byId.get('3')?.lane)
    expect([...traceRelated(model, '2')].sort()).toEqual(['1', '2', '4'])
    expect(model.nodes.filter(node => node.batch.next_team.id === 1)).toHaveLength(2)
  })
  it('uses independently zoomable axes, keeps both units in original records and does not sum transfers as stock', () => {
    const model = traceFlowModel([batch(1), { ...batch(2, 1), status: 'pending' }])
    const option = traceFlowOption(model, 'weight')
    expect(option.dataZoom).toHaveLength(3)
    expect(model.nodes.reduce((sum, node) => sum + node.batch.quantity, 0)).toBe(20)
    expect(model.nodes[0]?.batch.serial_no).toBe('000012')
    expect(option.tooltip).toMatchObject({ renderMode: 'html' })
  })
  it('positions events by their real timestamps, including UTC-offset equivalents, instead of depth', () => {
    const root = { ...batch(1), received_at: '2026-09-17T00:00:00Z' }
    const child = { ...batch(2, 1), transferred_at: '2026-09-18T08:00:00+08:00', received_at: '2026-09-18T01:00:00Z' }
    const model = traceFlowModel([child, root])
    expect(model.byId.get('2')?.startedAt).toBe(Date.parse('2026-09-18T00:00:00Z'))
    expect(model.byId.get('2')!.startedAt! - model.byId.get('1')!.startedAt!).toBe(86400000)
    expect(model.teams.slice(0, 8)).toEqual(['库房', '轧制', '退火', '研磨', '线切割', '雕刻', '电镀', '检验'])
    expect(traceTimestamp('2026-09-18T00:00:00')).toBe(traceTimestamp('2026-09-18T08:00:00+08:00'))
    expect(traceTime(model.byId.get('2')!.startedAt)).toBe('2026-09-18 08:00:00')
    const option = traceFlowOption(model, 'quantity')
    expect(option.xAxis).toMatchObject([{ type: 'time', position: 'top' }, { type: 'time', position: 'bottom' }])
    expect(option.dataZoom).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'time', zoomOnMouseWheel: true, moveOnMouseMove: false, filterMode: 'none' }), expect.objectContaining({ id: 'time-slider', type: 'slider' })]))
  })
  it('does not invent receipt timestamps for pending batches or silently fix invalid history', () => {
    const model = traceFlowModel([
      { ...batch(1), status: 'pending', entry_kind: 'transfer', received_at: '2026-09-19T02:00:00Z' },
      { ...batch(2, 1), received_at: '2026-09-18T00:00:00Z' },
      { ...batch(3, 1), transferred_at: '', received_at: null },
    ])
    expect(model.byId.get('1')?.finishedAt).toBeNull()
    expect(model.byId.get('2')).toMatchObject({ finishedAt: null, timingIssue: true })
    expect(model.byId.get('3')).toMatchObject({ startedAt: null, finishedAt: null, timingIssue: true })
    expect(traceFlowModel([{ ...batch(4), transferred_at: '', received_at: null }]).extent).toBeNull()
    expect(traceTimestamp('not-a-time')).toBeNull()
  })
  it('keeps simultaneous batch events separately selectable without changing their dates', () => {
    const one = { ...batch(2, 1), received_at: '2026-09-19T01:00:00Z' }
    const two = { ...batch(3, 1), received_at: one.received_at }
    const model = traceFlowModel([one, two])
    expect(model.byId.get('2')?.finishedAt).toBe(model.byId.get('3')?.finishedAt)
    expect(model.byId.get('2')?.targetLane).toBe(model.byId.get('3')?.targetLane)
    expect(model.byId.get('2')?.targetOffset).not.toBe(model.byId.get('3')?.targetOffset)
    expect(model.nodes).toHaveLength(2)
  })
  it('keeps return flow chronological and uses dispatch confirmation for external deliveries', () => {
    const rows = [batch(1), { ...batch(2, 1, 2), received_at: '2026-09-19T01:00:00Z' }, { ...batch(3, 2, 1), transferred_at: '2026-09-19T02:00:00Z', received_at: '2026-09-19T03:00:00Z' }, { ...batch(4, 2), entry_kind: 'inspection_shipment' as const, status: 'dispatched' as const, transferred_at: '2026-09-19T04:00:00Z', dispatched_at: '2026-09-19T05:00:00Z' }]
    const model = traceFlowModel(rows)
    expect(model.byId.get('3')!.finishedAt!).toBeGreaterThan(model.byId.get('2')!.finishedAt!)
    expect(model.byId.get('3')?.targetLane).toBe(model.byId.get('1')?.targetLane)
    expect(model.byId.get('4')?.finishedAt).toBe(traceTimestamp(rows[3]!.dispatched_at))
    expect(traceDuration(model.byId.get('4')!.startedAt, model.byId.get('4')!.finishedAt)).toBe('1 小时')
    expect(traceDuration(null, 0)).toBe('—')
  })
  it('keeps team labels on integer lanes and exposes distinct ticks for sub-second events', () => {
    const model = traceFlowModel([{ ...batch(1), received_at: '2026-09-19T00:00:00.100Z' }, { ...batch(2, 1), transferred_at: '2026-09-19T00:00:00.150Z', received_at: '2026-09-19T00:00:00.300Z' }])
    const option = traceFlowOption(model, 'weight')
    expect(model.span).toBe(200)
    expect(option.xAxis).toMatchObject([{ type: 'value', minInterval: 1 }, { type: 'value', minInterval: 1 }])
    expect(option.yAxis).toMatchObject({ min: -.5, max: model.teams.length - .5, interval: 1 })
    expect((option.series as CustomSeriesOption[]).find(series => series.id === 'team-lanes')?.data).toHaveLength(model.teams.length)
    expect(traceTime(model.first)).toBe('2026-09-19 08:00:00.100')
    expect(option.dataZoom).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'time-slider', handleIcon: 'circle', handleSize: 20 })]))
  })
  it('separates pan and selection without disabling pointer-centered wheel zoom', () => {
    const model = traceFlowModel([batch(1)])
    const option = traceFlowOption(model, 'quantity', '', true, 'pan')
    expect(option.dataZoom).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'time', moveOnMouseMove: true, zoomOnMouseWheel: true })]))
    expect(option.series).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'batch-paths', silent: true }), expect.objectContaining({ id: 'team-lanes', silent: true })]))
    expect(option.tooltip).toMatchObject({ show: false })
  })
  it('uses stable batch and child identities for incremental animation and purposeful hover feedback', () => {
    const rows = [{ ...batch(1), received_at: '2026-09-19T00:00:00Z' }, { ...batch(2, 1), source_team: batch(1).next_team, transferred_at: '2026-09-19T00:00:00.100Z', received_at: '2026-09-19T00:00:00.200Z' }]
    const render = (items: TraceBatch[], selection = '') => {
      const model = traceFlowModel(items), series = (traceFlowOption(model, 'weight', selection).series as CustomSeriesOption[])[0]!
      const group = series.renderItem!({ dataIndex: model.nodes.findIndex(node => node.batch.id === 2), context: {}, coordSys: { type: 'cartesian2d', x: 0, y: 0, width: 1200, height: 800 } } as unknown as CustomSeriesRenderItemParams, { coord: (values: number[]) => [(values[0]! - model.first!) * 2, 90 + values[1]! * 60] } as CustomSeriesRenderItemAPI)
      if (!group || group.type !== 'group') throw new Error('Expected a batch group')
      return { group, children: group.children, series }
    }
    const before = render(rows), selected = render(rows, '2')
    expect(before.group).toMatchObject({ name: '2', $mergeChildren: 'byName' })
    expect(before.series.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: '2', name: 'B2' })]))
    expect(before.children.find(child => child.name === 'transfer')).toMatchObject({ type: 'polyline', style: { lineWidth: 2, strokePercent: 1, enterFrom: { strokePercent: 0 } }, emphasis: { style: { lineWidth: 3.2, opacity: 1 } } })
    expect(selected.children.map(child => child.name)).toEqual(before.children.map(child => child.name))
    expect(selected.children.find(child => child.name === 'transfer')).toMatchObject({ style: { lineWidth: 3 } })
    const changed = render([rows[0]!, { ...rows[1]!, weight: 2 }])
    expect(changed.children.find(child => child.name === 'transfer')?.name).toBe('transfer')
    expect(changed.children.some(child => child.name === 'amount:10:2')).toBe(true)
    expect(changed.children.some(child => child.name === 'amount:10:1')).toBe(false)
  })
})

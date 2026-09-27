import type { CustomSeriesOption, CustomSeriesRenderItemReturn, EChartsOption } from 'echarts'
import type { SerialHistory, SerialHistoryEvent, SerialHistoryLot } from '@/types/teamBusiness'
import { amountLabel, traceTime, traceTimestamp, type FlowInteraction } from './flowPreview'
import { historyNumber as num, historyTimeline, purposeColors } from './serialHistoryChart'
import { isExternalEntryKind, materialTransferStatusLabel } from '@/types/materialTransfer'

const font = '"PingFang SC", "Microsoft YaHei", sans-serif'
const amount = (quantity: number, weight: number) => amountLabel({ quantity, weight })
const hasStock = (quantity: number, weight: number) => quantity !== 0 || Math.abs(weight) > .0000001
const dayStart = (day: string | null) => day ? Date.parse(`${day}T00:00:00+08:00`) : null

function receiptTitle(row: TeamTimelineModel['rows'][number]) {
  if (row.beforeRange) return '所选时间开始时未转出'
  if (row.events.some(event => event.kind === 'opening')) return '初始库存登记'
  return row.lot.from_name ? `从${row.lot.from_name}接收` : '接收 · 来源未记录'
}
function eventTitle(event: SerialHistoryEvent) {
  if (event.kind === 'loss') return '登记丢失'
  if (event.kind === 'voided') return '作废退回'
  if (event.kind === 'adjusted') return '转出改量'
  if (event.kind === 'quantity_changed') return '加工件数调整'
  return `${isExternalEntryKind(event.entry_kind) ? '发往' : '转给'}${event.counterpart || '未记录去向'}`
}
function eventAmount(event: SerialHistoryEvent) {
  const signed = (value: number) => `${value > 0 ? '+' : ''}${num(value)}`
  if (event.kind === 'quantity_changed') return `${signed(event.delta_quantity)} 件 · 重量不变`
  if (['adjusted', 'voided'].includes(event.kind)) return `${signed(event.delta_quantity)} 件 / ${signed(event.delta_weight)} kg`
  return amount(event.quantity, event.weight)
}

// Old read-only snapshots predate per-lot balances. Reconstruct only recorded
// receipts and their own audit deltas, never distribute a purpose total to lots.
function snapshotLots(history: SerialHistory): SerialHistoryLot[] {
  const entries = historyTimeline(history.groups), lots = new Map<string, SerialHistoryLot>()
  for (const { event, groupKey } of entries) {
    if (!['incoming', 'opening'].includes(event.kind)) continue
    lots.set(event.batch_no, { batch_no: event.batch_no, group_key: groupKey, received_at: event.at,
      from_name: event.counterpart, quantity: event.quantity, weight: event.weight,
      on_hand_quantity: 0, on_hand_weight: 0, baseline_quantity: 0, baseline_weight: 0,
      closing_quantity: 0, closing_weight: 0, last_event_at: event.at })
  }
  for (const { event } of entries) {
    const lot = lots.get(event.source_batch_no)
    if (!lot) continue
    lot.closing_quantity += event.delta_quantity; lot.closing_weight += event.delta_weight
    lot.on_hand_quantity = lot.closing_quantity; lot.on_hand_weight = lot.closing_weight
    lot.last_event_at = event.at
  }
  return [...lots.values()]
}

export function teamTimelineModel(history: SerialHistory) {
  const entries = historyTimeline(history.groups), start = dayStart(history.date_from)
  const stamps = entries.flatMap(({ event }) => { const at = traceTimestamp(event.at); return at === null ? [] : [at] })
  const closing = traceTimestamp(history.closing_at) ?? (stamps.length ? Math.max(...stamps) : null)
  const colors = purposeColors(history.groups)
  const rows = (history.lots || snapshotLots(history)).flatMap(lot => {
    const received = traceTimestamp(lot.received_at)
    if (received === null || closing === null || received > closing) return []
    const events = entries.filter(({ event }) => event.source_batch_no === lot.batch_no).map(({ event }) => event)
    const last = traceTimestamp(lot.last_event_at) ?? received
    if (start !== null && !events.length && !hasStock(lot.baseline_quantity, lot.baseline_weight)) return []
    const end = hasStock(lot.closing_quantity, lot.closing_weight) ? closing : Math.min(closing, last)
    const begin = Math.max(received, start ?? received)
    if (end < begin) return []
    const group = history.groups.find(item => item.key === lot.group_key)
    return [{ lot, events, begin, end, received, beforeRange: begin > received,
      name: group?.name || '未分类', color: colors.get(lot.group_key) || '#8b80be' }]
  }).sort((a, b) => history.groups.findIndex(g => g.key === a.lot.group_key) - history.groups.findIndex(g => g.key === b.lot.group_key)
    || a.received - b.received || a.lot.batch_no.localeCompare(b.lot.batch_no))
  const nodes: Array<{ id: string; row: number; at: number; end: number; event?: SerialHistoryEvent; offset: number }> = []
  rows.forEach((row, index) => {
    nodes.push({ id: `lot:${row.lot.batch_no}`, row: index, at: row.begin, end: row.end, offset: 0 })
    const simultaneous = new Map<number, number>()
    for (const event of row.events) {
      const at = traceTimestamp(event.at)
      if (at === null || ['incoming', 'opening'].includes(event.kind)) continue
      const slot = simultaneous.get(at) || 0; simultaneous.set(at, slot + 1)
      nodes.push({ id: event.id, row: index, at, end: at, event, offset: .31 + Math.min(slot, 4) * .065 })
    }
  })
  const first = rows.length ? Math.min(...rows.map(row => row.begin)) : null
  const last = rows.length ? Math.max(...rows.map(row => row.end), ...stamps) : null
  const span = first !== null && last !== null ? Math.max(1, last - first) : 1
  const pad = Math.max(span * .035, span < 1000 ? 1 : 1000)
  return { rows, nodes, first, last, span, closing, extent: first === null || last === null ? null : [first - pad, last + pad] }
}
export type TeamTimelineModel = ReturnType<typeof teamTimelineModel>

export function teamTimelineOption(model: TeamTimelineModel, selected = '', interaction: FlowInteraction = 'select', animate = true): EChartsOption {
  const selectedRow = model.nodes.find(node => node.id === selected)?.row
  const visibleRows = Math.min(100, 300 / Math.max(1, model.rows.length))
  const series: CustomSeriesOption = {
    id: 'team-batch-timeline', type: 'custom', name: '本班组收发', silent: interaction === 'pan',
    dimensions: ['时间', '轨道', '库存时间'], encode: { x: [0, 2], y: 1 },
    animationDuration: 900, animationDurationUpdate: 200,
    data: model.nodes.map(node => ({ id: node.id, name: node.id, value: [node.at, node.row, node.end] })),
    renderItem(params, api): CustomSeriesRenderItemReturn {
      const node = model.nodes[params.dataIndex]!, row = model.rows[node.row]!, lot = row.lot
      const grid = params.coordSys as unknown as { x: number; y: number; width: number; height: number }
      const p = api.coord([node.at, node.row]), q = api.coord([node.end, node.row])
      const x = p[0]!, y = p[1]!, right = grid.x + grid.width
      if (y < grid.y || y > grid.y + grid.height) return
      const chosen = node.id === selected, muted = selectedRow !== undefined && node.row !== selectedRow
      const opacity = muted ? .2 : 1, color = node.event?.kind === 'loss' ? '#d64469' : row.color
      const delay = animate ? Math.min(900, (node.at - (model.first || node.at)) / model.span * 700) : 0
      const children: NonNullable<Extract<CustomSeriesRenderItemReturn, { type: 'group' }>['children']> = []
      const stroke = (name: string, points: number[][], dashed = false) => children.push({ name, type: 'polyline',
        shape: { points, smooth: .2 }, style: { stroke: color, fill: 'none', lineWidth: chosen ? 2.8 : 2.1, lineJoin: 'round', lineCap: 'round', lineDash: dashed ? [4, 4] : undefined,
          opacity, strokePercent: 1, ...(animate ? { enterFrom: { strokePercent: 0 } } : {}) },
        emphasis: { style: { lineWidth: 3, opacity: 1 } }, enterAnimation: { duration: animate ? 900 : 0, delay } })
      const point = (name: string, px: number, py: number, filled: boolean) => {
        children.push({ name: `${name}-halo`, type: 'circle', silent: true, shape: { cx: px, cy: py, r: 12 }, style: { fill: color, opacity: chosen ? .1 : 0 }, emphasis: { style: { opacity: .12 } } })
        children.push({ name, type: 'circle', shape: { cx: px, cy: py, r: 6.5 }, style: { fill: filled ? color : '#fff', stroke: color, lineWidth: 2, opacity }, enterAnimation: { duration: 180, delay } })
      }
      const label = (name: string, px: number, candidates: number[], title: string, value: string) => {
        const boxes = (params.context.labels ||= []) as Array<{ x: number; y: number; width: number }>
        const shortTitle = Array.from(title).length > 13 ? Array.from(title).slice(0, 12).join('') + '…' : title
        const text = `${shortTitle}  ${value}`
        const width = Math.min(grid.width - 16, Array.from(text).reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 13 : 7.5), 8))
        px = Math.max(grid.x + 8, Math.min(px, right - width - 8))
        const py = candidates.find(top => top >= grid.y && top + 22 <= grid.y + grid.height
          && !boxes.some(box => px < box.x + box.width + 8 && px + width + 8 > box.x && Math.abs(box.y - top) < 24))
        if (py === undefined) return
        boxes.push({ x: px, y: py, width })
        children.push({ name: `${name}:${value}`, type: 'text', z2: 4, style: { x: px, y: py, text, width, overflow: 'truncate', font: `13px ${font}`, fill: '#34445d', lineHeight: 20, opacity,
          backgroundColor: '#ffffffed', padding: [1, 3],
          ...(animate ? { enterFrom: { opacity: 0 } } : {}) }, enterAnimation: { duration: 220, delay } })
      }
      if (!node.event) {
        children.push({ name: 'batch', type: 'text', style: { x: 14, y: y - 15, text: lot.batch_no, width: grid.x - 36, overflow: 'truncate', font: `500 13px ${font}`, fill: '#24324a', opacity } })
        const outgoing = row.events.filter(event => event.kind === 'outgoing').length
        children.push({ name: 'purpose', type: 'text', silent: true, style: { x: 14, y: y + 10, text: `${row.name}${outgoing ? ` · ${outgoing} 笔转出` : ''}`, width: grid.x - 36, overflow: 'truncate', font: `12px ${font}`, fill: '#76849b', opacity } })
        const ownedQuantity = lot.owned_quantity ?? lot.on_hand_quantity, ownedWeight = lot.owned_weight ?? lot.on_hand_weight
        children.push({ name: 'current-quantity', type: 'text', style: { x: right + 18, y: y - 15, text: `${num(ownedQuantity)} 件`, font: `500 15px ${font}`, fill: hasStock(ownedQuantity, ownedWeight) ? '#327c4d' : '#87948d' } })
        children.push({ name: 'current-weight', type: 'text', style: { x: right + 18, y: y + 10, text: `${num(ownedWeight)} kg`, font: `13px ${font}`, fill: '#76849b' } })
        const separator = api.coord([node.at, node.row + .7])[1]!
        if (separator <= grid.y + grid.height) children.push({ name: 'separator', type: 'line', silent: true, shape: { x1: 12, y1: separator, x2: right + 150, y2: separator }, style: { stroke: '#edf0f5', lineWidth: 1 } })
        const a = Math.max(grid.x, x), b = Math.min(right, q[0]!)
        if (b < a) return { type: 'group', name: node.id, children }
        stroke('retention', [[a, y], [b, y]])
        if (x >= grid.x && x <= right) {
          if (row.beforeRange) stroke('opening-cap', [[x, y - 8], [x, y + 8]])
          else point('received', x, y, true)
          label('receipt', x + 10, [y - 34], receiptTitle(row),
            row.beforeRange ? amount(lot.baseline_quantity, lot.baseline_weight) : amount(lot.quantity, lot.weight))
        }
        if (q[0]! >= grid.x && q[0]! <= right) {
          stroke('balance-cap', [[q[0]!, y - 8], [q[0]!, y + 8]])
        }
      } else if (x >= grid.x && x <= right) {
        const event = node.event
        const nearby = model.nodes.filter(item => item.row === node.row && item.event && item.at <= node.at && Math.abs(api.coord([item.at, node.row])[0]! - x) < 20)
        const slot = nearby.findIndex(item => item.id === node.id)
        const offset = Math.max(node.offset, .36 + Math.min(4, slot) * .07)
        const ey = api.coord([node.at, node.row + offset])[1]!
        if (ey > grid.y + grid.height - 8) return
        const adjusted = ['adjusted', 'voided'].includes(event.kind)
        // Only decorative rounding precedes the point; its x remains the exact event time.
        stroke('branch', [[Math.max(grid.x, x - 14), y], [x - 4, y + 9], [x, ey]], adjusted)
        if (event.kind === 'loss') {
          stroke('loss-a', [[x - 5, ey - 5], [x + 5, ey + 5]])
          stroke('loss-b', [[x - 5, ey + 5], [x + 5, ey - 5]])
        } else point('outbound', x, ey, event.kind === 'voided')
        const rowBottom = Math.min(grid.y + grid.height, api.coord([node.at, node.row + 1])[1]! - 38)
        // Dense handoffs keep their true x positions; only captions move to
        // free bands below the receipt. Hidden captions remain in the tooltip.
        label('event', x + 14, [y + 12, y + 36, y + 60].filter(top => top + 22 <= rowBottom), eventTitle(event), eventAmount(event))
      }
      return { type: 'group', name: node.id, $mergeChildren: 'byName', children }
    },
  }
  return {
    useUTC: true, textStyle: { fontFamily: font },
    grid: { left: 220, right: 170, top: 48, bottom: 48 },
    xAxis: { type: model.span < 1000 ? 'value' : 'time', min: model.extent?.[0], max: model.extent?.[1], minInterval: 1, splitNumber: 4,
      axisLine: { onZero: false, lineStyle: { color: '#dce2ec' } }, axisTick: { show: true },
      axisLabel: { color: '#687b98', fontSize: 13, lineHeight: 20, margin: 15, hideOverlap: true,
        formatter: (value: number) => { const at = traceTime(value); return model.span < 60000 ? at.slice(11) : model.span > 86400000 ? `${at.slice(5, 10)}\n${at.slice(11, 16)}` : at.slice(11, 16) } },
      splitLine: { show: true, lineStyle: { color: '#edf0f6', type: 'dashed' } } },
    yAxis: { type: 'value', min: -.4, max: Math.max(2.65, model.rows.length - .35), inverse: true, interval: 1,
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: false } },
    dataZoom: [
      { id: 'time', type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: false, minSpan: Math.min(.05, 100 / model.span) },
      { id: 'teams', type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: true, start: 0, end: visibleRows, minSpan: 1, maxSpan: visibleRows },
    ],
    tooltip: { show: interaction === 'select', trigger: 'item', confine: true, renderMode: 'richText', backgroundColor: '#fff', borderColor: '#dfe4ee', padding: 16,
      textStyle: { color: '#263651', fontSize: 14, lineHeight: 23 },
      formatter: params => {
        const node = model.nodes[(Array.isArray(params) ? params[0] : params)!.dataIndex]!, row = model.rows[node.row]!, event = node.event
        return event ? `${eventTitle(event)} · ${row.name}\n${event.batch_no}\n${eventAmount(event)}\n${traceTime(node.at)}${event.kind === 'outgoing' ? `\n${materialTransferStatusLabel(event.status, event.entry_kind)}` : ''}\n点击查看批次`
          : `${row.lot.batch_no} · ${row.name}\n${['初始库存', '期初库存'].includes(row.lot.from_name) ? '初始库存登记' : `从${row.lot.from_name || '未记录来源'}接收`} ${amount(row.lot.quantity, row.lot.weight)}\n${traceTime(row.received)}\n所选时间结束时未转出 ${amount(row.lot.closing_quantity, row.lot.closing_weight)}\n当前库存 ${amount(row.lot.owned_quantity ?? row.lot.on_hand_quantity, row.lot.owned_weight ?? row.lot.on_hand_weight)}\n点击查看批次`
      } }, series: [series],
  }
}

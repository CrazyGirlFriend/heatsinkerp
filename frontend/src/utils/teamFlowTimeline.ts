import type { CustomSeriesOption, CustomSeriesRenderItemReturn, EChartsOption } from 'echarts'
import type { SerialHistory, SerialHistoryEvent, SerialHistoryLot } from '@/types/teamBusiness'
import { amountLabel, traceTime, traceTimestamp, type FlowInteraction } from './flowPreview'
import { historyKindNames, historyTimeline, purposeColors } from './serialHistoryChart'

const font = '"PingFang SC", "Microsoft YaHei", sans-serif'
const amount = (quantity: number, weight: number) => amountLabel({ quantity, weight })
const hasStock = (quantity: number, weight: number) => quantity !== 0 || Math.abs(weight) > .0000001
const dayStart = (day: string | null) => day ? Date.parse(`${day}T00:00:00+08:00`) : null

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
  const series: CustomSeriesOption = {
    id: 'team-batch-timeline', type: 'custom', name: '本班组收发', silent: interaction === 'pan',
    dimensions: ['时间', '轨道', '结存时间'], encode: { x: [0, 2], y: 1 },
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
      const label = (name: string, px: number, py: number, title: string, value: string, force = false) => {
        const boxes = (params.context.labels ||= []) as Array<{ x: number; y: number }>
        if (!force && !chosen && boxes.some(box => Math.abs(box.x - px) < 166 && Math.abs(box.y - py) < 48)) return
        boxes.push({ x: px, y: py })
        const shortTitle = Array.from(title).length > 13 ? Array.from(title).slice(0, 12).join('') + '…' : title
        children.push({ name: `${name}:${value}`, type: 'text', z2: 4, style: { x: px, y: py, text: `{title|${shortTitle}}\n${value}`, font: `15px ${font}`, fill: '#283650', lineHeight: 24, opacity,
          backgroundColor: '#ffffffed', padding: [1, 3], rich: { title: { font: `500 16px ${font}`, lineHeight: 24 } },
          ...(animate ? { enterFrom: { opacity: 0 } } : {}) }, enterAnimation: { duration: 220, delay } })
      }
      if (!node.event) {
        children.push({ name: 'purpose', type: 'text', silent: true, style: { x: grid.x - 28, y, text: row.name, align: 'right', verticalAlign: 'middle', width: 78, overflow: 'truncate', font: `600 17px ${font}`, fill: '#24324a', opacity } })
        const a = Math.max(grid.x, x), b = Math.min(right, q[0]!)
        if (b < a) return
        stroke('retention', [[a, y], [b, y]])
        if (x >= grid.x && x <= right) {
          if (row.beforeRange) stroke('opening-cap', [[x, y - 8], [x, y + 8]])
          else point('received', x, y, true)
          label('receipt', Math.min(x + 10, right - 172), y - 58,
            row.beforeRange ? '区间期初' : `${lot.from_name || '来源未记录'}收进`,
            row.beforeRange ? amount(lot.baseline_quantity, lot.baseline_weight) : amount(lot.quantity, lot.weight), true)
        }
        if (q[0]! >= grid.x && q[0]! <= right) {
          stroke('balance-cap', [[q[0]!, y - 8], [q[0]!, y + 8]])
          label('balance', Math.min(q[0]! + 12, right + 8), y - 25,
            hasStock(lot.closing_quantity, lot.closing_weight) ? '留存' : '已转完', amount(lot.closing_quantity, lot.closing_weight), true)
        }
        const separator = api.coord([node.at, node.row + .62])[1]!
        if (separator <= grid.y + grid.height) children.push({ name: 'separator', type: 'line', silent: true, shape: { x1: grid.x - 70, y1: separator, x2: right + 155, y2: separator }, style: { stroke: '#edf0f5', lineWidth: 1 } })
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
        const title = event.kind === 'loss' ? '丢失' : event.kind === 'voided' ? '撤回入库' : event.kind === 'adjusted' ? '出库改量' : `转出 · ${event.counterpart || '外部'}`
        const value = adjusted
          ? `${event.delta_quantity > 0 ? '+' : ''}${amountLabel({ quantity: event.delta_quantity, weight: event.delta_weight })}`
          : amount(event.quantity, event.weight)
        label('event', Math.min(x + 14, right - 168), ey - 22, title, value)
      }
      return { type: 'group', name: node.id, $mergeChildren: 'byName', children }
    },
  }
  return {
    useUTC: true, textStyle: { fontFamily: font },
    grid: { left: 94, right: 112, top: 30, bottom: 35 },
    xAxis: { type: model.span < 1000 ? 'value' : 'time', min: model.extent?.[0], max: model.extent?.[1], minInterval: 1, splitNumber: 4,
      axisLine: { onZero: false, lineStyle: { color: '#dce2ec' } }, axisTick: { show: true },
      axisLabel: { color: '#687b98', fontSize: 13, lineHeight: 20, margin: 15, hideOverlap: true,
        formatter: (value: number) => { const at = traceTime(value); return model.span < 60000 ? at.slice(11) : model.span > 86400000 ? `${at.slice(5, 10)}\n${at.slice(11, 16)}` : at.slice(11, 16) } },
      splitLine: { show: true, lineStyle: { color: '#edf0f6', type: 'dashed' } } },
    yAxis: { type: 'value', min: -.4, max: Math.max(2.65, model.rows.length - .35), inverse: true, interval: 1,
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: false } },
    dataZoom: [
      { id: 'time', type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: false, minSpan: Math.min(.05, 100 / model.span) },
      { id: 'teams', type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: true, start: 0, end: Math.min(100, 400 / Math.max(1, model.rows.length)), minSpan: 1 },
    ],
    tooltip: { show: interaction === 'select', trigger: 'item', confine: true, renderMode: 'richText', backgroundColor: '#fff', borderColor: '#dfe4ee', padding: 16,
      textStyle: { color: '#263651', fontSize: 14, lineHeight: 23 },
      formatter: params => {
        const node = model.nodes[(Array.isArray(params) ? params[0] : params)!.dataIndex]!, row = model.rows[node.row]!, event = node.event
        return event ? `${historyKindNames[event.kind]} · ${row.name}\n${event.batch_no}\n${event.counterpart}\n${amount(event.quantity, event.weight)}\n${traceTime(node.at)}\n点击查看批次`
          : `${row.name} · ${row.lot.batch_no}\n来源：${row.lot.from_name}\n收进 ${amount(row.lot.quantity, row.lot.weight)}\n${traceTime(row.received)}\n图示期末 ${amount(row.lot.closing_quantity, row.lot.closing_weight)}\n当前结存 ${amount(row.lot.on_hand_quantity, row.lot.on_hand_weight)}\n点击查看批次`
      } }, series: [series],
  }
}

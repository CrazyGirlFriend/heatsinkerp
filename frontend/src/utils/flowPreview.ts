import type { EChartsOption, CustomSeriesOption, SankeySeriesOption, CustomSeriesRenderItemReturn } from 'echarts'
import type { SerialHistory, SerialHistoryFlow } from '@/types/teamBusiness'
import type { TraceBatch } from '@/types/materialTrace'
import { isExternalTransfer, materialTransferStatusLabel } from '@/types/materialTransfer'
import { historyNumber as num, purposePalette } from './serialHistoryChart'
import { teamWorkspaceProfiles } from '@/config/teamWorkspaces'

export type FlowMetric = 'quantity' | 'weight'
export type FlowInteraction = 'select' | 'pan'
export interface FlowAmount { quantity: number; weight: number }
export interface FlowSelection extends FlowAmount { title: string; description: string; batches: string[] }
export interface FlowNode extends FlowSelection { name: string; depth: number; color: string }
export interface FlowLink extends FlowSelection { source: string; target: string; color: string }
export const amountLabel = (value: FlowAmount) => `${num(value.quantity)} 件 / ${num(value.weight)} kg`
export const metricLabel = (value: FlowAmount, metric: FlowMetric) => `${num(value[metric])} ${metric === 'quantity' ? '件' : 'kg'}`

function flowPalette(names: string[]) {
  const colors = purposePalette(names)
  if (colors.has('未分类')) colors.set('未分类', '#8b80be')
  return colors
}

// Full-history effective transfers, not audit deltas: edits and voids must not be counted twice.
export function teamFlowModel(history: SerialHistory) {
  const palette = flowPalette(history.groups.map(group => group.name))
  const nodes = new Map<string, FlowNode>(), links = new Map<string, FlowLink>()
  const touch = (name: string, title: string, depth: number, color: string, description: string) => {
    if (!nodes.has(name)) nodes.set(name, { name, title, depth, color, description, quantity: 0, weight: 0, batches: [] })
    return nodes.get(name)!
  }
  const add = (source: FlowNode, target: FlowNode, amount: FlowAmount, color: string, batches: string[]) => {
    const key = JSON.stringify([source.name, target.name])
    const link = links.get(key) || { source: source.name, target: target.name, title: `${source.title} → ${target.title}`, description: target.depth === 2 ? target.description : '累计有效接收；未接收、已作废批次不计入', color, quantity: 0, weight: 0, batches: [] }
    link.quantity += amount.quantity; link.weight += amount.weight
    link.batches = [...new Set([...link.batches, ...batches])]
    links.set(key, link)
    // A purpose node gets its amount from incoming links only.
    for (const node of [source, target].filter(node => node.depth !== 1 || node === target)) {
      node.quantity += amount.quantity; node.weight += amount.weight
      node.batches = [...new Set([...node.batches, ...batches])]
    }
  }
  for (const group of history.groups) {
    const color = palette.get(group.name) || '#758397'
    const middle = touch(`purpose:${group.key}`, group.name, 1, color, `${history.team_name}接收时登记的用途`)
    const flows = history.flows.filter(flow => flow.group_key === group.key && flow.status !== 'voided')
    for (const flow of flows) {
      if (flow.direction === 'incoming') {
        const source = touch(`source:${flow.from_name}`, flow.from_name, 0, '#637a9d', '已接收入库的来源')
        add(source, middle, flow, color, [flow.batch_no])
      } else {
        const pending = flow.status === 'pending'
        const name = `${flow.to_name}${pending ? ' · 待确认' : ''}`
        const target = touch(`out:${flow.to_name}:${pending}`, name, 2, pending ? '#cf8b36' : color, pending ? '已从本班组扣减，等待下序接收或对外确认' : '累计已转出，非该班组当前库存')
        add(middle, target, flow, color, [flow.batch_no])
      }
    }
    const received = flows.filter(flow => flow.direction === 'incoming').map(flow => flow.batch_no)
    for (const sink of [
      { name: 'stock', title: '本班组结存', color: '#229d91', quantity: group.on_hand_quantity, weight: group.on_hand_weight, description: '当前仍在本班组，已扣除转出和丢失', batches: received },
      { name: 'loss', title: '丢失', color: '#cb6c71', quantity: group.lost_quantity, weight: group.lost_weight, description: '累计已登记的丢失', batches: group.events.filter(event => event.kind === 'loss').map(event => event.batch_no) },
    ]) {
      if (sink.quantity > 0 || sink.weight > 0) add(middle, touch(sink.name, sink.title, 2, sink.color, sink.description), sink, sink.color, sink.batches)
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()], palette }
}

const font = '"PingFang SC", "Microsoft YaHei", sans-serif'
const tooltip = { trigger: 'item' as const, renderMode: 'richText' as const, confine: true, backgroundColor: '#fff', borderColor: '#e3e7ef', padding: 16, textStyle: { color: '#28364d', fontFamily: font, fontSize: 14 } }

export function teamFlowOption(model: ReturnType<typeof teamFlowModel>, metric: FlowMetric): EChartsOption {
  const active = new Set(model.links.filter(link => link[metric] > 0).flatMap(link => [link.source, link.target]))
  const series: SankeySeriesOption = {
    type: 'sankey', left: 142, right: 164, top: 32, bottom: 36, nodeWidth: 10, nodeGap: 34,
    nodeAlign: 'justify', draggable: false, layoutIterations: 48,
    data: model.nodes.filter(node => active.has(node.name)).map(node => ({
      ...node, value: node[metric], itemStyle: { color: node.color, borderRadius: 4, borderWidth: 0 },
      label: { position: node.depth === 0 ? 'left' : 'right', distance: 12, formatter: `{name|${node.title}}\n{value|${metricLabel(node, metric)}}` },
    })),
    links: model.links.filter(link => link[metric] > 0).map(link => ({ ...link, value: link[metric], lineStyle: { color: link.color, opacity: .24 } })),
    lineStyle: { curveness: .52 }, emphasis: { focus: 'trajectory', lineStyle: { opacity: .58 } },
    blur: { lineStyle: { opacity: .045 }, itemStyle: { opacity: .2 } },
    label: { color: '#2a3650', fontFamily: font, rich: { name: { fontSize: 14, fontWeight: 600, lineHeight: 23 }, value: { fontSize: 13, color: '#7d8799', lineHeight: 21 } } },
  }
  return {
    tooltip: { ...tooltip, formatter: params => { const value = (Array.isArray(params) ? params[0] : params)?.data as FlowSelection; return `${value.title}\n${amountLabel(value)}\n${value.batches.length} 个关联批次 · 点击查看`; } },
    series: [series], animationDuration: 1500, animationEasing: 'cubicInOut',
  }
}

// API timestamps without an offset are UTC, matching the rest of the application.
export function traceTimestamp(value?: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`)
  return Number.isFinite(parsed) ? parsed : null
}
export function traceTime(value: number | null): string {
  return value === null ? '未记录' : new Date(value + 8 * 3600000).toISOString().slice(0, 23).replace('T', ' ').replace(/\.000$/, '')
}
export function traceDuration(start: number | null, end: number | null): string {
  if (start === null || end === null || end < start) return '—'
  const ms = end - start
  if (ms < 60000) return `${Number((ms / 1000).toFixed(3))} 秒`
  const minutes = Math.floor(ms / 60000)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`
}

export interface PathNode {
  batch: TraceBatch; depth: number; lane: number; detached: boolean
  startedAt: number | null; finishedAt: number | null; intake: boolean
  sourceLane: number; targetLane: number; sourceOffset: number; targetOffset: number
  timingIssue: boolean
}
export function traceFlowModel(items: TraceBatch[]) {
  const rows = [...items].sort((a, b) => (traceTimestamp(a.transferred_at) ?? Infinity) - (traceTimestamp(b.transferred_at) ?? Infinity) || Number(a.id) - Number(b.id))
  const teams: string[] = teamWorkspaceProfiles.map(profile => profile.name)
  const teamLane = (team: TraceBatch['next_team'], external = false) => {
    const name = external ? `外部 · ${team.name}` : teamWorkspaceProfiles.find(profile => profile.code === team.code)?.name || team.name
    if (!teams.includes(name)) teams.push(name)
    return teams.indexOf(name)
  }
  const ids = new Set(rows.map(row => String(row.id))), children = new Map<string, TraceBatch[]>()
  const roots: TraceBatch[] = []
  for (const row of rows) {
    if (row.source_transfer_id && ids.has(String(row.source_transfer_id))) {
      const id = String(row.source_transfer_id)
      children.set(id, [...(children.get(id) || []), row])
    } else roots.push(row)
  }
  let lane = 0
  const nodes: PathNode[] = []
  function visit(batch: TraceBatch, depth: number): PathNode {
    const descendants = (children.get(String(batch.id)) || []).map(child => visit(child, depth + 1))
    const intake = batch.entry_kind === 'warehouse_receipt' || batch.entry_kind === 'opening_stock'
    const startedAt = traceTimestamp(intake ? batch.received_at || batch.transferred_at : batch.transferred_at)
    const recordedEnd = intake ? startedAt : batch.status === 'received' ? traceTimestamp(batch.received_at) : batch.status === 'dispatched' ? traceTimestamp(batch.dispatched_at) : null
    const reversed = startedAt !== null && recordedEnd !== null && recordedEnd < startedAt
    const targetLane = teamLane(batch.next_team, isExternalTransfer(batch))
    const node: PathNode = {
      batch, depth, lane: descendants.length ? descendants.reduce((sum, child) => sum + child.lane, 0) / descendants.length : lane++,
      detached: batch.entry_kind === 'transfer' && !ids.has(String(batch.source_transfer_id)),
      startedAt, finishedAt: reversed ? null : recordedEnd, intake,
      sourceLane: intake ? targetLane : teamLane(batch.source_team), targetLane, sourceOffset: 0, targetOffset: 0,
      timingIssue: startedAt === null || reversed || ((batch.status === 'received' || batch.status === 'dispatched') && recordedEnd === null),
    }
    nodes.push(node)
    return node
  }
  roots.forEach(root => visit(root, 0))
  nodes.sort((a, b) => a.depth - b.depth || a.lane - b.lane)
  const byId = new Map(nodes.map(node => [String(node.batch.id), node]))
  // Separate simultaneous events vertically inside their team, never by inventing a timestamp.
  const collisions = new Map<string, Array<{ node: PathNode; field: 'sourceOffset' | 'targetOffset' }>>()
  for (const node of nodes) for (const end of [false, true]) {
    if (!end && node.intake) continue
    const at = end ? node.finishedAt : node.startedAt
    if (at === null) continue
    const key = `${end ? node.targetLane : node.sourceLane}:${at}`
    collisions.set(key, [...(collisions.get(key) || []), { node, field: end ? 'targetOffset' : 'sourceOffset' }])
  }
  for (const group of collisions.values()) group.forEach((event, index) => { event.node[event.field] = group.length > 1 ? (index / (group.length - 1) - .5) * .62 : 0 })
  const times = nodes.flatMap(node => [node.startedAt, node.finishedAt].filter((at): at is number => at !== null))
  const first = times.length ? Math.min(...times) : null, last = times.length ? Math.max(...times) : null
  const span = first !== null && last !== null ? Math.max(1, last - first) : 0
  const padding = (span > 1 ? span : 1000) * .09
  return { nodes, byId, teams, first, last, span, extent: first === null || last === null ? null : [first - padding, last + padding] as [number, number], depth: Math.max(0, ...nodes.map(node => node.depth)), lanes: Math.max(1, lane), palette: flowPalette(rows.map(row => row.purpose_name || '未分类')) }
}

// Highlight the selected batch's ancestors and descendants, not unrelated sibling splits.
export function traceRelated(model: ReturnType<typeof traceFlowModel>, id: string) {
  const related = new Set<string>([id])
  let parent = model.byId.get(id)?.batch.source_transfer_id
  while (parent && !related.has(String(parent))) { related.add(String(parent)); parent = model.byId.get(String(parent))?.batch.source_transfer_id }
  const descendants = new Set<string>([id])
  for (const node of model.nodes) {
    if (descendants.has(String(node.batch.source_transfer_id))) { descendants.add(String(node.batch.id)); related.add(String(node.batch.id)) }
  }
  return related
}

export function traceFlowOption(model: ReturnType<typeof traceFlowModel>, _metric: FlowMetric, selectedId = '', animate = true, interaction: FlowInteraction = 'select'): EChartsOption {
  const related = selectedId ? traceRelated(model, selectedId) : null
  const series: CustomSeriesOption = {
    id: 'batch-paths', type: 'custom', name: '批次路径', clip: true, silent: interaction === 'pan', animationDuration: 900, animationDurationUpdate: 180,
    stateAnimation: { duration: 160, easing: 'cubicOut' },
    dimensions: ['转出时间', '接收时间', '来源班组', '去向班组'], encode: { x: [0, 1], y: [2, 3] },
    data: model.nodes.map(node => ({ id: String(node.batch.id), name: node.batch.batch_no, value: [node.startedAt, node.finishedAt ?? node.startedAt, node.sourceLane, node.targetLane] })),
    renderItem(params, api): CustomSeriesRenderItemReturn {
      const node = model.nodes[params.dataIndex]!, batch = node.batch
      const parent = model.byId.get(String(batch.source_transfer_id))
      const color = batch.status === 'voided' ? '#a4acbb' : model.palette.get(batch.purpose_name || '未分类') || '#7762d4'
      const faded = related && !related.has(String(batch.id))
      const opacity = faded ? .16 : 1, chosen = selectedId === String(batch.id)
      const delay = animate && node.startedAt !== null && model.first !== null ? Math.min(1200, (node.startedAt - model.first) / model.span * 1200) : 0
      const start = node.startedAt === null ? null : api.coord([node.startedAt, node.sourceLane + node.sourceOffset])
      const end = node.finishedAt === null ? null : api.coord([node.finishedAt, node.targetLane + node.targetOffset])
      const anchor = end || start
      if (!anchor) return
      const children: NonNullable<Extract<CustomSeriesRenderItemReturn, { type: 'group' }>['children']> = []
      const path = (points: number[][], retained = false) => children.push({
        name: retained ? 'retention' : 'transfer', type: 'polyline', z2: chosen ? 3 : 1,
        shape: { points },
        style: { stroke: color, fill: 'none', strokePercent: 1, ...(animate ? { enterFrom: { strokePercent: 0 } } : {}), transition: ['opacity', 'lineWidth'], lineWidth: retained ? 1.4 : chosen ? 3 : 2, lineJoin: 'round', lineCap: 'round', opacity: opacity * (retained ? .36 : .9), lineDash: batch.status === 'voided' ? [5, 5] : undefined },
        emphasis: { style: { opacity: retained ? .65 : 1, lineWidth: retained ? 1.8 : 3.2 } },
        enterAnimation: { delay, duration: animate ? 900 : 0 },
      })
      // A retention connector is valid only at the actual source team and after its receipt.
      if (start && parent?.finishedAt !== null && parent?.finishedAt !== undefined && parent.targetLane === node.sourceLane && parent.finishedAt <= node.startedAt!) {
        const from = api.coord([parent.finishedAt, parent.targetLane + parent.targetOffset])
        path([from, start], true)
      }
      if (start && end && !node.intake) {
        const dx = end[0]! - start[0]!
        path([start, [start[0]! + dx * .28, start[1]!], [end[0]! - dx * .18, end[1]!], end])
      }
      const point = (position: number[], filled: boolean) => {
        const name = filled ? 'receipt' : 'departure'
        children.push({ name: `${name}-halo`, type: 'circle', silent: true, z2: 3, shape: { cx: position[0]!, cy: position[1]!, r: 11 }, style: { fill: color, opacity: chosen ? .12 : 0, transition: ['opacity'] }, emphasis: { style: { opacity: .12 } } })
        children.push({ name, type: 'circle', z2: 4, shape: { cx: position[0]!, cy: position[1]!, r: chosen ? 5.5 : 4 }, style: { fill: filled ? color : '#fff', stroke: color, lineWidth: 1.8, opacity, transition: ['opacity'], ...(animate ? { enterFrom: { opacity: 0 } } : {}) }, emphasis: { style: { lineWidth: 2.5, opacity: 1 } }, enterAnimation: { delay: delay + (filled && !node.intake ? 650 : 0), duration: 200 } })
      }
      if (start && !node.intake) point(start, false)
      if (end) point(end, true)
      if (!end && start) children.push({ name: 'pending', type: 'line', z2: 2, shape: { x1: start[0]! + 8, y1: start[1]!, x2: start[0]! + 25, y2: start[1]! }, style: { stroke: batch.status === 'pending' ? '#c48a2c' : color, lineWidth: 2, lineDash: [4, 4], opacity }, emphasis: { style: { opacity: 1 } } })

      // Suppress overlapping labels in screen space; every batch remains accessible by click/search.
      const grid = params.coordSys as unknown as { x: number; y: number; width: number; height: number }
      const x = anchor[0]!, y = anchor[1]!
      const labels = (params.context.labels ||= []) as Array<{ x: number; y: number }>
      const inView = x >= grid.x && x <= grid.x + grid.width && y >= grid.y && y <= grid.y + grid.height
      const labelX = Math.max(grid.x + 6, Math.min(x + 12, grid.x + grid.width - 160))
      const labelY = y - 18
      if (inView && !faded && (chosen || !labels.some(label => Math.abs(label.x - labelX) < 176 && Math.abs(label.y - labelY) < 48))) {
        labels.push({ x: labelX, y: labelY })
        // Stable child names keep unchanged paths intact; only changed amounts fade in.
        children.push({ name: `amount:${batch.quantity}:${batch.weight}`, type: 'text', z2: 5, style: { x: labelX, y: labelY, text: amountLabel(batch), font: `500 14px ${font}`, fill: '#26334b', backgroundColor: '#ffffffee', padding: [2, 4], opacity, ...(animate ? { enterFrom: { opacity: 0 } } : {}) }, enterAnimation: { duration: 220 } })
        const detail = !end ? `${batch.next_team.name} · ${materialTransferStatusLabel(batch.status, batch.entry_kind)}` : batch.purpose_name || (node.intake ? '入库' : '')
        if (detail) children.push({ name: 'detail', type: 'text', z2: 5, style: { x: labelX + 4, y: y + 12, text: detail, font: `12px ${font}`, fill: !end ? '#a66d1e' : color, backgroundColor: '#ffffffee', width: 160, overflow: 'truncate' } })
      }
      return {
        type: 'group', name: String(batch.id), $mergeChildren: 'byName', emphasisDisabled: interaction === 'pan', children,
      }
    },
  }
  const axisTime = (at: number) => {
    const date = traceTime(at)
    return model.span < 60000 ? date.slice(11) : `${date.slice(5, 10)}\n${date.slice(11, 16)}`
  }
  return {
    useUTC: true,
    grid: { left: 108, right: 40, top: 36, bottom: 156 },
    xAxis: { type: model.span < 1000 ? 'value' : 'time', min: model.extent?.[0], max: model.extent?.[1], minInterval: 1, splitNumber: 7, axisLine: { onZero: false, lineStyle: { color: '#dadee5' } }, axisTick: { show: true }, axisLabel: { color: '#68758b', fontSize: 12, lineHeight: 19, hideOverlap: true, formatter: axisTime }, splitLine: { show: true, lineStyle: { color: '#f1f2f5' } } },
    yAxis: { type: 'value', min: -1, max: model.teams.length, splitNumber: model.teams.length + 1, minInterval: 1, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#343c56', fontSize: 15, fontWeight: 500, width: 94, overflow: 'truncate', formatter: value => Number.isInteger(value) ? model.teams[value] || '' : '' }, splitLine: { show: true, lineStyle: { color: '#eceef2', type: 'dashed' } } },
    dataZoom: [
      { id: 'time', type: 'inside', xAxisIndex: 0, filterMode: 'none', minSpan: .05, zoomOnMouseWheel: true, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: false, preventDefaultMouseMove: true },
      { id: 'teams', type: 'inside', yAxisIndex: 0, filterMode: 'none', minSpan: 10, zoomOnMouseWheel: true, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: false },
      { id: 'time-slider', type: 'slider', xAxisIndex: 0, filterMode: 'none', minSpan: .05, bottom: 100, left: 112, right: 40, height: 8, borderColor: 'transparent', backgroundColor: '#f0f1f4', fillerColor: '#dcdfea', handleIcon: 'circle', handleSize: 20, handleStyle: { color: '#fff', borderColor: '#a6acbc', borderWidth: 1.5, shadowBlur: 3, shadowColor: '#18243b18' }, showDataShadow: false, brushSelect: false, labelFormatter: value => axisTime(Number(value)) },
    ],
    media: [
      { query: { maxWidth: 540 }, option: { grid: { left: 82, right: 20, bottom: 202 }, dataZoom: [{ id: 'time-slider', left: 86, right: 24, bottom: 148 }] } },
      { option: { grid: { left: 108, right: 40, bottom: 156 }, dataZoom: [{ id: 'time-slider', left: 112, right: 40, bottom: 100 }] } },
    ],
    tooltip: { ...tooltip, show: interaction === 'select', formatter: params => {
      const node = model.nodes[(Array.isArray(params) ? params[0] : params)!.dataIndex]!, batch = node.batch
      return `${batch.batch_no}\n${batch.source_team.name} → ${batch.next_team.name}\n${batch.purpose_name || '未分类'} · ${materialTransferStatusLabel(batch.status, batch.entry_kind)}\n${amountLabel(batch)}\n${node.intake ? '入库' : '转出'}：${traceTime(node.startedAt)}${node.intake ? '' : `\n${isExternalTransfer(batch) ? '对外确认' : '接收'}：${traceTime(node.finishedAt)}`}${node.timingIssue ? '\n时间记录不完整或异常' : ''}\n点击高亮关联批次`
    } },
    series: [series],
  }
}

export function batchSelection(batch: TraceBatch): FlowSelection {
  return { title: batch.batch_no, description: `${batch.source_team.name} → ${isExternalTransfer(batch) ? batch.external_destination : batch.next_team.name}`, quantity: batch.quantity, weight: batch.weight, batches: [batch.batch_no] }
}

export function flowByBatch(flows: SerialHistoryFlow[], batchNo: string) { return flows.find(flow => flow.batch_no === batchNo) }

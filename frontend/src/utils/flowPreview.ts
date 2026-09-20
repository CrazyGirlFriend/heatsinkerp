import type { EChartsOption, CustomSeriesOption, SankeySeriesOption, CustomSeriesRenderItemReturn, XAxisComponentOption } from 'echarts'
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
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} 天${Math.floor(minutes % 1440 / 60) ? ` ${Math.floor(minutes % 1440 / 60)} 小时` : ''}`
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`
}

export interface ResidenceSegment extends FlowAmount { start: number; end: number; current: boolean }
export interface PathNode {
  batch: TraceBatch; depth: number; lane: number; detached: boolean
  startedAt: number | null; finishedAt: number | null; intake: boolean
  sourceLane: number; targetLane: number; sourceOffset: number; targetOffset: number
  timingIssue: boolean
  stays: ResidenceSegment[]; residenceIssue: boolean; trackCount: number
}

const hasAmount = (quantity: number, weight: number) => quantity > 0 || weight > .0000001
const roundWeight = (value: number) => Math.round(value * 1000000) / 1000000
function chainTooltip(text: string) {
  const escaped = text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
  return `<div class="chain-flow-tooltip">${escaped.split('\n').map((line, index) => index === 0 ? `<strong>${line}</strong>` : index === 1 ? `<div class="tooltip-route">${line}</div>` : index === 2 ? `<b>${line}</b>` : `<div>${line}</div>`).join('')}</div>`
}

// A received lot has its own residence intervals. Pending outbound deducts at
// creation; receipt does not deduct again. Voiding restores at the actual event.
function residence(node: PathNode, outgoing: TraceBatch[], closing: number): { stays: ResidenceSegment[]; issue: boolean } {
  const lot = node.batch, received = node.finishedAt
  if (lot.status !== 'received' || isExternalTransfer(lot) || lot.on_hand_quantity == null || lot.on_hand_weight == null || received === null) return { stays: [], issue: false }
  const changes = new Map<number, FlowAmount>()
  let issue = received > closing
  const add = (at: number | null, quantity: number, weight: number) => {
    if (at === null || at < received || at > closing) { issue = true; return }
    const before = changes.get(at) || { quantity: 0, weight: 0 }
    changes.set(at, { quantity: before.quantity + quantity, weight: roundWeight(before.weight + weight) })
  }
  for (const row of outgoing) {
    if (String(row.source_team.id) !== String(lot.next_team.id)) { issue = true; continue }
    const events = [...(row.history || [])].filter(event => ['created', 'updated', 'voided'].includes(event.action))
      .sort((a, b) => (traceTimestamp(a.occurred_at) ?? Infinity) - (traceTimestamp(b.occurred_at) ?? Infinity) || a.id - b.id)
    if (!events.some(event => event.action === 'created')) {
      // Legacy imports can show their recorded dispatch and void, not imaginary edits.
      add(traceTimestamp(row.transferred_at), -row.quantity, -row.weight)
      if (row.status === 'voided') add(traceTimestamp(row.voided_at), row.quantity, row.weight)
      if (events.some(event => event.action === 'updated')) issue = true
      continue
    }
    let quantity = 0, weight = 0
    for (const event of events) {
      const nextQuantity = Number(event.changes.quantity?.after ?? quantity)
      const nextWeight = Number(event.changes.weight?.after ?? weight)
      if (event.action === 'voided') add(traceTimestamp(event.occurred_at), quantity, weight)
      else if (nextQuantity !== quantity || nextWeight !== weight) add(traceTimestamp(event.occurred_at), quantity - nextQuantity, weight - nextWeight)
      quantity = nextQuantity; weight = nextWeight
    }
  }
  for (const loss of lot.loss_records || []) add(traceTimestamp(loss.created_at), -loss.quantity, -loss.weight)
  const stays: ResidenceSegment[] = []
  let start = received, quantity = lot.quantity, weight = lot.weight
  for (const [at, delta] of [...changes].sort((a, b) => a[0] - b[0])) {
    if (at > start && hasAmount(quantity, weight)) stays.push({ start, end: at, quantity, weight, current: false })
    quantity += delta.quantity; weight = roundWeight(weight + delta.weight); start = at
    if (quantity < 0 || weight < -.000001) issue = true
  }
  if (quantity !== lot.on_hand_quantity || Math.abs(weight - lot.on_hand_weight) > .000001) issue = true
  if (hasAmount(quantity, weight) && closing >= start) stays.push({ start, end: closing, quantity, weight, current: true })
  // Do not depict a fabricated historical balance when the ledger cannot reconcile.
  return { stays: issue ? [] : stays, issue }
}

export function traceFlowModel(items: TraceBatch[], observedAt?: string | null) {
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
      stays: [], residenceIssue: false, trackCount: 1,
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
  const times = nodes.flatMap(node => [node.startedAt, node.finishedAt, traceTimestamp(node.batch.voided_at),
    ...(node.batch.loss_records || []).map(loss => traceTimestamp(loss.created_at)),
    ...(node.batch.history || []).map(event => traceTimestamp(event.occurred_at)),
  ].filter((at): at is number => at !== null))
  const closing = traceTimestamp(observedAt) ?? (times.length ? Math.max(...times) : null)
  if (closing !== null) for (const node of nodes) {
    const result = residence(node, children.get(String(node.batch.id)) || [], closing)
    node.stays = result.stays; node.residenceIssue = result.issue
  }
  // Concurrent received lots get separate tracks INSIDE the same team lane.
  for (let team = 0; team < teams.length; team++) {
    const lots = nodes.filter(node => node.targetLane === team && node.stays.length).sort((a, b) => a.finishedAt! - b.finishedAt!)
    const tracks: number[] = [], assigned = new Map<PathNode, number>()
    for (const node of lots) {
      let track = tracks.findIndex(end => end < node.finishedAt!)
      if (track < 0) track = tracks.length
      tracks[track] = node.stays.at(-1)!.end; assigned.set(node, track)
    }
    for (const [node, track] of assigned) {
      node.trackCount = tracks.length
      node.targetOffset = tracks.length > 1 ? (track / (tracks.length - 1) - .5) * .66 : 0
    }
  }
  for (const node of nodes) {
    const parent = byId.get(String(node.batch.source_transfer_id))
    if (parent?.targetLane === node.sourceLane && parent.stays.length) node.sourceOffset = parent.targetOffset
  }
  const ongoing = nodes.some(node => node.stays.some(stay => stay.current) || node.batch.status === 'pending')
  if (ongoing && closing !== null) times.push(closing)
  const first = times.length ? Math.min(...times) : null, last = times.length ? Math.max(...times) : null
  const span = first !== null && last !== null ? Math.max(1, last - first) : 0
  const padding = (span > 1 ? span : 1000) * .02
  return { nodes, byId, teams, first, last, span, closing, ongoing, extent: first === null || last === null ? null : [first - padding, last + padding] as [number, number], depth: Math.max(0, ...nodes.map(node => node.depth)), lanes: Math.max(1, lane), palette: flowPalette(rows.map(row => row.purpose_name || '未分类')) }
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

export function traceFlowOption(model: ReturnType<typeof traceFlowModel>, _metric: FlowMetric, selectedId = '', animate = true, interaction: FlowInteraction = 'select', zoom = 100): EChartsOption {
  const related = selectedId ? traceRelated(model, selectedId) : null
  const series: CustomSeriesOption = {
    id: 'batch-paths', type: 'custom', name: '批次路径', clip: true, silent: interaction === 'pan', animationDuration: 900, animationDurationUpdate: 180,
    stateAnimation: { duration: 160, easing: 'cubicOut' },
    dimensions: ['转出时间', '停留截止', '来源班组', '去向班组', '接收时间'], encode: { x: [0, 1], y: [2, 3] },
    data: model.nodes.map(node => ({ id: String(node.batch.id), name: node.batch.batch_no, value: [node.startedAt, node.stays.at(-1)?.end ?? node.finishedAt ?? node.startedAt, node.sourceLane, node.targetLane, node.finishedAt ?? node.startedAt] })),
    renderItem(params, api): CustomSeriesRenderItemReturn {
      const node = model.nodes[params.dataIndex]!, batch = node.batch
      const color = model.palette.get(batch.purpose_name || '未分类') || '#7762d4'
      const faded = related && !related.has(String(batch.id))
      const opacity = faded ? .16 : 1, chosen = selectedId === String(batch.id)
      const delay = animate && node.startedAt !== null && model.first !== null ? Math.min(1200, (node.startedAt - model.first) / model.span * 1200) : 0
      const start = node.startedAt === null ? null : api.coord([node.startedAt, node.sourceLane + node.sourceOffset])
      const end = node.finishedAt === null ? null : api.coord([node.finishedAt, node.targetLane + node.targetOffset])
      const anchor = end || start
      if (!anchor) return
      const grid = params.coordSys as unknown as { x: number; y: number; width: number; height: number }
      const children: NonNullable<Extract<CustomSeriesRenderItemReturn, { type: 'group' }>['children']> = []
      const labels = (params.context.labels ||= []) as Array<{ x: number; y: number; width: number }>
      const label = (name: string, x: number, y: number, text: string, align: 'left' | 'right' = 'left') => {
        const width = Math.max(120, Array.from(text).length * 8)
        const left = align === 'right' ? x - width : x
        if (y < grid.y + 2) y += 40
        if (faded || left < grid.x || left + width > grid.x + grid.width || y < grid.y + 2 || y + 22 > grid.y + grid.height) return
        if (!chosen && labels.some(box => left < box.x + box.width + 12 && left + width + 12 > box.x && Math.abs(box.y - y) < 30)) return
        labels.push({ x: left, y, width })
        children.push({ name, type: 'text', z2: 6, silent: true, style: { x, y, text, align, font: `500 15px ${font}`, fill: '#30304f', backgroundColor: '#ffffffdf', padding: [2, 3], opacity, ...(animate ? { enterFrom: { opacity: 0 } } : {}) }, enterAnimation: { duration: 220 } })
      }
      const path = (points: number[][]) => {
        children.push({ name: 'transfer-hit', type: 'polyline', shape: { points }, style: { stroke: color, fill: 'none', lineWidth: 14, opacity: 0 } })
        // White clearance separates cross-lane connections from residence bars.
        children.push({ name: 'transfer-clearance', type: 'polyline', silent: true, z2: 2, shape: { points }, style: { stroke: '#fff', fill: 'none', lineWidth: 6, opacity, lineJoin: 'round', lineCap: 'round' } })
        children.push({ name: 'transfer', type: 'polyline', z2: 3, shape: { points },
          style: { stroke: color, fill: 'none', strokePercent: 1, ...(animate ? { enterFrom: { strokePercent: 0 } } : {}), transition: ['opacity', 'lineWidth'], lineWidth: chosen ? 3 : 2, lineJoin: 'round', lineCap: 'round', opacity, lineDash: batch.status === 'voided' ? [5, 5] : undefined },
          emphasis: { style: { opacity: 1, lineWidth: 3.2 } }, enterAnimation: { delay, duration: animate ? 900 : 0 },
        })
      }
      if (start && end && !node.intake) {
        const dx = end[0]! - start[0]!
        path([start, [start[0]! + dx * .35, start[1]!], [start[0]! + dx * .35, end[1]!], end])
      }
      const point = (position: number[], filled: boolean) => {
        const name = filled ? 'receipt' : 'departure'
        children.push({ name: `${name}-halo`, type: 'circle', silent: true, z2: 3, shape: { cx: position[0]!, cy: position[1]!, r: 11 }, style: { fill: color, opacity: chosen ? .12 : 0, transition: ['opacity'] }, emphasis: { style: { opacity: .12 } } })
        children.push({ name, type: 'circle', z2: 4, shape: { cx: position[0]!, cy: position[1]!, r: chosen ? 7 : 5.5 }, style: { fill: filled ? color : '#fff', stroke: color, lineWidth: 2, opacity, transition: ['opacity'], ...(animate ? { enterFrom: { opacity: 0 } } : {}) }, emphasis: { style: { lineWidth: 2.5, opacity: 1 } }, enterAnimation: { delay: delay + (filled && !node.intake ? 650 : 0), duration: 200 } })
      }
      if (start && !node.intake) point(start, false)
      if (end) point(end, true)
      if (!end && start) children.push({ name: 'pending', type: 'line', z2: 2, shape: { x1: start[0]! + 8, y1: start[1]!, x2: start[0]! + 30, y2: start[1]! }, style: { stroke: color, lineWidth: 2, lineDash: [4, 4], opacity }, emphasis: { style: { opacity: 1 } } })
      const x = anchor[0]!, y = anchor[1]!
      const inView = x >= grid.x && x <= grid.x + grid.width && y >= grid.y && y <= grid.y + grid.height
      const crowded = !chosen && model.nodes.some(other => {
        if (other === node) return false
        const at = other.finishedAt ?? other.startedAt
        if (at === null) return false
        const p = api.coord([at, other.finishedAt === null ? other.sourceLane + other.sourceOffset : other.targetLane + other.targetOffset])
        return Math.abs(p[0]! - x) < 150 && Math.abs(p[1]! - y) < 32
      })
      if (inView && !node.stays.length && !crowded) {
        label(`amount:${batch.quantity}:${batch.weight}`, Math.max(grid.x + 6, Math.min(x + 12, grid.x + grid.width - 170)), y - 28, amountLabel(batch))
        if (!end) label('pending-label', x + 36, y + 12, `${batch.next_team.name} · ${materialTransferStatusLabel(batch.status, batch.entry_kind)}`)
      }
      return {
        type: 'group', name: String(batch.id), $mergeChildren: 'byName', emphasisDisabled: interaction === 'pan', children,
      }
    },
  }
  const visibleSpan = model.span * 100 / zoom
  const axisTime = (at: number) => {
    const date = traceTime(at)
    return visibleSpan < 60000 ? date.slice(11) : visibleSpan > 3 * 86400000 ? date.slice(5, 10)
      : visibleSpan > 86400000 ? `${date.slice(5, 10)}\n${date.slice(11, 16)}` : date.slice(11, 16)
  }
  // Each interval is its own data item: ECharts tooltip params do not include
  // child-shape `info`, so sharing a batch item would show the wrong past balance.
  const residences = model.nodes.flatMap(node => node.stays.map(stay => ({ node, stay })))
  const residenceSeries: CustomSeriesOption = {
    id: 'residence-bars', name: '在库停留', type: 'custom', z: 3, clip: true, silent: interaction === 'pan',
    encode: { x: [0, 1], y: 2 }, animationDurationUpdate: 180,
    data: residences.map(({ node, stay }) => ({ id: `${node.batch.id}:${stay.start}`, batchId: String(node.batch.id), value: [stay.start, stay.end, node.targetLane + node.targetOffset] })),
    renderItem(params, api) {
      const { node, stay } = residences[params.dataIndex]!
      const grid = params.coordSys as unknown as { x: number; y: number; width: number; height: number }
      const a = api.coord([stay.start, node.targetLane + node.targetOffset]), b = api.coord([stay.end, node.targetLane + node.targetOffset])
      const left = Math.max(grid.x, a[0]!), right = Math.min(grid.x + grid.width, b[0]!)
      if (right < left || a[1]! < grid.y || a[1]! > grid.y + grid.height) return
      const laneHeight = Math.abs(api.coord([stay.start, node.targetLane + node.targetOffset + 1])[1]! - a[1]!)
      const height = Math.max(3, Math.min(18, laneHeight * .6 / node.trackCount))
      const chosen = selectedId === String(node.batch.id), faded = related && !related.has(String(node.batch.id)), opacity = faded ? .16 : 1
      const children: NonNullable<Extract<CustomSeriesRenderItemReturn, { type: 'group' }>['children']> = [{
        name: 'stay', type: 'rect', z2: -1, shape: { x: left, y: a[1]! - height / 2, width: Math.max(1, right - left), height, r: Math.min(9, height / 2) },
        style: { fill: '#d9d1f5', opacity: opacity * (chosen ? 1 : .82), ...(animate ? { enterFrom: { opacity: 0 } } : {}) },
        emphasis: { style: { fill: '#c6b9ef', opacity: 1 } }, enterAnimation: { duration: 450 },
      }]
      const labels = (params.context.labels ||= []) as Array<{ x: number; y: number; width: number }>
      const label = (name: string, x: number, text: string, align: 'left' | 'right' = 'left') => {
        const y = node.trackCount > 1 ? a[1]! - 9 : a[1]! - 28 < grid.y + 2 ? a[1]! + 12 : a[1]! - 28
        const width = Math.max(110, Array.from(text).length * 8), start = align === 'right' ? x - width : x
        if (faded || start < grid.x || start + width > grid.x + grid.width || y + 22 > grid.y + grid.height) return
        if (!chosen && labels.some(box => start < box.x + box.width + 12 && start + width + 12 > box.x && Math.abs(box.y - y) < 20)) return
        labels.push({ x: start, y, width })
        children.push({ name, type: 'text', z2: 6, silent: true, style: { x, y, text, align, font: `500 15px ${font}`, fill: '#30304f', backgroundColor: '#ffffffdf', padding: [2, 3], opacity } })
      }
      if (stay.current && b[0]! <= grid.x + grid.width && b[0]! >= grid.x) {
        children.push({ name: 'balance-cap', type: 'line', shape: { x1: b[0]!, y1: b[1]! - 9, x2: b[0]!, y2: b[1]! + 9 }, style: { stroke: '#a699ca', lineWidth: 1.5, opacity } })
        label('balance-label', b[0]! - 8, `结存 ${amountLabel(stay)}`, 'right')
      }
      if (right - left > 110) label('stay-label', left + 10, amountLabel(stay))
      return { type: 'group', children, $mergeChildren: 'byName' }
    },
  }
  const lanes: CustomSeriesOption = {
    id: 'team-lanes', type: 'custom', silent: true, z: -10, animation: false, clip: false,
    data: model.teams.map((name, index) => ({ name, value: [model.first, index] })),
    renderItem(params, api) {
      const grid = params.coordSys as unknown as { x: number; y: number; width: number; height: number }
      const y = api.coord([model.first, params.dataIndex - .5])[1]!, bottom = api.coord([model.first, params.dataIndex + .5])[1]!
      const top = Math.max(grid.y, y), height = Math.min(grid.y + grid.height, bottom) - top
      if (height <= 0) return
      const children: NonNullable<Extract<CustomSeriesRenderItemReturn, { type: 'group' }>['children']> = [
        { type: 'rect', shape: { x: 0, y: top, width: grid.x + grid.width, height, r: 6 }, style: { fill: params.dataIndex % 2 === 0 ? '#f5f3fc' : '#fff' } },
        { type: 'text', style: { x: 12, y: (y + bottom) / 2, text: model.teams[params.dataIndex], verticalAlign: 'middle', font: `600 ${grid.x < 100 ? 15 : 17}px ${font}`, fill: '#30304f', width: grid.x - 22, overflow: 'truncate' } },
      ]
      if (params.dataIndex === 0 && model.ongoing && model.closing !== null) {
        const x = api.coord([model.closing, 0])[0]!
        if (x >= grid.x && x <= grid.x + grid.width) children.push(
          { type: 'line', z2: 1, shape: { x1: x, x2: x, y1: grid.y, y2: grid.y + grid.height }, style: { stroke: '#b4a2e7', lineWidth: 1, lineDash: [5, 4] } },
          { type: 'text', style: { x, y: grid.y - 50, text: `截至 ${traceTime(model.closing).slice(5, 16)}`, align: 'right', font: `13px ${font}`, fill: '#8061be' } },
        )
      }
      return { type: 'group', children }
    },
  }
  series.z = 3
  const minSpan = Math.min(.05, 100 / Math.max(1, model.span))
  const timeAxis: XAxisComponentOption = { type: model.span < 1000 ? 'value' : 'time', min: model.extent?.[0], max: model.extent?.[1], minInterval: visibleSpan > 3 * 86400000 ? 86400000 : 1, splitNumber: 10, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#68718e', fontSize: 14, lineHeight: 21, margin: 16, hideOverlap: true, formatter: axisTime }, splitLine: { show: true, lineStyle: { color: '#dedced', type: 'dashed' } } }
  return {
    useUTC: true, textStyle: { fontFamily: font },
    grid: { left: 108, right: 40, top: 64, bottom: 144 },
    xAxis: [{ ...timeAxis, position: 'top' }, { ...timeAxis, position: 'bottom', splitLine: { show: false } }],
    yAxis: { type: 'value', min: -.5, max: model.teams.length - .5, interval: 1, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
    dataZoom: [
      { id: 'time', type: 'inside', xAxisIndex: [0, 1], filterMode: 'none', minSpan, zoomOnMouseWheel: true, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: false, preventDefaultMouseMove: true },
      { id: 'teams', type: 'inside', yAxisIndex: 0, filterMode: 'none', minSpan: 10, zoomOnMouseWheel: false, moveOnMouseMove: interaction === 'pan', moveOnMouseWheel: false },
      { id: 'time-slider', type: 'slider', xAxisIndex: [0, 1], filterMode: 'none', minSpan, bottom: 88, left: 112, right: 40, height: 8, borderColor: 'transparent', backgroundColor: '#f0edf9', fillerColor: '#d8d0f1', handleIcon: 'circle', handleSize: 20, handleStyle: { color: '#fff', borderColor: '#987edf', borderWidth: 2, shadowBlur: 3, shadowColor: '#18243b18' }, showDataShadow: false, brushSelect: false, labelFormatter: value => traceTime(Number(value)) },
    ],
    media: [
      { query: { maxWidth: 540 }, option: { grid: { left: 82, right: 20, bottom: 190 }, dataZoom: [{ id: 'time-slider', left: 86, right: 24, bottom: 136 }] } },
      { option: { grid: { left: 108, right: 40, bottom: 144 }, dataZoom: [{ id: 'time-slider', left: 112, right: 40, bottom: 88 }] } },
    ],
    tooltip: { ...tooltip, renderMode: 'html', show: interaction === 'select', triggerOn: 'mousemove', enterable: true, hideDelay: 150, borderRadius: 8, shadowColor: '#2421391f', borderColor: '#e0daf1', textStyle: { color: '#30304f', fontFamily: font, fontSize: 15, lineHeight: 26 }, formatter: params => {
      const item = (Array.isArray(params) ? params[0] : params)!
      const interval = item.seriesId === 'residence-bars' ? residences[item.dataIndex] : undefined
      const node = interval?.node || model.nodes[item.dataIndex]!, batch = node.batch, stay = interval?.stay
      const balance = batch.on_hand_quantity == null || batch.on_hand_weight == null ? '' : `\n当前结存 ${amountLabel({ quantity: batch.on_hand_quantity, weight: batch.on_hand_weight })}`
      if (stay) return chainTooltip(`${batch.batch_no}\n${batch.next_team.name} · 在库停留\n本段结存 ${amountLabel(stay)}\n${traceTime(stay.start)}\n至 ${traceTime(stay.end)}\n累计停留 ${traceDuration(node.finishedAt, stay.end)}${balance}`)
      return chainTooltip(`${batch.batch_no}\n${batch.source_team.name} → ${batch.next_team.name}\n${amountLabel(batch)}\n${node.intake ? '入库' : '转出'} ${traceTime(node.startedAt)}${node.intake ? '' : `\n${isExternalTransfer(batch) ? '对外确认' : '接收'} ${traceTime(node.finishedAt)}`}\n接收用途 ${batch.purpose_name || '未分类'} · ${materialTransferStatusLabel(batch.status, batch.entry_kind)}${balance}${batch.notes ? `\n备注 ${batch.notes}` : ''}${node.timingIssue ? '\n时间记录不完整或异常' : ''}${node.residenceIssue ? '\n历史变动与结存未核平，未绘制停留条' : ''}`)
    } },
    series: [series, lanes, residenceSeries],
  }
}

export function batchSelection(batch: TraceBatch): FlowSelection {
  return { title: batch.batch_no, description: `${batch.source_team.name} → ${isExternalTransfer(batch) ? batch.external_destination : batch.next_team.name}`, quantity: batch.quantity, weight: batch.weight, batches: [batch.batch_no] }
}

export function flowByBatch(flows: SerialHistoryFlow[], batchNo: string) { return flows.find(flow => flow.batch_no === batchNo) }

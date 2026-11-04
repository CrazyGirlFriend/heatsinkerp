import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { isDelivered, timelineNodes } from './scheduleProgress'
import { scheduleTimestamp } from './scheduleTimeline'

export const BOARD_DAY = 86_400_000
export const BOARD_ROW_HEIGHT = 60
export const BOARD_LANE_HEIGHT = 42
export const boardDay = (time: number) =>
  Math.floor((time + 28_800_000) / BOARD_DAY) * BOARD_DAY - 28_800_000
export const boardDate = (time: number) => new Date(time + 28_800_000).toISOString().slice(0, 10)

const colors: Record<string, string> = {
  库房: '#738497',
  线切割: '#2275c7',
  退火: '#b36320',
  研磨: '#7760c0',
  轧制: '#008273',
  检验: '#507f35',
  雕刻: '#a34e79',
  电镀: '#328797',
}
export const boardTeamColor = (name: string) => colors[name] || '#64758b'

export function boardQuantity(task: ScheduleTask) {
  return task.delivery_batches?.length
    ? task.delivery_batches.reduce((sum, batch) => sum + batch.target_quantity, 0)
    : ([...task.nodes]
        .filter((node) => node.status !== 'cancelled')
        .sort((a, b) => a.sequence_no - b.sequence_no)
        .at(-1)?.target_quantity ?? null)
}

export interface BoardBar {
  node: ProductionSchedule
  start: number
  end: number
  interval: boolean
  left: number
  width: number
  lane: number
  clippedStart: boolean
  clippedEnd: boolean
}

export function boardSummaryNodes(nodes: ProductionSchedule[]) {
  return nodes.map((node) => {
    if (!node.batches?.length) return node
    const starts = node.batches.map((batch) => scheduleTimestamp(batch.planned_start_at))
    const ends = node.batches.map((batch) => scheduleTimestamp(batch.due_at))
    return {
      ...node,
      batches: undefined,
      planned_start_at: starts.every((value) => value != null)
        ? new Date(Math.min(...(starts as number[]))).toISOString()
        : undefined,
      due_at: ends.every((value) => value != null)
        ? new Date(Math.max(...(ends as number[]))).toISOString()
        : node.due_at,
    }
  })
}

export function layoutBoardBars(
  nodes: ProductionSchedule[],
  from: number,
  to: number,
  width: number,
) {
  const all = timelineNodes(nodes).filter((node) => node.status !== 'cancelled')
  const bars: BoardBar[] = []
  for (const node of all) {
    const end = scheduleTimestamp(node.due_at)
    if (end == null) continue
    const planned = scheduleTimestamp(node.planned_start_at)
    const interval = planned != null && planned < end
    const start = interval ? planned : end
    if (interval ? end <= from || start >= to : end < from || end >= to) continue
    const left = ((Math.max(from, start) - from) / (to - from)) * width
    bars.push({
      node,
      start,
      end,
      interval,
      left,
      width: interval
        ? Math.max(2, ((Math.min(to, end) - Math.max(from, start)) / (to - from)) * width)
        : 24,
      lane: 0,
      clippedStart: interval && start < from,
      clippedEnd: end > to,
    })
  }
  bars.sort(
    (a, b) =>
      a.start - b.start ||
      a.node.sequence_no - b.node.sequence_no ||
      (a.node.batch_number || 0) - (b.node.batch_number || 0) ||
      a.node.id - b.node.id,
  )
  const ends: number[] = []
  for (const bar of bars) {
    const left = bar.interval ? bar.left : Math.max(0, Math.min(width - 24, bar.left - 12))
    let lane = ends.findIndex((end) => end + (bar.interval ? 0 : 3) <= left + 0.01)
    if (lane === -1) lane = ends.length
    ends[lane] = left + bar.width
    bar.lane = lane
    bar.left = left
  }
  return {
    bars,
    height: BOARD_ROW_HEIGHT + Math.max(0, ends.length - 1) * BOARD_LANE_HEIGHT,
    outside: all.length - bars.length,
  }
}

// Follow only saved batch relationships. Equal batch numbers are not a material link.
export function boardBatchFlow(nodes: ProductionSchedule[], selectedId: number) {
  const all = timelineNodes(nodes)
  const ids = new Set(all.map((node) => node.id))
  const links = all.flatMap((node) =>
    (node.upstream_timeline_ids || [])
      .filter((id) => ids.has(id) && id !== node.id)
      .map((id) => ({ from: id, to: node.id })),
  )
  const related = new Set([selectedId])
  const edges = new Set<(typeof links)[number]>()
  for (const direction of ['upstream', 'downstream'] as const) {
    const visited = new Set([selectedId]),
      pending = [selectedId]
    while (pending.length) {
      const id = pending.pop()!
      for (const link of links) {
        const source = direction === 'upstream' ? link.to : link.from
        const target = direction === 'upstream' ? link.from : link.to
        if (source !== id) continue
        edges.add(link)
        related.add(target)
        if (!visited.has(target)) {
          visited.add(target)
          pending.push(target)
        }
      }
    }
  }
  return { ids: related, links: [...edges] }
}

export function boardBarState(node: ProductionSchedule) {
  if (isDelivered(node)) return 'done'
  // Expanded batch nodes have no stock: the API only knows stock at team level.
  if ((node.stock?.on_hand_quantity || 0) > 0 || (node.stock?.on_hand_weight || 0) > 0)
    return 'stock'
  if (node.dispatched_quantity > 0 || node.dispatched_weight > 0) return 'partial'
  return 'planned'
}

export function boardDeliveryState(node: ProductionSchedule, now: number) {
  if (node.assessment_enabled === false || node.status === 'not_assessed') return 'unassessed'
  if (isDelivered(node)) return node.status
  const due = scheduleTimestamp(node.due_at)
  return node.status === 'overdue' || (due != null && due < now) ? 'overdue' : 'pending'
}

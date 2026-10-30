import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from './format'
import { scheduleTimestamp } from './scheduleTimeline'

export const SCHEDULE_WEEK = 7 * 86_400_000
export const PROGRESS_CARD_WIDTH = 112
export const PROGRESS_CARD_HEIGHT = 32
export const PROGRESS_LANE_HEIGHT = 42
const DAY = 86_400_000
const OFFSET = 8 * 3_600_000
export const isDelivered = (node: ProductionSchedule) =>
  ['completed', 'completed_late'].includes(node.status)
export const isAssessed = (node: ProductionSchedule) =>
  node.assessment_enabled !== false && node.status !== 'not_assessed'

export function progressWeek(anchor: number, now: number, dayCount = 7) {
  const localDay = Math.floor((anchor + OFFSET) / DAY) * DAY - OFFSET
  const weekday = (new Date(localDay + OFFSET).getUTCDay() + 6) % 7
  const start = localDay - weekday * DAY
  return progressRange(start, start + dayCount * DAY, now)
}

export function progressRange(start: number, end: number, now: number) {
  const dayCount = Math.round((end - start) / DAY)
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = start + index * DAY
    return {
      date,
      label: formatDateTime(new Date(date).toISOString()).slice(5, 10).replace('-', '/'),
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
        new Date(date + OFFSET).getUTCDay()
      ],
      weekend: [0, 6].includes(new Date(date + OFFSET).getUTCDay()),
      today: date <= now && now < date + DAY,
    }
  })
  return { start, end, days }
}

export function timelineNodes(nodes: ProductionSchedule[]): ProductionSchedule[] {
  return nodes.flatMap((node) =>
    node.batches?.length
      ? node.batches.map((batch) => ({
          ...node,
          ...batch,
          id: -batch.id,
          parent_schedule_id: node.id,
          predecessor_id: batch.upstream_batch_ids.length
            ? -batch.upstream_batch_ids[0]!
            : nodes.find((n) => n.id === node.predecessor_id)?.batches?.length
              ? null
              : node.predecessor_id,
          upstream_timeline_ids: batch.upstream_batch_ids.map((id) => -id),
          processed_quantity: undefined,
          stock: undefined,
          batches: undefined,
          remaining_quantity:
            batch.target_quantity == null
              ? null
              : Math.max(0, batch.target_quantity - batch.dispatched_quantity),
          remaining_weight:
            batch.target_weight == null
              ? null
              : Math.max(0, batch.target_weight - batch.dispatched_weight),
          time_warnings: batch.warnings,
        }))
      : [node],
  )
}

export function progressMarkers(
  nodes: ProductionSchedule[],
  week: ReturnType<typeof progressWeek>,
  width: number,
) {
  const ordered = timelineNodes(nodes).sort(
    (a, b) =>
      (scheduleTimestamp(a.planned_start_at || a.due_at) || 0) -
        (scheduleTimestamp(b.planned_start_at || b.due_at) || 0) ||
      a.sequence_no - b.sequence_no ||
      a.id - b.id,
  )
  // Reserve lanes for explicitly linked batches so a material flow stays together.
  // Batch numbers alone never establish a relationship between teams.
  const roots = new Map(ordered.map((node) => [node.id, node.id]))
  const root = (id: number): number => {
    const parent = roots.get(id)!
    if (parent === id) return id
    const result = root(parent)
    roots.set(id, result)
    return result
  }
  for (const node of ordered) {
    for (const upstream of node.upstream_timeline_ids || []) {
      if (roots.has(upstream)) roots.set(root(node.id), root(upstream))
    }
  }
  const linked = new Set<number>()
  for (const node of ordered) {
    if (node.upstream_timeline_ids?.some((id) => roots.has(id))) linked.add(root(node.id))
  }
  const geometries = ordered.flatMap((node) => {
    const date = scheduleTimestamp(node.due_at)
    const start = scheduleTimestamp(node.planned_start_at)
    const interval = date != null && start != null && start < date
    if (
      date == null ||
      (interval ? date <= week.start || start >= week.end : date < week.start || date >= week.end)
    )
      return []
    const x =
      ((Math.max(week.start, interval ? start : date) - week.start) / (week.end - week.start)) *
      width
    const barWidth = interval
      ? Math.max(
          2,
          ((Math.min(date, week.end) - Math.max(start, week.start)) / (week.end - week.start)) *
            width,
        )
      : PROGRESS_CARD_WIDTH
    // Keep the card inside its day when possible. The anchor still marks the exact hour.
    const dayWidth = width / week.days.length
    const dayStart = Math.floor((date - week.start) / DAY) * dayWidth
    const fitsDay = dayWidth >= PROGRESS_CARD_WIDTH + 8
    const lower = fitsDay ? dayStart + 4 : 2
    const upper = fitsDay
      ? dayStart + dayWidth - PROGRESS_CARD_WIDTH - 4
      : width - PROGRESS_CARD_WIDTH - 2
    const left = interval ? x : Math.max(lower, Math.min(upper, x - PROGRESS_CARD_WIDTH / 2))
    return [
      {
        node,
        x,
        labelOffset: left - x,
        width: barWidth,
        interval,
        clippedStart: interval && start < week.start,
        clippedEnd: interval && date > week.end,
        top: 0,
        y: 0,
      },
    ]
  })
  const flows = new Map<number | 'unlinked', typeof geometries>()
  for (const marker of geometries) {
    const key = linked.has(root(marker.node.id)) ? root(marker.node.id) : 'unlinked'
    const flow = flows.get(key) || []
    flow.push(marker)
    flows.set(key, flow)
  }
  let laneCount = 0
  const bands: { id: number | 'unlinked'; top: number; height: number; nodeIds: number[] }[] = []
  for (const [id, flow] of flows) {
    const firstLane = laneCount
    const laneEnds: number[] = []
    for (const marker of flow) {
      const left = marker.x + marker.labelOffset
      // True intervals may meet at the same hour; do not move them or invent a gap.
      const gap = marker.interval ? 0 : 8
      let lane = laneEnds.findIndex((end) => end + gap <= left + 0.01)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = left + marker.width
      marker.top = 10 + (laneCount + lane) * PROGRESS_LANE_HEIGHT
      marker.y = marker.top + PROGRESS_CARD_HEIGHT / 2
    }
    laneCount += laneEnds.length
    bands.push({
      id,
      top: firstLane * PROGRESS_LANE_HEIGHT + 5,
      height: laneEnds.length * PROGRESS_LANE_HEIGHT,
      nodeIds: flow.map((marker) => marker.node.id),
    })
  }
  const visible = geometries
  const byId = new Map(visible.map((marker) => [marker.node.id, marker]))
  const links = visible.flatMap((item) =>
    (item.node.upstream_timeline_ids?.length
      ? item.node.upstream_timeline_ids
      : [item.node.predecessor_id]
    ).flatMap((predecessorId) => {
      const previous = predecessorId == null ? undefined : byId.get(predecessorId)
      if (!previous || previous === item) return []
      const from = previous.x + previous.labelOffset + previous.width + 1
      const to = item.x + item.labelOffset - 1
      const overlaps = to < from && item.y > previous.y
      const previousCenter = from - previous.width / 2 - 1
      const nextCenter = to + item.width / 2 + 1
      const path = overlaps
        ? `M ${previousCenter} ${previous.top + PROGRESS_CARD_HEIGHT + 1} C ${previousCenter} ${item.top - 4} ${nextCenter} ${item.top - 4} ${nextCenter} ${item.top - 1}`
        : previous.y === item.y
          ? `M ${from} ${previous.y} L ${to} ${item.y}`
          : `M ${from} ${previous.y} C ${from + 12} ${previous.y} ${to - 12} ${item.y} ${to} ${item.y}`
      return [
        {
          key: `${previous.node.id}:${item.node.id}`,
          id: item.node.id,
          fromId: previous.node.id,
          done: isDelivered(previous.node) && isDelivered(item.node),
          path,
        },
      ]
    }),
  )
  return {
    visible,
    markers: visible,
    links,
    bands,
    height: Math.max(52, laneCount * PROGRESS_LANE_HEIGHT + 10),
    outside: ordered.filter((node) => !byId.has(node.id)),
  }
}

export function nodeCompletion(node: ProductionSchedule) {
  if (!isAssessed(node) || node.status === 'cancelled') return { processed: null, dispatched: null }
  const percent = (actual: number | undefined, target: number | null) =>
    actual == null || target == null || target <= 0
      ? null
      : Math.max(0, Math.min(100, (actual / target) * 100))
  const basis = node.completion_basis || (node.target_quantity != null ? 'quantity' : 'weight')
  const processed =
    basis === 'weight' ? null : percent(node.processed_quantity, node.target_quantity)
  const quantities = [
    ...(basis !== 'weight' ? [percent(node.dispatched_quantity, node.target_quantity)] : []),
    ...(basis !== 'quantity' ? [percent(node.dispatched_weight, node.target_weight)] : []),
  ]
  return {
    processed,
    dispatched: quantities.every((value) => value != null)
      ? Math.min(...(quantities as number[]))
      : null,
  }
}

export function nodeProgress(node: ProductionSchedule) {
  const basis = node.completion_basis || (node.target_quantity != null ? 'quantity' : 'weight')
  return [
    basis !== 'weight'
      ? `${formatAmount(node.dispatched_quantity)} / ${formatAmount(node.target_quantity)} 件`
      : '',
    basis !== 'quantity'
      ? `${formatAmount(node.dispatched_weight)} / ${formatAmount(node.target_weight)} kg`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function nodeTarget(node: ProductionSchedule) {
  const basis = node.completion_basis || (node.target_quantity != null ? 'quantity' : 'weight')
  return (
    [
      basis !== 'weight' && node.target_quantity != null
        ? `${formatAmount(node.target_quantity)} 件`
        : '',
      basis !== 'quantity' && node.target_weight != null
        ? `${formatAmount(node.target_weight)} kg`
        : '',
    ]
      .filter(Boolean)
      .join(' · ') || '—'
  )
}

export function nodeActual(node: ProductionSchedule) {
  return nodeTarget({
    ...node,
    target_quantity: node.dispatched_quantity,
    target_weight: node.dispatched_weight,
  })
}

export function taskRisk(task: ScheduleTask) {
  if (task.status === 'cancelled') return { tone: 'muted', label: '已取消' }
  if (['completed', 'completed_late'].includes(task.status))
    return {
      tone: task.status === 'completed_late' ? 'late' : 'done',
      label: task.status === 'completed_late' ? '逾期交完' : '已交完',
    }
  if (task.status === 'not_assessed') return { tone: 'muted', label: '库房备料' }
  const active = timelineNodes(task.nodes).filter((node) => node.status !== 'cancelled')
  if (active.some((node) => node.quality_held)) return { tone: 'hold', label: '质量暂扣' }
  const late = active.filter((node) => node.status === 'overdue' && isAssessed(node))
  if (late.length) return { tone: 'late', label: `${late.length} 项逾期` }
  if (task.status === 'overdue') return { tone: 'late', label: '交期已过' }
  if (active.some((node) => node.status === 'today')) return { tone: 'watch', label: '今日交货' }
  return { tone: 'normal', label: '无逾期' }
}

export function deadlineRemaining(task: ScheduleTask, now: number) {
  if (task.status === 'cancelled') return ''
  if (task.status === 'not_assessed') return ''
  if (['completed', 'completed_late'].includes(task.status)) {
    const last = task.nodes.filter((node) => isAssessed(node) && isDelivered(node)).at(-1)
    return last?.completed_at
      ? `实际交完 ${formatDateTime(last.completed_at).slice(5)}`
      : '各加工节点已交完'
  }
  const due = scheduleTimestamp(task.final_due_at)
  if (due == null) return '未设置交期'
  const hours = Math.ceil(Math.abs(due - now) / 3_600_000)
  const duration = hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
  return due < now ? `最终交期已过 ${duration}` : `距交货 ${duration}`
}

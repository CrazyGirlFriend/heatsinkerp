import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from './format'
import { scheduleTimestamp } from './scheduleTimeline'

export const SCHEDULE_WEEK = 7 * 86_400_000
export const PROGRESS_CARD_WIDTH = 112
export const PROGRESS_LANE_HEIGHT = 40
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

export function progressMarkers(
  nodes: ProductionSchedule[],
  week: ReturnType<typeof progressWeek>,
  width: number,
) {
  const ordered = [...nodes].sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
  const laneEnds: number[] = []
  const visible = ordered.flatMap((node) => {
    const date = scheduleTimestamp(node.due_at)
    if (date == null || date < week.start || date >= week.end) return []
    const x = ((date - week.start) / (week.end - week.start)) * width
    // Keep the card inside its day when possible. The anchor still marks the exact hour.
    const dayWidth = width / week.days.length
    const dayStart = Math.floor((date - week.start) / DAY) * dayWidth
    const fitsDay = dayWidth >= PROGRESS_CARD_WIDTH + 8
    const lower = fitsDay ? dayStart + 4 : 2
    const upper = fitsDay
      ? dayStart + dayWidth - PROGRESS_CARD_WIDTH - 4
      : width - PROGRESS_CARD_WIDTH - 2
    const left = Math.max(lower, Math.min(upper, x - PROGRESS_CARD_WIDTH / 2))
    let lane = laneEnds.findIndex((end) => end + 8 <= left)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = left + PROGRESS_CARD_WIDTH
    return [
      {
        node,
        x,
        labelOffset: left - x,
        top: 8 + lane * PROGRESS_LANE_HEIGHT,
        y: 24 + lane * PROGRESS_LANE_HEIGHT,
      },
    ]
  })
  if (laneEnds.length === 1) {
    for (const marker of visible) {
      marker.top += 4
      marker.y += 4
    }
  }
  const byId = new Map(visible.map((marker) => [marker.node.id, marker]))
  const links = visible.flatMap((item) => {
    const previous = byId.get(item.node.predecessor_id ?? -1)
    if (!previous || previous === item) return []
    const from = previous.x + previous.labelOffset + PROGRESS_CARD_WIDTH + 1
    const to = item.x + item.labelOffset - 1
    const overlaps = to < from && item.y > previous.y
    const previousCenter = from - PROGRESS_CARD_WIDTH / 2 - 1
    const nextCenter = to + PROGRESS_CARD_WIDTH / 2 + 1
    const path = overlaps
      ? `M ${previousCenter} ${previous.top + 33} C ${previousCenter} ${item.top - 4} ${nextCenter} ${item.top - 4} ${nextCenter} ${item.top - 1}`
      : previous.y === item.y
        ? `M ${from} ${previous.y} L ${to} ${item.y}`
        : `M ${from} ${previous.y} C ${from + 12} ${previous.y} ${to - 12} ${item.y} ${to} ${item.y}`
    return [
      {
        id: item.node.id,
        fromId: previous.node.id,
        done: isDelivered(previous.node) && isDelivered(item.node),
        path,
      },
    ]
  })
  return {
    visible,
    markers: visible,
    links,
    height: Math.max(56, laneEnds.length * PROGRESS_LANE_HEIGHT + 8),
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
  const active = task.nodes.filter((node) => node.status !== 'cancelled')
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

import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from './format'
import { scheduleTimestamp } from './scheduleTimeline'

export const SCHEDULE_WEEK = 7 * 86_400_000
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
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = start + index * DAY
    return {
      date,
      label: formatDateTime(new Date(date).toISOString()).slice(5, 10).replace('-', '/'),
      weekday: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index],
      today: date <= now && now < date + DAY,
    }
  })
  return { start, end: start + dayCount * DAY, days }
}

export function progressMarkers(
  nodes: ProductionSchedule[],
  week: ReturnType<typeof progressWeek>,
  width: number,
) {
  const ordered = [...nodes].sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
  const lanes: number[][] = []
  const visible = ordered.flatMap((node) => {
    const date = scheduleTimestamp(node.due_at)
    if (date == null || date < week.start || date >= week.end) return []
    const x = Math.max(
      28,
      Math.min(width - 28, ((date - week.start) / (week.end - week.start)) * width),
    )
    // Different deadlines can fall in the same hour. Preserve their dates and add lanes.
    let lane = lanes.findIndex((positions) => positions.every((last) => Math.abs(last - x) >= 47.5))
    if (lane < 0) lane = lanes.length
    ;(lanes[lane] ||= []).push(x)
    return [{ node, x, lane, y: 52 + lane * 82 }]
  })
  const byId = new Map(visible.map((item) => [item.node.id, item]))
  const links = visible.flatMap((item) => {
    const previous = byId.get(item.node.predecessor_id ?? -1)
    if (!previous) return []
    const middle = (previous.x + item.x) / 2
    return [
      {
        id: item.node.id,
        done: isDelivered(previous.node) && isDelivered(item.node),
        path: `M ${previous.x} ${previous.y} C ${middle} ${previous.y}, ${middle} ${item.y}, ${item.x} ${item.y}`,
      },
    ]
  })
  return {
    visible,
    links,
    height: Math.max(112, lanes.length * 82 + 30),
    outside: ordered.filter((node) => !visible.some((item) => item.node.id === node.id)),
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
      tone: task.status === 'completed_late' ? 'watch' : 'done',
      label: task.status === 'completed_late' ? '逾期交完' : '已交完',
    }
  if (task.status === 'not_assessed') return { tone: 'muted', label: '仅展示备料与转出' }
  const active = task.nodes.filter((node) => node.status !== 'cancelled')
  if (active.some((node) => node.quality_held)) return { tone: 'hold', label: '质量暂扣' }
  const late = active.filter((node) => node.status === 'overdue' && isAssessed(node))
  if (late.length) return { tone: 'watch', label: `${late.length} 个节点逾期` }
  if (active.some((node) => node.status === 'today'))
    return { tone: 'watch', label: '今天有节点交货' }
  return { tone: 'normal', label: '暂无逾期节点' }
}

export function deadlineRemaining(task: ScheduleTask, now: number) {
  if (task.status === 'cancelled') return ''
  if (task.status === 'not_assessed') return '库房不考核交货完成量'
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

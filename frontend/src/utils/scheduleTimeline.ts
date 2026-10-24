import type { ProductionSchedule } from '@/types/productionSchedule'
import { formatDateTime } from './format'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const FACTORY_OFFSET = 8 * HOUR
export const SCHEDULE_ROW_HEIGHT = 64
export const SCHEDULE_PLAN_Y = 22
export const SCHEDULE_ACTUAL_Y = 48
export type ScheduleZoom = 'day' | 'week'

export function scheduleTimestamp(value?: string | null) {
  if (!value) return null
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`)
  return Number.isFinite(timestamp) ? timestamp : null
}

const factoryDay = (timestamp: number) =>
  Math.floor((timestamp + FACTORY_OFFSET) / DAY) * DAY - FACTORY_OFFSET

export function scheduleAxis(now: number, zoom: ScheduleZoom, anchor = now) {
  const start = factoryDay(anchor) - (zoom === 'day' ? 1 : 3) * DAY
  const end = start + (zoom === 'day' ? 3 : 14) * DAY
  const pixelsPerHour = zoom === 'day' ? 24 : 4
  const position = (timestamp: number) => ((timestamp - start) / HOUR) * pixelsPerHour
  const days = []
  for (let timestamp = start; timestamp < end; timestamp += DAY) {
    days.push({
      timestamp,
      x: position(timestamp),
      label: formatDateTime(new Date(timestamp).toISOString()).slice(5, 10),
      today: factoryDay(now) === timestamp,
      weekend: [0, 6].includes(new Date(timestamp + FACTORY_OFFSET).getUTCDay()),
    })
  }
  return {
    start,
    end,
    width: position(end),
    pixelsPerHour,
    dayWidth: pixelsPerHour * 24,
    days,
    position,
  }
}

export function scheduleLanes(nodes: ProductionSchedule[], axis: ReturnType<typeof scheduleAxis>) {
  const rows = [...nodes]
    .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
    .map((node) => {
      const due = scheduleTimestamp(node.due_at)
      const completed = scheduleTimestamp(node.completed_at)
      return {
        node,
        dueX: due == null ? null : axis.position(due),
        completedX: completed == null ? null : axis.position(completed),
      }
    })
  const indices = new Map(rows.map((row, index) => [row.node.id, index]))
  const links = rows.flatMap((row, index) => {
    const previous =
      row.node.predecessor_id == null ? undefined : indices.get(row.node.predecessor_id)
    if (
      previous == null ||
      previous === index ||
      row.dueX == null ||
      row.dueX < 0 ||
      row.dueX > axis.width
    )
      return []
    const source = rows[previous]!
    if (source.dueX == null || source.dueX < 0 || source.dueX > axis.width) return []
    const startY = previous * SCHEDULE_ROW_HEIGHT + SCHEDULE_PLAN_Y
    const endY = index * SCHEDULE_ROW_HEIGHT + SCHEDULE_PLAN_Y + (previous < index ? -14 : 14)
    const middleY = (startY + endY) / 2
    const detour = Math.abs(previous - index) > 1 && Math.abs(source.dueX - row.dueX) < 28 ? 28 : 0
    return [
      {
        id: `${source.node.id}-${row.node.id}`,
        sourceId: source.node.id,
        targetId: row.node.id,
        status: row.node.status,
        cancelled: source.node.status === 'cancelled' || row.node.status === 'cancelled',
        path: `M ${source.dueX} ${startY} C ${source.dueX - detour} ${middleY}, ${row.dueX - detour} ${middleY}, ${row.dueX} ${endY}`,
      },
    ]
  })
  return { rows, links }
}

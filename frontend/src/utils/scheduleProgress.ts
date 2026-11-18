import { hasConfirmedPlan } from './schedulePlanning'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from './format'

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
          batch_number: node.batches!.length > 1 ? batch.batch_number : undefined,
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
      : !hasConfirmedPlan(node)
        ? []
        : [node],
  )
}

export function nodeCompletion(node: ProductionSchedule) {
  if (node.status === 'cancelled') return { processed: null, dispatched: null }
  const percent = (actual: number | undefined, target: number | null) =>
    actual == null || target == null || target <= 0
      ? null
      : Math.max(0, Math.min(100, (actual / target) * 100))
  const basis = node.completion_basis || (node.target_quantity != null ? 'quantity' : 'weight')
  const processed =
    !isAssessed(node) || basis === 'weight'
      ? null
      : percent(node.processed_quantity, node.target_quantity)
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

export function isCustomerShipmentNode(node: ProductionSchedule) {
  return node.next_team_id == null && node.external_destination === '对外转料'
}

export function nodeWorkProgress(node: ProductionSchedule) {
  const progress = nodeCompletion(node)
  return {
    label: isCustomerShipmentNode(node) ? '有效发货' : '有效转出',
    percent: progress.dispatched,
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

import type { ProductionSchedule, ScheduleBatchWrite } from '@/types/productionSchedule'
import type { RouteOrderDocument } from '@/types/processRoute'
import { formatDateTime } from './format'

// The original order total is reference information, not this schedule's delivery target.
export function referenceOrderQuantity(document?: RouteOrderDocument | null) {
  const value = Number(document?.receipt_fields.delivery_quantity?.value)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

// Retain legacy submitted drafts until their owner saves them; live plans stay effective.
export const hasConfirmedPlan = (node: ProductionSchedule) =>
  !!node.batches?.length ||
  (!!node.due_at && !['pending', 'submitted'].includes(node.planning_state || ''))

export function planLabel(node: ProductionSchedule) {
  if (node.pending_batches?.length) return '待保存草稿'
  return hasConfirmedPlan(node) ? '已填写' : '待填写'
}

export const plannedDueLabel = (node: ProductionSchedule) =>
  hasConfirmedPlan(node) ? formatDateTime(node.due_at) : planLabel(node)

export function teamPlanValues(node: ProductionSchedule): ScheduleBatchWrite {
  const historical = (node.batches?.length ?? 0) > 1
  const batch = historical ? undefined : node.batches?.[0]
  const draft = historical ? [] : node.pending_batches || []
  const single = draft.length ? undefined : batch
  const id = batch?.id || draft[0]?.id
  const due = draft.reduce(
    (latest, item) =>
      !latest || Date.parse(item.due_at) > Date.parse(latest) ? item.due_at : latest,
    '',
  )
  return {
    ...(id ? { id } : {}),
    batch_number: batch?.batch_number || 1,
    due_at: due || single?.due_at || (node.planning_state === 'pending' ? '' : node.due_at),
    target_quantity: draft.length
      ? draft.reduce((sum, item) => sum + (item.target_quantity || 0), 0) || null
      : single
        ? single.target_quantity
        : node.target_quantity,
    target_weight: draft.length
      ? Number(
          draft.reduce((sum, item) => sum + (Number(item.target_weight) || 0), 0).toFixed(6),
        ) || null
      : single
        ? single.target_weight
        : node.target_weight,
    upstream_batch_ids: draft.length
      ? [...new Set(draft.flatMap((item) => item.upstream_batch_ids))]
      : batch?.upstream_batch_ids || [],
  }
}

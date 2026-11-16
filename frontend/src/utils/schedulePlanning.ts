import type { ProductionSchedule } from '@/types/productionSchedule'
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

import type { ProductionSchedule } from '@/types/productionSchedule'
import { formatDateTime } from './format'

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

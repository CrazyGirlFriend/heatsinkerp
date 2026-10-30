import type { ProductionSchedule } from '@/types/productionSchedule'
import { formatDateTime } from './format'

export const awaitingReview = (node: ProductionSchedule) =>
  node.planning_state === 'submitted' || node.planning_state === 'revision_pending'

export const hasConfirmedPlan = (node: ProductionSchedule) =>
  !!node.batches?.length || !['pending', 'submitted'].includes(node.planning_state || '')

export function planLabel(node: ProductionSchedule) {
  return node.planning_state === 'pending'
    ? '待填写'
    : awaitingReview(node)
      ? '待调度确认'
      : '已确认'
}

export const plannedDueLabel = (node: ProductionSchedule) =>
  hasConfirmedPlan(node) ? formatDateTime(node.due_at) : planLabel(node)

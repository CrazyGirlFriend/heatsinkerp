import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { isDelivered } from './scheduleProgress'
import { scheduleTimestamp } from './scheduleTimeline'

export const BOARD_DAY = 86_400_000
export const boardDate = (time: number) => new Date(time + 28_800_000).toISOString().slice(0, 10)

const colors: Record<string, string> = {
  库房: '#a67912',
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

export function boardDeliveryState(node: ProductionSchedule, now: number) {
  if (node.handover_status && node.handover_status !== 'not_assessed') {
    return node.handover_status
  }

  if (node.assessment_enabled === false || node.status === 'not_assessed') return 'unassessed'
  if (isDelivered(node)) return node.status
  const due = scheduleTimestamp(node.due_at)
  return node.status === 'overdue' || (due != null && due < now) ? 'overdue' : 'pending'
}

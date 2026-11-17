export function formatScheduleBatch(schedule: { task_batch_number?: number | null }) {
  return schedule.task_batch_number ? `第${schedule.task_batch_number}批` : '—'
}

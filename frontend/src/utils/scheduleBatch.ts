export function formatScheduleBatch(schedule: { task_batch_number?: number | null }) {
  return schedule.task_batch_number ? `第${schedule.task_batch_number}批` : '—'
}

export function scheduleBatchSearch(value: string) {
  return value.trim().replace(/^第\s*(\d+)\s*批$/, '$1')
}

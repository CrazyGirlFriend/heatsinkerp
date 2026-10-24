import { productionScheduleApi } from '@/services/productionScheduleApi'
import {
  scheduleStatusLabels,
  scheduleStatusTone,
  type InventoryScheduleSummary,
} from '@/types/productionSchedule'
import { formatDateTime } from './format'

// Defective workpieces and reusable surplus can still have an administrator's delivery plan.
export const isScheduleApplicable = (materialType?: string | null) =>
  !['waste', 'sludge', 'scrap_chips'].includes(materialType || '')

export function inventoryScheduleBaseline(
  materialType?: string | null,
): InventoryScheduleSummary | undefined {
  return isScheduleApplicable(materialType)
    ? undefined
    : {
        applicable: false,
        count: 0,
        due_at: null,
        status: 'not_applicable',
        overdue_count: 0,
        items: [],
      }
}

export function inventoryScheduleDue(summary?: InventoryScheduleSummary) {
  if (!summary?.applicable || !summary.count) return '—'
  return summary.count > 1 ? `${summary.count}项排期` : formatDateTime(summary.due_at)
}

export function inventoryScheduleLabel(summary?: InventoryScheduleSummary) {
  if (!summary) return '未获取'
  if (!summary.applicable || summary.status === 'not_applicable') return '不适用'
  if (!summary.count || summary.status === 'unplanned') return '未安排'
  if (summary.count > 1 && summary.overdue_count > 0) return `${summary.overdue_count}项逾期`
  return scheduleStatusLabels[summary.status]
}

export function inventoryScheduleTone(summary?: InventoryScheduleSummary) {
  if (!summary || summary.status === 'unplanned' || summary.status === 'not_applicable')
    return 'info'
  return scheduleStatusTone(summary.status)
}

export async function loadInventorySchedules(
  teamId: number,
  rows: { id: number; materialType?: string | null }[],
  kind: 'groups' | 'sources',
): Promise<Record<number, InventoryScheduleSummary>> {
  const result: Record<number, InventoryScheduleSummary> = {}
  const applicable = rows.filter((row) => isScheduleApplicable(row.materialType))
  for (const row of rows.filter((row) => !isScheduleApplicable(row.materialType)))
    result[row.id] = inventoryScheduleBaseline(row.materialType)!
  if (!applicable.length) return result
  const data = await productionScheduleApi.inventory({
    team_id: teamId,
    [kind === 'groups' ? 'group_ids' : 'source_transfer_ids']: applicable.map((row) => row.id),
  })
  if (kind === 'groups') for (const summary of data.groups) result[summary.group_id] = summary
  else for (const summary of data.sources) result[summary.source_transfer_id] = summary
  if (applicable.some((row) => !result[row.id])) throw new Error('排期信息不完整，请重试。')
  return result
}

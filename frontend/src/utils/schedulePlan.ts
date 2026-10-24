import type { CompletionBasis, ScheduleSource } from '@/types/productionSchedule'

export function scheduleAmountErrors(input: {
  basis: CompletionBasis
  quantity?: number | null
  weight?: number | null
  sources: ScheduleSource[]
}) {
  const errors: Record<string, string> = {}
  if (input.basis !== 'weight' && !(Number(input.quantity) > 0))
    errors.quantity = '请填写计划交货件数'
  if (input.basis !== 'quantity' && !(Number(input.weight) > 0))
    errors.weight = '请填写计划交货重量'
  if (
    input.sources.reduce((sum, source) => sum + (source.quantity || 0), 0) > (input.quantity || 0)
  )
    errors.sources = '各批次计划件数合计不能超过节点计划'
  if (
    input.sources.reduce((sum, source) => sum + (source.weight || 0), 0) >
    (input.weight || 0) + 0.000001
  )
    errors.sources = '各批次计划重量合计不能超过节点计划'
  if (input.sources.some((source) => !(Number(source.quantity) > 0 || Number(source.weight) > 0)))
    errors.sources = '请填写所关联批次的计划件数或重量'
  return errors
}

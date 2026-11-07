export type ProcessingState =
  | 'registered'
  | 'partial'
  | 'complete'
  | 'unregistered'
  | 'rework'
  | 'pending'
  | 'cleared'
  | 'not_applicable'
export const processingRoleLabels = {
  remaining: '未加工余料',
  produced: '加工产出',
  scrap: '加工废料',
} as const
export type ProcessingRole = keyof typeof processingRoleLabels
export const processingProgressLabels = { partial: '部分加工', complete: '本批加工完成' } as const
export const processingStateLabels: Record<ProcessingState, string> = {
  registered: '有加工记录 · 进度未标明',
  partial: '部分加工',
  complete: '加工完成',
  unregistered: '待加工',
  rework: '待返工',
  pending: '已转出 · 待签收',
  cleared: '无未转出库存',
  not_applicable: '—',
}
// Waste is selected by material type, not by processing progress.
export const inventoryProcessingStateOptions = Object.entries(processingStateLabels)
  .filter(([value]) => value !== 'not_applicable')
  .map(([value, label]) => ({ value, label }))

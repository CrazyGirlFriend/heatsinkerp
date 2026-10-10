import type { MaterialType } from './materialTransfer'
import type { QuantityAdjustment } from './teamMaterials'

export type ProcessingState = 'registered' | 'partial' | 'complete' | 'unregistered' | 'pending' | 'cleared' | 'not_applicable'
export const processingProgressLabels = { partial: '部分加工', complete: '本批加工完成' } as const
export const processingStateLabels: Record<ProcessingState, string> = {
  registered: '有加工记录 · 进度未标明', partial: '部分加工', complete: '本批加工完成', unregistered: '未登记加工', pending: '已转出 · 待签收', cleared: '无未转出库存', not_applicable: '废料另计',
}
export interface ProcessingSummary {
  processing_registered_batch_count?: number; processing_unregistered_batch_count?: number
  processing_partial_batch_count?: number; processing_complete_batch_count?: number
  processing_registered_quantity?: number; processing_registered_weight?: number
  processing_unregistered_quantity?: number; processing_unregistered_weight?: number
}
export interface ProcessingRecord extends QuantityAdjustment {
  serial_no: string; batch_no: string; material_name: string | null; material_type: MaterialType | null; purpose_name: string | null
  on_hand_quantity: number; on_hand_weight: number; in_transit_quantity: number; in_transit_weight: number
  processing_state: ProcessingState
}

import type { MaterialType } from './materialTransfer'
import type { QuantityAdjustment } from './teamMaterials'

export type ProcessingState = 'registered' | 'unregistered' | 'pending' | 'cleared' | 'not_applicable'
export const processingStateLabels: Record<ProcessingState, string> = {
  registered: '已登记加工 · 未转出', unregistered: '未登记加工', pending: '已转出 · 待签收', cleared: '无未转出库存', not_applicable: '废料另计',
}
export interface ProcessingSummary {
  processing_registered_batch_count?: number; processing_unregistered_batch_count?: number
  processing_registered_quantity?: number; processing_registered_weight?: number
  processing_unregistered_quantity?: number; processing_unregistered_weight?: number
}
export interface ProcessingRecord extends QuantityAdjustment {
  serial_no: string; batch_no: string; material_name: string | null; material_type: MaterialType | null; purpose_name: string | null
  on_hand_quantity: number; on_hand_weight: number; in_transit_quantity: number; in_transit_weight: number
  processing_state: ProcessingState
}

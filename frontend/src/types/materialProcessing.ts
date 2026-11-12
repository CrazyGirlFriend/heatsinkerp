import type { SharedMaterialFields } from './sharedMaterial'
import type { MaterialType } from './materialTransfer'
import type { QuantityAdjustment } from './processingContract'

import type { ProcessingState } from './processingStatus'
export * from './processingStatus'
export interface ProcessingSummary {
  processing_state?: ProcessingState | 'mixed' | 'not_required'
  rework_pending?: boolean
  processing_registered_batch_count?: number
  processing_unregistered_batch_count?: number
  processing_partial_batch_count?: number
  processing_complete_batch_count?: number
  processing_registered_quantity?: number
  processing_registered_weight?: number
  processing_unregistered_quantity?: number
  processing_unregistered_weight?: number
}
export interface ProcessingRecord extends QuantityAdjustment, SharedMaterialFields {
  serial_no: string
  batch_no: string
  material_name: string | null
  material_type: MaterialType | null
  purpose_name: string | null
  on_hand_quantity: number
  on_hand_weight: number
  in_transit_quantity: number
  in_transit_weight: number
  processing_state: ProcessingState
}

export interface ProcessingDailyRow {
  processors?: { id: number; name: string | null }[]
  processing_minutes?: number | null
  duration_record_count?: number
  process_route_id?: number | null
  process_step_index?: number | null
  process_step_name?: string | null
  processing_task_id?: number | null
  processing_task_name?: string | null
  purpose_id?: number | null
  purpose_name?: string | null
  team_id: number
  team_name: string
  processing_date: string
  processor_employee_id: number
  processor_name: string
  processing_mode: 'unit' | 'split'
  record_count: number
  input_quantity: number
  input_weight: number
  rework_quantity?: number
  rework_weight?: number
  rework_record_count?: number
  work_quantity?: number
  work_weight?: number
  completed_quantity: number
  completed_weight: number
  scrap_quantity: number
  scrap_weight: number
}

export interface ProcessingRecordSummary {
  processing_minutes?: number | null
  duration_record_count?: number
  daily_group_count?: number
  employee_day_count: number
  record_count: number
  unreported_count: number
  rework_quantity?: number
  rework_weight?: number
  rework_record_count?: number
  work_quantity?: number
  work_weight?: number
  completed_quantity: number
  completed_weight: number
  scrap_quantity: number
  scrap_weight: number
}

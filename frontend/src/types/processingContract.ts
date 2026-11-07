import type { components } from './generated/api'
import type { MaterialType, SludgeMeasurement } from './materialTransfer'
type RecordedWork = components['schemas']['QuantityAdjustmentResponse']
type RequiredWorkFields =
  | 'id'
  | 'source_transfer_id'
  | 'before_quantity'
  | 'after_quantity'
  | 'delta_quantity'
  | 'weight'
  | 'reason'
  | 'created_by'
  | 'created_at'
// Old recount records and form drafts have no explicit production metadata.
export type QuantityAdjustment = Pick<RecordedWork, RequiredWorkFields> &
  Partial<Omit<RecordedWork, RequiredWorkFields | 'outputs' | 'after_weight'>> & {
    outputs?: ProcessingOutput[]
    after_weight?: number
  }

export interface CreateProcessingOutput extends SludgeMeasurement {
  serial_no?: string | null
  role: import('./processingStatus').ProcessingRole
  quantity: number
  weight: number
  material_type: MaterialType
  transfer_specification?: string | null
}
export interface ProcessingOutput extends CreateProcessingOutput {
  shared_unallocated?: boolean
  id: number
  batch_no: string
  on_hand_quantity?: number
  on_hand_weight?: number
  in_transit_quantity?: number
  in_transit_weight?: number
  owned_quantity?: number
  owned_weight?: number
}

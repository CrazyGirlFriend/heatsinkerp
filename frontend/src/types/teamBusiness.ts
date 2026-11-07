import type { components } from './generated/api'
import type { MaterialTransfer, MaterialType, SludgeMeasurement } from './materialTransfer'
export type TeamDirectoryItem = components['schemas']['TeamDirectoryItemResponse']
export type TeamPurpose = TeamDirectoryItem
export type TeamEmployee = TeamDirectoryItem
export type TeamProcessingTask = TeamDirectoryItem &
  Partial<Pick<components['schemas']['TeamProcessingTaskResponse'], 'purpose_id'>>
export interface OpeningLine extends SludgeMeasurement {
  serial_no: string
  material_name: string
  material_type: MaterialType | ''
  transfer_specification: string
  quantity: number | undefined
  weight: number | undefined
  notes?: string | null
  purpose_id?: number | null
}
export interface OpeningState {
  enabled: boolean
  completed: boolean
  has_stock_history: boolean
  can_submit: boolean
  items: MaterialTransfer[]
}
// Historical read-only snapshots predate material provenance and per-lot balances.
// Live responses are validated by the backend; chart inputs also accept those snapshots.
type HistoryContract = components['schemas']
type LegacyOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
export type SerialHistoryEvent = LegacyOptional<
  HistoryContract['SerialHistoryEvent'],
  'entry_kind' | 'processing_role' | 'transfer_specification'
>
export type SerialHistoryGroup = Omit<
  LegacyOptional<
    HistoryContract['SerialHistoryGroup'],
    'owned_quantity' | 'owned_weight' | 'processing_delta_quantity' | 'processing_delta_weight'
  >,
  'events'
> & { events: SerialHistoryEvent[] }
export type SerialHistoryLot = LegacyOptional<
  HistoryContract['SerialHistoryLot'],
  | 'owned_quantity'
  | 'owned_weight'
  | 'entry_kind'
  | 'processing_role'
  | 'material_type'
  | 'transfer_specification'
  | 'source_batch_no'
>
export type SerialHistoryFlow = HistoryContract['SerialHistoryFlow']
export type SerialHistory = Omit<
  LegacyOptional<HistoryContract['SerialHistory'], 'observed_at' | 'closing_at'>,
  'groups' | 'lots'
> & { groups: SerialHistoryGroup[]; lots?: SerialHistoryLot[] }

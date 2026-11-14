import type { ProcessRouteStep } from './processRoute'
import type { components } from './generated/api'
type Contract = components['schemas']
type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
export const scheduleStatusLabels = {
  pending: '待交货',
  today: '今日到期',
  overdue: '逾期未交完',
  completed: '按时完成',
  completed_late: '逾期完成',
  cancelled: '已取消',
  not_assessed: '备料与转出',
} as const
export type ScheduleStatus = Contract['ScheduleResponse']['status']
export type ScheduleOverview = Omit<Contract['ScheduleOverviewResponse'], 'attention'> & {
  attention: ProductionSchedule[]
}
export const completionBasisLabels = {
  quantity: '按件数',
  weight: '按重量',
  both: '件数和重量',
} as const
export type CompletionBasis = Contract['ScheduleResponse']['completion_basis']
export const scheduleExecutionLabels = {
  waiting_material: '待关联物料',
  pending_receipt: '待签收',
  ready: '物料已到位',
  partial: '部分交货',
  stock_dispatched: '已有转出',
  completed: '已完成',
  cancelled: '已取消',
} as const
export type ScheduleExecutionState = Contract['ScheduleResponse']['execution_state']
export function scheduleStatusTone(status: ScheduleStatus) {
  if (status === 'overdue' || status === 'completed_late') return 'danger'
  if (status === 'today') return 'warning'
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'info'
  return 'primary'
}
export interface ScheduleSource {
  source_transfer_id: number
  quantity: number | null
  weight: number | null
  batch_no?: string
}
export interface ScheduleWrite {
  process_route_id?: number | null
  process_step_index?: number | null
  completion_basis?: CompletionBasis
  serial_no: string
  team_id: number
  next_team_id: number | null
  external_destination: string | null
  due_at: string
  target_quantity: number | null
  target_weight: number | null
  sequence_no: number
  predecessor_id: number | null
  notes: string | null
  sources: ScheduleSource[]
}
export type ScheduleAuditSnapshot = Partial<ScheduleWrite> & {
  planning_state?: ProductionSchedule['planning_state']
  pending_batches?: (ScheduleBatchWrite & { planned_start_at?: string | null })[] | null
  batches?: (ScheduleBatchWrite & { planned_start_at?: string | null })[]
  reason?: string
  cancelled_at?: string | null
  task_title?: string
  task_notes?: string | null
  task_version?: number
  final_due_at?: string | null
}
export interface ScheduleBatchWrite {
  id?: number
  batch_number: number
  due_at: string
  target_quantity: number | null
  target_weight: number | null
  upstream_batch_ids: number[]
}
export type ScheduleBatch = OptionalFields<Contract['ScheduleBatchResponse'], 'planned_start_at'>
// The board also constructs batch rows locally. Keep that view projection separate
// from the complete HTTP response without duplicating server field definitions.
type ScheduleCore = Pick<
  Contract['ScheduleResponse'],
  | 'id'
  | 'team_name'
  | 'next_team_name'
  | 'version'
  | 'status'
  | 'cancelled_at'
  | 'created_at'
  | 'updated_at'
  | 'dispatched_quantity'
  | 'dispatched_weight'
  | 'received_quantity'
  | 'received_weight'
  | 'remaining_quantity'
  | 'remaining_weight'
  | 'completed_at'
>
export type ProductionSchedule = ScheduleWrite &
  ScheduleCore &
  Partial<
    Omit<
      Contract['ScheduleResponse'],
      keyof ScheduleWrite | keyof ScheduleCore | 'batches' | 'pending_batches' | 'route_link'
    >
  > & {
    pending_batches?: Contract['ScheduleBatchProposalResponse'][] | null
    batches?: ScheduleBatch[]
    parent_schedule_id?: number
    batch_number?: number
    time_warnings?: string[]
    upstream_timeline_ids?: number[]
    route_link?: NonNullable<Contract['ScheduleResponse']['route_link']>
    deliveries?: Contract['ScheduleDeliveryResponse'][]
    history?: (Omit<Contract['ScheduleEventResponse'], 'before' | 'after'> & {
      before: ScheduleAuditSnapshot | null
      after: ScheduleAuditSnapshot | null
    })[]
  }

export interface ScheduleFilters {
  task_id?: number
  query?: string
  serial_no?: string
  team_id?: number
  status?: ScheduleStatus
  scope?: 'attention' | 'completed'
  serial_nos?: string[]
  business_person_ids?: number[]
  due_from?: string
  due_to?: string
  sort_by?: 'final_due_at' | 'created_at'
  sort_order?: 'asc' | 'desc'
  page?: number
  page_size?: number
}
export type ScheduleSourceOption = Contract['ScheduleSourceOptionResponse']
export type ScheduleSummary = Pick<
  ProductionSchedule,
  | 'id'
  | 'task_id'
  | 'task_no'
  | 'task_title'
  | 'completion_basis'
  | 'execution_state'
  | 'quality_held'
  | 'serial_no'
  | 'team_id'
  | 'team_name'
  | 'next_team_id'
  | 'next_team_name'
  | 'external_destination'
  | 'due_at'
  | 'target_quantity'
  | 'target_weight'
  | 'dispatched_quantity'
  | 'dispatched_weight'
  | 'remaining_quantity'
  | 'remaining_weight'
  | 'received_quantity'
  | 'received_weight'
  | 'status'
  | 'sources'
  | 'linked_batches'
  | 'batches'
  | 'predecessor_id'
>
export type CustomerDeliveryBatch = Contract['CustomerDeliveryBatchResponse']
export interface DispatchTaskWrite {
  planned_quantity?: number
  serial_no: string
  route_id: number
  route_version: number
  final_due_at: string
  delivery_batches: CustomerDeliveryBatch[]
  business_person_ids: number[]
  notes: string | null
  idempotency_key: string
}
type ScheduleTaskCore = Pick<
  Contract['ScheduleTaskResponse'],
  | 'id'
  | 'task_no'
  | 'title'
  | 'serial_no'
  | 'notes'
  | 'version'
  | 'created_at'
  | 'updated_at'
  | 'final_due_at'
  | 'status'
>
export type ScheduleTask = ScheduleTaskCore &
  Partial<Omit<Contract['ScheduleTaskDetailResponse'], keyof ScheduleTaskCore | 'nodes'>> & {
    nodes: ProductionSchedule[]
  }
export type BusinessPerson = Contract['BusinessPersonResponse']
export interface ScheduleSelection {
  value: number | string
  label: string
}
export interface InventoryScheduleSummary {
  applicable: boolean
  count: number
  due_at: string | null
  status: ScheduleStatus | 'unplanned' | 'not_applicable'
  overdue_count: number
  items_truncated?: boolean
  items: ScheduleSummary[]
}
export interface InventorySchedules {
  groups: (InventoryScheduleSummary & { group_id: number })[]
  sources: (InventoryScheduleSummary & { source_transfer_id: number })[]
}

export type ScheduleRouteOption = Omit<
  OptionalFields<Contract['ScheduleRouteOptionResponse'], 'execution_serial' | 'serial_nos'>,
  'steps'
> & { steps: ProcessRouteStep[] }
export interface ScheduleRouteLink {
  expected_version: number
  route_id: number
  route_version: number
  mappings: { schedule_id: number; expected_version: number; step_index: number }[]
}

export type ScheduleReworkOption = Contract['ScheduleReworkOptionResponse']

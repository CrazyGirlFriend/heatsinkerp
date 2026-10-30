import type { ProcessRouteStep } from './processRoute'
export const scheduleStatusLabels = {
  pending: '待交货',
  today: '今日到期',
  overdue: '逾期未交完',
  completed: '按时完成',
  completed_late: '逾期完成',
  cancelled: '已取消',
  not_assessed: '备料与转出',
} as const
export type ScheduleStatus = keyof typeof scheduleStatusLabels
export const completionBasisLabels = {
  quantity: '按件数',
  weight: '按重量',
  both: '件数和重量',
} as const
export type CompletionBasis = keyof typeof completionBasisLabels
export const scheduleExecutionLabels = {
  waiting_material: '待关联物料',
  pending_receipt: '待签收',
  ready: '物料已到位',
  partial: '部分交货',
  stock_dispatched: '已有转出',
  completed: '已完成',
  cancelled: '已取消',
} as const
export type ScheduleExecutionState = keyof typeof scheduleExecutionLabels
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
  pending_batches?: ScheduleBatchWrite[] | null
  batches?: ScheduleBatchWrite[]
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
  planned_start_at: string
  due_at: string
  target_quantity: number | null
  target_weight: number | null
  upstream_batch_ids: number[]
}
export interface ScheduleBatch extends ScheduleBatchWrite {
  id: number
  status: ScheduleStatus
  warnings: string[]
  dispatched_quantity: number
  dispatched_weight: number
  received_quantity: number
  received_weight: number
  completed_at: string | null
}
export interface ProductionSchedule extends ScheduleWrite {
  planning_state?: 'pending' | 'submitted' | 'revision_pending' | 'confirmed'
  pending_batches?: ScheduleBatchWrite[] | null
  order_locked?: boolean
  delivery_batches?: CustomerDeliveryBatch[]
  final_due_at?: string | null
  batches?: ScheduleBatch[]
  planned_start_at?: string
  parent_schedule_id?: number
  batch_number?: number
  time_warnings?: string[]
  upstream_timeline_ids?: number[]
  route_link?: { state: 'unlinked' | 'linked' | 'changed'; latest_route_id: number | null }
  id: number
  task_id?: number
  task_no?: string
  task_title?: string
  execution_state?: ScheduleExecutionState
  quality_held?: boolean
  assessment_enabled?: boolean
  stock?: {
    on_hand_quantity: number
    on_hand_weight: number
    pending_quantity: number
    pending_weight: number
    batch_count: number
    rework_quantity: number
  }
  initial_due_at?: string
  team_name: string
  next_team_name: string | null
  material_name?: string | null
  version: number
  status: ScheduleStatus
  cancelled_at: string | null
  created_at: string
  updated_at: string
  processed_quantity?: number
  dispatched_quantity: number
  dispatched_weight: number
  received_quantity: number
  received_weight: number
  remaining_quantity: number | null
  remaining_weight: number | null
  completed_at: string | null
  linked_batches?: {
    source_transfer_id: number
    batch_no: string
    material_name: string
    quantity: number
    weight: number
    received_at: string | null
    status: string
  }[]
  deliveries?: {
    id: number
    batch_no: string
    quantity: number
    weight: number
    transferred_at: string
    received_at: string | null
    status: string
    schedule_batch_id?: number | null
    counts_toward_delivery?: boolean
  }[]
  history?: {
    id: number
    action: string
    actor: string
    occurred_at: string
    before: ScheduleAuditSnapshot | null
    after: ScheduleAuditSnapshot | null
  }[]
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
  page?: number
  page_size?: number
}
export interface ScheduleSourceOption {
  source_transfer_id: number
  batch_no: string
  serial_no: string
  material_name: string
  material_type: string
  quantity: number
  weight: number
  on_hand_quantity: number
  on_hand_weight: number
  received_at: string | null
}
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
export interface CustomerDeliveryBatch {
  batch_number: number
  due_at: string
  target_quantity: number
}
export interface DispatchTaskWrite {
  serial_no: string
  route_id: number
  route_version: number
  final_due_at: string
  delivery_batches: CustomerDeliveryBatch[]
  business_person_ids: number[]
  notes: string | null
  idempotency_key: string
}
export interface ScheduleTask {
  business_people?: { id: number; name: string }[]
  delivery_batches?: CustomerDeliveryBatch[]
  locked_at?: string | null
  cancelled_at?: string | null
  reworks?: {
    route_id: number
    route_version: number
    schedule_id: number
    batch_no: string
    problem: string
    quantity: number
    completed_quantity: number
    state: 'awaiting_route' | 'processing' | 'processed'
  }[]
  route_changed?: boolean
  id: number
  task_no: string
  title: string
  serial_no: string
  business_person_id?: number | null
  business_person_name?: string | null
  shared_source?: boolean
  notes: string | null
  version: number
  created_at: string
  updated_at: string
  final_due_at: string
  status: ScheduleStatus
  nodes: ProductionSchedule[]
  locations?: {
    team_id: number
    team_name: string
    quantity: number
    weight: number
    pending_quantity: number
    pending_weight: number
    batch_count: number
    quality_held: boolean
  }[]
}
export interface ScheduleTaskWrite {
  final_due_at?: string | null
  idempotency_key: string
  title: string
  serial_no: string
  notes: string | null
  business_person_id?: number | null
  nodes: (Omit<ScheduleWrite, 'serial_no' | 'sequence_no' | 'predecessor_id'> & {
    completion_basis: CompletionBasis
  })[]
}
export interface BusinessPerson {
  id: number
  name: string
  active: boolean
  version: number
}
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

export interface ScheduleRouteOption {
  id: number
  title: string
  version: number
  published_at: string
  steps: ProcessRouteStep[]
}
export interface ScheduleRouteLink {
  expected_version: number
  route_id: number
  route_version: number
  mappings: { schedule_id: number; expected_version: number; step_index: number }[]
}

export interface ScheduleReworkOption {
  route_id: number
  route_version: number
  problem: string
  batch_no: string
  plans: { id: number; team_name: string; due_at: string }[]
}

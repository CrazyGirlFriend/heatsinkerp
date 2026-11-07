import type { components } from './generated/api'
type Contract = components['schemas']
type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// Editor drafts always initialize these optional import fields to null.
export type ProcessRouteStep = Omit<
  Contract['RouteStepResponse'],
  'processing_task_id' | 'purpose_id'
> & {
  processing_task_id: number | null
  purpose_id: number | null
}
export type ProcessRouteDrawing = OptionalFields<Contract['RouteDrawingResponse'], 'sha256'>
export type RouteMaterialField = Contract['RouteMaterialFieldResponse']
export type RouteOrderDocument = Contract['RouteOrderDocumentResponse']
export type ReworkRouteRequest = OptionalFields<
  Contract['ReworkRequestResponse'],
  | 'original_task_id'
  | 'original_schedule_id'
  | 'requesting_team_id'
  | 'requesting_team_name'
  | 'requested_by'
  | 'inspection_id'
  | 'inspection_kind'
  | 'inspector_name'
  | 'problem_names'
  | 'problem_notes'
  | 'dimension_result'
  | 'weight_result'
  | 'problem_teams'
  | 'execution_team_names'
  | 'resume_step_name'
>
export interface ProcessRoute {
  rework_progress?: ReworkProgress
  material_name?: string
  step_summary?: Pick<ProcessRouteStep, 'sequence_no' | 'name' | 'team_id'>[]
  missing_documents?: string[]
  route_kind?: 'normal' | 'rework'
  rework_batch_no?: string
  rework_quantity?: number
  rework_weight?: number
  rework_request?: ReworkRouteRequest | null
  drawings?: ProcessRouteDrawing[]
  execution_labels?: { tasks: Record<string, string>; purposes: Record<string, string> }
  id: number
  title: string
  filename: string
  state: 'draft' | 'published'
  version: number
  parent_id: number | null
  serial_nos: string[]
  steps: ProcessRouteStep[]
  review_note: string | null
  source_data: {
    tables: string[][][]
    issues: string[]
    original_steps?: ProcessRouteStep[]
    receipt_fields?: Record<string, RouteMaterialField>
    word_fields?: Record<string, RouteMaterialField>
    order_document?: RouteOrderDocument
    review_required?: boolean
    material_confirmation?: { fingerprint: string; by: string; at: string }
    field_warnings?: string[]
  }
  created_by: string
  engineering_employee_id?: number | null
  engineering_employee_name?: string | null
  modified_employee_id?: number | null
  modified_employee_name?: string | null
  created_at: string
  updated_at?: string | null
  published_at: string | null
}
export type ReworkProgress = Contract['ReworkProgressResponse']
export type ReworkRound = Omit<Contract['ReworkRoundResponse'], 'request' | 'steps'> & {
  request: ReworkRouteRequest
  steps: ProcessRouteStep[]
}
export const reworkProgressLabels: Record<ReworkProgress['state'], string> = {
  awaiting_route: '待制定',
  processing: '待加工完成',
  awaiting_inspection: '待复检确认',
  passed: '复检合格',
  failed: '复检不合格',
}
export interface ReworkSource {
  id: number
  serial_no: string
  batch_no: string
  quantity: number
  weight: number
}
export interface ProcessRouteContext {
  execution_serial?: string | null
  can_resume?: boolean
  route_kind?: 'normal' | 'rework'
  rework_of_id?: number | null
  id: number
  title: string
  version: number
  step_index: number
  sequence_no: number
  step_name: string
  instructions: string
  team_id: number
  processing_task_id: number | null
  purpose_id: number | null
  split_here: boolean
  complete: boolean
  available?: boolean
  next_team_id?: number | null
  next_purpose_id?: number | null
}

export type ReceiptProcessRoute = Pick<
  ProcessRoute,
  'id' | 'version' | 'title' | 'serial_nos' | 'steps' | 'review_note'
>

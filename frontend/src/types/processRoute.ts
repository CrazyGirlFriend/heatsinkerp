export interface ProcessRouteStep {
  sequence_no: number
  name: string
  instructions: string
  planned_days: string
  planned_quantity: string
  team_id: number | null
  team_name?: string | null
  processing_task_id: number | null
  purpose_id: number | null
  serial_nos: string[]
  split_here: boolean
  source_row?: string | null
}
export interface ProcessRouteDrawing {
  sha256?: string
  id: number
  filename: string
  size_bytes: number
}

export interface ReworkRouteRequest {
  can_modify?: boolean
  source_transfer_id: number
  batch_no: string
  team_id: number
  team_name: string
  quantity: number
  weight: number
  reason: string
  rework_of_id: number
  inspection_id?: number | null
  round: number
  resume_route_id: number | null
  resume_step_index: number | null
  resume_step_name?: string | null
  resume_team_id: number
}
export interface ProcessRoute {
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
    receipt_fields?: Record<
      string,
      { value: string | number; label: string; source_row: string; source_label: string }
    >
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
export interface ProcessRouteContext {
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

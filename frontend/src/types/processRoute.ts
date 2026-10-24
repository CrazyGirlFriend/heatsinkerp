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
export interface ProcessRoute {
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
  created_at: string
  published_at: string | null
}
export interface ProcessRouteContext {
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

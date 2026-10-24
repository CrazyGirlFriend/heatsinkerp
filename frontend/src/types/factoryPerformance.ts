export interface ProductionMetrics {
  record_count: number
  initial_record_count: number
  rework_record_count: number
  completed_quantity: number
  completed_weight: number
  rework_quantity: number
  rework_weight: number
  work_quantity: number
  work_weight: number
}

export interface QualityMetrics {
  record_count: number
  checked_quantity: number
  passed_quantity: number
  failed_quantity: number
  pass_rate: number | null
}

export interface QualityBasis {
  kind: 'patrol' | 'inspection'
  scope: 'sample' | 'full'
  phase: 'first' | 'recheck'
}

export type PerformancePeriod = 'day' | 'week' | 'month'
export interface ProductionScope extends ProductionMetrics {
  scope_id: number
  team_id: number
  team_name: string
  serial_no: string
  material_name: string | null
  purpose_name: string | null
  processing_task_name: string | null
  process_route_id?: number | null
  process_step_index?: number | null
  process_step_name?: string | null
}

export interface PerformanceFilters {
  date_from: string
  date_to: string
  team_id?: number
  period?: PerformancePeriod
  serial_no?: string
  work_id?: number
  material_name?: string
}

export interface FactoryPerformance {
  period: PerformancePeriod
  period_dates: string[]
  date_from: string
  date_to: string
  generated_at: string
  teams: { id: number; code: string; name: string; active: boolean }[]
  production: {
    totals: ProductionMetrics
    scope: ProductionScope | null
    scopes: ProductionScope[]
    trend: (ProductionMetrics & { date: string })[]
  }
  quality: {
    groups: (QualityMetrics &
      QualityBasis & { team_id: number; team_name: string; material_name: string | null })[]
    materials: (QualityMetrics & QualityBasis & { material_name: string | null })[]
    trend: (QualityMetrics & QualityBasis & { date: string; material_name: string | null })[]
  }
  issues: {
    summary: {
      total: number
      pending: number
      processing: number
      closed: number
      unresolved: number
    }
    problems: {
      problem_type_id: number | null
      name: string
      issue_count: number
      unresolved_count: number
    }[]
    teams: {
      team_id: number
      team_name: string
      issue_count: number
      unresolved_count: number
    }[]
    trend: { date: string; total: number; unresolved: number }[]
  }
}

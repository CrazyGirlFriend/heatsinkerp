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
  scrap_quantity: number
  scrap_weight: number
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

export interface PerformanceFilters {
  date_from: string
  date_to: string
  team_id?: number
}

export interface FactoryPerformance {
  date_from: string
  date_to: string
  generated_at: string
  teams: { id: number; code: string; name: string; active: boolean }[]
  production: {
    totals: ProductionMetrics
    teams: (ProductionMetrics & { team_id: number; team_name: string })[]
    trend: (ProductionMetrics & { date: string })[]
  }
  quality: {
    groups: (QualityMetrics & QualityBasis & { team_id: number; team_name: string })[]
    trend: (QualityMetrics & QualityBasis & { date: string })[]
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

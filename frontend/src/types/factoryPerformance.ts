import type { components } from './generated/api'
type Contract = components['schemas']
export type ProductionMetrics = Contract['ProductionMetricsResponse']
export type QualityMetrics = Pick<
  Contract['MaterialQualityResponse'],
  'record_count' | 'checked_quantity' | 'passed_quantity' | 'failed_quantity' | 'pass_rate'
>
export type QualityBasis = Pick<Contract['MaterialQualityResponse'], 'kind' | 'scope' | 'phase'>
export type PerformancePeriod = Contract['FactoryPerformanceResponse']['period']
type RouteFields = 'process_route_id' | 'process_step_index' | 'process_step_name'
// Historical report fixtures and cached views can omit route metadata.
export type ProductionScope = Omit<Contract['ProductionScopeResponse'], RouteFields> &
  Partial<Pick<Contract['ProductionScopeResponse'], RouteFields>>

export interface PerformanceFilters {
  include_activity?: boolean
  date_from: string
  date_to: string
  team_id?: number
  period?: PerformancePeriod
  serial_no?: string
  work_id?: number
  material_name?: string
}

export type FactoryPerformance = Omit<
  Contract['FactoryPerformanceResponse'],
  'production' | 'activity'
> & {
  production: Omit<Contract['ProductionReportResponse'], 'scope' | 'scopes'> & {
    scope: ProductionScope | null
    scopes: ProductionScope[]
  }
  activity?: Contract['ProductionActivityResponse']
}

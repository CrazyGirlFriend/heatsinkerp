import type { FactoryStockMatrix } from './factoryOverview'

export interface SerialChoice {
  serial_no: string
  created_at: string
}
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
export interface ShipmentSeries extends SerialChoice {
  values: (number | null)[]
}
export interface Shipments {
  dates: string[]
  series: ShipmentSeries[]
}
export interface YieldRow {
  material: string
  input_weight: number
  output_weight: number
  rate: number | null
  completed_count?: number
  active_count?: number
  serial_no?: string
  status?: 'complete' | 'in_progress' | 'needs_review'
}
export interface TeamYield {
  team_id: number
  team_name: string
  input_weight: number
  output_weight: number
  rate: number | null
  status: 'complete' | 'in_progress'
}
export interface Installment {
  label: string
  due_date: string
  quantity: number
}
export interface DeliveryPlan {
  serial_no: string
  version: number
  installments: Installment[]
}
export interface Delivery extends Installment {
  serial_no: string
  index: number
  shipped: number
  remaining: number
  completed_on: string | null
  status: 'on_time' | 'late_complete' | 'overdue' | 'pending'
  overdue_days: number
}
export interface AttentionSerial {
  serial_no: string
  materials: string[]
  teams: string[]
  reasons: string[]
  age_days: number
  overdue_days: number
  remaining: number | null
}
export interface FactoryDashboard {
  as_of: string
  today: string
  stock: FactoryStockMatrix
  yields: YieldRow[]
  delivery: {
    on_time_rate: number | null
    due_count: number
    overdue_count: number
    upcoming_count: number
    items: Delivery[]
    total: number
  }
  shipping: Shipments
  serial_count: number
  attention: AttentionSerial[]
  legacy_count: number
}

export interface StockDetail {
  team_id: number
  team_name: string
  serial_no: string
  material: string
  material_type: string | null
  quantity: number
  weight: number
}

import { httpRequest } from './httpClient'

export interface InspectionSource {
  source_transfer_id: number
  team_id: number
  serial_no: string
  batch_no: string
  material_name: string
  specification: string | null
  quantity: number
  revision: number
  hold_id: number | null
  processing_status: string
}
export interface InspectionRecord {
  id: number
  source_transfer_id: number
  team_id: number
  team_name: string
  serial_no: string
  batch_no: string
  material_name: string
  specification: string | null
  inspector_employee_id: number
  inspector_name: string
  processing_record_id: number | null
  processor_name: string | null
  checked_at: string
  batch_quantity: number
  sample_quantity: number
  passed_quantity: number
  failed_quantity: number
  status: 'pending' | 'released' | 'passed' | 'failed'
  notes: string
  parent_id: number | null
  released_at: string | null
  created_by: string
}
export interface InspectionCreate {
  source_transfer_id: number
  expected_revision: number
  inspector_employee_id: number
  checked_at: string
  sample_quantity: number
  failed_quantity: number
  notes: string
  parent_id?: number
  idempotency_key: string
}
export interface InspectionFilters {
  team_id?: number
  source_transfer_id?: number
  query?: string
  inspector_id?: number
  status?: InspectionRecord['status']
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}
interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
function query(params: object) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString()
}
export const inspectionApi = {
  recheckContext: (id: number) =>
    httpRequest<InspectionSource>(`/inspections/${id}/recheck-context`),
  records: (params: InspectionFilters) =>
    httpRequest<Page<InspectionRecord>>(`/inspections?${query(params)}`),
  sources: (params: { team_id: number; query?: string; page?: number; page_size?: number }) =>
    httpRequest<Page<InspectionSource>>(`/inspections/sources?${query(params)}`),
  create: (body: InspectionCreate) =>
    httpRequest<InspectionRecord>('/inspections', { method: 'POST', body }),
}
export const inspectionStatusLabels = {
  pending: '待处理 · 禁止转出',
  released: '已复检放行',
  passed: '抽检合格',
  failed: '复检不合格',
}

import { httpRequest } from './httpClient'

type Contract = import('@/types/generated/api').components['schemas']
export type InspectionSource = Omit<Contract['InspectionSourceResponse'], 'is_outsourced'> & {
  is_outsourced?: boolean
}
export type InspectionRecord = Omit<
  Contract['InspectionRecordResponse'],
  'process_step' | 'problems' | 'is_outsourced' | 'failure_lines'
> & {
  is_outsourced?: boolean
  failure_lines?: Contract['RecordedFailureLine'][]
  process_step?: import('@/types/processRoute').ProcessRouteContext | null
  problems?: Contract['InspectionRecordResponse']['problems']
}
export interface InspectionCreate {
  kind: InspectionRecord['kind']
  scope: InspectionRecord['scope']
  methods: InspectionRecord['methods']
  items: InspectionRecord['items']
  dimension_result: string
  weight_result: string
  failure_lines?: Contract['FailureLine'][]
  involved_team_ids?: number[]
  problem_type_ids?: number[]
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
  table_query?: string
  kind?: InspectionRecord['kind']
  scope?: InspectionRecord['scope']
  team_id?: number
  source_transfer_id?: number
  query?: string
  inspector_id?: number
  problem_type_id?: number
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
  records: (params: InspectionFilters) =>
    httpRequest<Page<InspectionRecord>>(`/inspections?${query(params)}`),
  sources: (params: {
    team_id: number
    kind?: InspectionRecord['kind']
    recheck_id?: number
    group_id?: number
    query?: string
    page?: number
    page_size?: number
  }) => httpRequest<Page<InspectionSource>>(`/inspections/sources?${query(params)}`),
  create: (body: InspectionCreate) =>
    httpRequest<InspectionRecord>('/inspections', { method: 'POST', body }),
}
export { inspectionStatusLabels } from '@/types/qualityStatus'
export const inspectionMethodLabels = { visual: '目视', microscope: '显微镜' }
export const inspectionItemLabels = { appearance: '外观', dimension: '尺寸', weight: '重量' }
export function inspectionProblemLabel(
  row: Pick<InspectionRecord, 'problems' | 'failed_quantity' | 'failure_lines'>,
) {
  return (
    row.failure_lines
      ?.map(
        (l) =>
          `${l.category} ${l.quantity}件 · ${l.disposition === 'rework' ? l.repair_team_name + '返修' : '判废'}`,
      )
      .join('、') ||
    row.problems?.map((problem) => problem.name).join('、') ||
    (row.failed_quantity > 0 ? '历史未分类' : '—')
  )
}

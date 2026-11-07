import { httpRequest } from './httpClient'
import type { InspectionRecord } from './inspectionApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

type Contract = import('@/types/generated/api').components['schemas']
export type QualityReworkStock = Contract['QualityReworkStockResponse']

export const feedbackStates = { pending: '待处理', processing: '处理中', closed: '已结束' }
export const dispositions = {
  pending: '待判定',
  rework: '返工',
  shipment: '发货',
  transfer: '转料',
  reallocate: '班组内转投',
  scrap: '报废',
  other: '其他处理',
}
export type QualityFeedback = InspectionRecord &
  Pick<Contract['QualityFeedbackResponse'], 'involved_teams'>
export type QualityFeedbackDetail = QualityFeedback &
  Pick<Contract['QualityFeedbackDetailResponse'], 'events'> & {
    rechecks: InspectionRecord[]
  }
export interface QualityFilters {
  problem_type_id?: number
  team_id?: number
  query?: string
  kind?: InspectionRecord['kind']
  status?: keyof typeof feedbackStates
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}
interface Write {
  notes: string
  expected_version: number
  idempotency_key: string
}
export interface QualityDecision extends Write {
  disposition: keyof typeof dispositions
  status: keyof typeof feedbackStates
  involved_team_ids: number[]
  release_legacy_hold: boolean
}
export const qualityFeedbackApi = {
  records: (params: QualityFilters) =>
    httpRequest<{ items: QualityFeedback[]; total: number; pending_count: number }>(
      `/quality-feedback?${new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      )}`,
    ),
  detail: (id: number) => httpRequest<QualityFeedbackDetail>(`/quality-feedback/${id}`),
  reworkStock: (id: number, page = 1) =>
    httpRequest<{ items: QualityReworkStock[]; total: number }>(
      `/quality-feedback/${id}/rework-stock?page=${page}`,
    ),
  reworkContext: (id: number, lotId: number) =>
    httpRequest<QuantityAdjustmentContext>(
      `/quality-feedback/${id}/rework-stock?source_transfer_id=${lotId}`,
    ),
  reply: (id: number, body: Write) =>
    httpRequest<QualityFeedbackDetail>(`/quality-feedback/${id}/reply`, { method: 'POST', body }),
  decide: (id: number, body: QualityDecision) =>
    httpRequest<QualityFeedbackDetail>(`/quality-feedback/${id}/decision`, {
      method: 'POST',
      body,
    }),
}

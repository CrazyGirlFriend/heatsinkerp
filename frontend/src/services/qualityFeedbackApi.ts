import { httpRequest } from './httpClient'
import type { InspectionRecord } from './inspectionApi'

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
export interface QualityFeedback extends InspectionRecord {
  involved_teams: { team_id: number; name: string; replied: boolean }[]
}
export interface QualityFeedbackDetail extends QualityFeedback {
  events: {
    id: number
    kind: 'reply' | 'decision'
    team_id: number
    team_name: string
    actor: string
    notes: string
    occurred_at: string
    details: {
      disposition?: keyof typeof dispositions
      status?: keyof typeof feedbackStates
      released_legacy_hold?: boolean
      involved_team_ids?: number[]
    }
  }[]
  rechecks: InspectionRecord[]
}
export interface QualityFilters {
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
  reply: (id: number, body: Write) =>
    httpRequest<QualityFeedbackDetail>(`/quality-feedback/${id}/reply`, { method: 'POST', body }),
  decide: (id: number, body: QualityDecision) =>
    httpRequest<QualityFeedbackDetail>(`/quality-feedback/${id}/decision`, {
      method: 'POST',
      body,
    }),
}

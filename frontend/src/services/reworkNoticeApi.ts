import { httpRequest } from './httpClient'
import type { ProcessRoute } from '@/types/processRoute'
export interface ReworkNotice {
  id: number
  kind: 'requested' | 'ready'
  route_id: number
  state: 'draft' | 'published'
  serial_no: string
  batch_no: string
  problem: string
  submitting_team: string
  submitted_by: string | null
  engineering_employee_name: string | null
  created_at: string
  read_at: string | null
}
export const reworkNoticeApi = {
  route: (id: number) => httpRequest<ProcessRoute>(`/rework-notices/${id}/route`),
  list: (teamId: number, page = 1) =>
    httpRequest<{ items: ReworkNotice[]; total: number; unread: number }>(
      `/rework-notices?team_id=${teamId}&page=${page}`,
    ),
  read: (id: number) => httpRequest(`/rework-notices/${id}/read`, { method: 'POST' }),
}

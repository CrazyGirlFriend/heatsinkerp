import { httpRequest } from './httpClient'
import type { ProcessRoute } from '@/types/processRoute'
export type NoticeSource = 'schedule' | 'rework'
export interface BusinessNotice {
  id: number
  source: NoticeSource
  kind:
    | 'new'
    | 'changed'
    | 'cancelled'
    | 'upstream'
    | 'final_due'
    | 'due_soon'
    | 'overdue'
    | 'requested'
    | 'ready'
    | 'review'
    | 'returned'
    | 'locked'
    | 'unlocked'
  message: string
  serial_no: string
  batch_no: string | null
  team_name: string
  created_at: string
  read_at: string | null
}
export interface NoticeTarget {
  href: string
  schedule_id?: number
  event_id?: number | null
  batch_id?: number | null
  section?: 'problem' | 'steps' | 'plan-review'
  step_index?: number
  route?: ProcessRoute
}
export function parseNotice(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^(schedule|rework):([1-9]\d*)$/.exec(value)
  return match ? { source: match[1] as NoticeSource, id: Number(match[2]) } : null
}
export const businessNoticeApi = {
  list: (page = 1, unreadOnly = false, category = 'all') =>
    httpRequest<{
      items: BusinessNotice[]
      total: number
      unread: number
      latest: Record<NoticeSource, number>
    }>(`/business-notices?page=${page}&unread_only=${unreadOnly}&category=${category}`),
  target: (source: NoticeSource, id: number) =>
    httpRequest<NoticeTarget>(`/business-notices/${source}/${id}/target`),
  read: (source: NoticeSource, id: number) =>
    httpRequest(`/business-notices/${source}/${id}/read`, { method: 'POST' }),
  readAll: (latest: Record<NoticeSource, number>) =>
    httpRequest('/business-notices/read-all', { method: 'POST', body: latest }),
}

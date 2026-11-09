import { httpRequest } from './httpClient'
import type { ProcessRoute } from '@/types/processRoute'
import type { components } from '@/types/generated/api'

export type BusinessNotice = components['schemas']['BusinessNoticeResponse']
export type NoticeSource = BusinessNotice['source']
// Route editors also accept local drafts; keep that view type at this boundary.
export type NoticeTarget = Omit<components['schemas']['NoticeTargetResponse'], 'route'> & {
  route?: ProcessRoute | null
}
export function parseNotice(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^(schedule|rework|transfer|quality):([1-9]\d*)$/.exec(value)
  return match ? { source: match[1] as NoticeSource, id: Number(match[2]) } : null
}
export const businessNoticeApi = {
  list: (page = 1, unreadOnly = false, category = 'all') =>
    httpRequest<components['schemas']['BusinessNoticePageResponse']>(
      `/business-notices?page=${page}&unread_only=${unreadOnly}&category=${category}`,
    ),
  target: (source: NoticeSource, id: number) =>
    httpRequest<NoticeTarget>(`/business-notices/${source}/${id}/target`),
  read: (source: NoticeSource, id: number) =>
    httpRequest(`/business-notices/${source}/${id}/read`, { method: 'POST' }),
  readAll: (latest: Record<NoticeSource, number>) =>
    httpRequest('/business-notices/read-all', { method: 'POST', body: latest }),
}

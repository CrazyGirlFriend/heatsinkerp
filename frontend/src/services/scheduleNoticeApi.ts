import { httpRequest } from './httpClient'
export interface ScheduleNotice {
  id: number
  kind: 'new' | 'changed' | 'cancelled' | 'upstream' | 'final_due' | 'due_soon' | 'overdue'
  message: string
  serial_no: string
  team_name: string
  created_at: string
  read_at: string | null
  href: string
}
export const scheduleNoticeApi = {
  list: (page = 1, unreadOnly = false) =>
    httpRequest<{ items: ScheduleNotice[]; total: number; unread: number; latest_id: number }>(
      `/schedule-notices?page=${page}&unread_only=${unreadOnly}`,
    ),
  refresh: () => httpRequest('/schedule-notices/refresh', { method: 'POST' }),
  read: (id: number) => httpRequest(`/schedule-notices/${id}/read`, { method: 'POST' }),
  readAll: (throughId: number) =>
    httpRequest('/schedule-notices/read-all', { method: 'POST', body: { through_id: throughId } }),
}

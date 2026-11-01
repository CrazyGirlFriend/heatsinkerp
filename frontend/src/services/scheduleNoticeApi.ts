import { httpRequest } from './httpClient'
export const scheduleNoticeApi = {
  refresh: () => httpRequest('/schedule-notices/refresh', { method: 'POST' }),
}

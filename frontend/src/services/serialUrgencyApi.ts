import { httpRequest } from './httpClient'
import type { SerialUrgency } from '@/types/recordFilters'
import type { components } from '@/types/generated/api'

export type SerialUrgencyUpdate = components['schemas']['UrgencyUpdate']

export const serialUrgencyApi = {
  get(serialNo: string) {
    return httpRequest<SerialUrgency>(`/serial-urgency?serial_no=${encodeURIComponent(serialNo)}`)
  },
  update(payload: SerialUrgencyUpdate) {
    return httpRequest<SerialUrgency>('/serial-urgency', { method: 'PUT', body: payload })
  },
}

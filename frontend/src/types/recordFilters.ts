import type { components } from './generated/api'

export interface RecordFilterParams {
  date_from?: string
  date_to?: string
  urgent_only?: boolean
}
export interface CalendarRange {
  from: string
  to: string
}
export type SerialUrgency = components['schemas']['UrgencyResponse']

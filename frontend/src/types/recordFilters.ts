import type { components } from './generated/api'

export interface RecordFilterParams {
  table_query?: string
  date_from?: string
  date_to?: string
}
export interface CalendarRange {
  from: string
  to: string
}
export type SerialUrgency = components['schemas']['UrgencyResponse']

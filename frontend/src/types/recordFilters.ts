export interface RecordFilterParams { date_from?: string; date_to?: string; urgent_only?: boolean }
export interface CalendarRange { from: string; to: string }
export interface SerialUrgency { urgent: boolean; reason: string | null; version: number; updated_by: string | null; updated_at: string | null }

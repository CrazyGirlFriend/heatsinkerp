import type { RouteMaterialField } from './processRoute'

export type ReceiptDocumentKind = 'process' | 'drawing' | 'order'

export interface ReceiptDocument {
  id: number
  kind: ReceiptDocumentKind
  filename: string
  size_bytes: number
  sha256: string
  transfer_id?: number | null
  confirmed_at?: string | null
  parsed: {
    serial_nos?: string[]
    serial_no?: string
    receipt_fields?: Record<string, RouteMaterialField>
    review_required?: boolean
  }
}

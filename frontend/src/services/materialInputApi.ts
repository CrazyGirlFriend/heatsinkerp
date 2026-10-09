import { httpRequest } from './httpClient'

export type MaterialInputField =
  | 'serial_no'
  | 'material_name'
  | 'customer_code'
  | 'product_code'
  | 'part_no'
  | 'external_source'
  | 'outsourced_unit'
export interface MaterialSuggestion {
  value: string
  source_batch_no: string
  details: Partial<
    Record<
      | 'material_name'
      | 'finished_specification'
      | 'customer_code'
      | 'product_code'
      | 'part_no'
      | 'technical_requirements',
      string | null
    >
  >
}
export async function materialSuggestions(field: MaterialInputField, query: string) {
  const result = await httpRequest<{ items: MaterialSuggestion[] }>(
    `/material-input-suggestions?${new URLSearchParams({ field, query: query.slice(0, 160) })}`,
    { noCache: true },
  )
  return result.items
}

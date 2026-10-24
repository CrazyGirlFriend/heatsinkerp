import { shallowRef } from 'vue'
import type { ProcessRoute } from '@/types/processRoute'

type DocumentImportFields = NonNullable<ProcessRoute['source_data']['receipt_fields']>
type FieldValue = string | number | null | undefined

export function useDocumentImport() {
  const fields = shallowRef<DocumentImportFields>({})

  function record(imported: DocumentImportFields) {
    fields.value = Object.fromEntries(
      Object.entries(imported).map(([key, field]) => [key, { ...field }]),
    )
  }
  function reset() {
    fields.value = {}
  }
  function original(key: string) {
    return fields.value[key]?.value
  }
  function state(key: string, current: FieldValue): 'imported' | 'edited' | '' {
    const field = fields.value[key]
    if (!field) return ''
    return current != null && String(current) === String(field.value) ? 'imported' : 'edited'
  }

  return { record, reset, state, original }
}

import { reactive, watch } from 'vue'
import type { MaterialSuggestion } from '@/services/materialInputApi'

export function useMaterialAutofill(serial: () => string, document: Record<string, string>) {
  const filled = reactive<Record<string, { value: string; batch: string }>>({})
  function reset() {
    Object.keys(filled).forEach((key) => delete filled[key])
  }
  // A different serial must never retain an untouched value from the last suggestion.
  watch(
    serial,
    () => {
      for (const [key, item] of Object.entries(filled)) {
        if (document[key] === item.value) document[key] = ''
        delete filled[key]
      }
    },
    { flush: 'sync' },
  )
  function select(item: MaterialSuggestion) {
    for (const [key, value] of Object.entries(item.details)) {
      if (document[key] && document[key] !== filled[key]?.value) continue
      document[key] = value || ''
      if (value) filled[key] = { value, batch: item.source_batch_no }
      else delete filled[key]
    }
  }
  function source(key: string) {
    const item = filled[key]
    return item && document[key] === item.value ? item.batch : ''
  }
  return { select, source, reset }
}

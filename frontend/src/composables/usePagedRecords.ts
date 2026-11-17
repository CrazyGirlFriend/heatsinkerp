import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'

export function usePagedRecords<R extends { items: unknown[]; total: number }>(
  fetchPage: (pagination: { page: number; page_size: number }) => Promise<R>,
  options: { errorMessage: string; clearOnError: boolean },
) {
  const rows = shallowRef<R['items']>([])
  const result = shallowRef<R>()
  const total = ref(0),
    page = ref(1),
    size = ref(10),
    loading = ref(false),
    error = ref('')
  let generation = 0

  function invalidate() {
    ++generation
    rows.value = []
  }
  watch([page, size], invalidate, { flush: 'sync' })
  onBeforeUnmount(() => ++generation)

  async function load(background = false): Promise<void> {
    const token = ++generation
    if (!background) loading.value = true
    error.value = ''
    try {
      const response = await fetchPage({ page: page.value, page_size: size.value })
      if (token !== generation) return
      const last = Math.max(1, Math.ceil(response.total / size.value))
      if (page.value > last) {
        page.value = last
        await load(background)
        return
      }
      rows.value = response.items
      total.value = response.total
      result.value = response
    } catch (failure) {
      if (token === generation) {
        if (background) throw failure
        if (options.clearOnError) rows.value = []
        error.value = failure instanceof Error ? failure.message : options.errorMessage
      }
    } finally {
      if (token === generation) loading.value = false
    }
  }

  return { rows, result, total, page, size, loading, error, load, invalidate }
}

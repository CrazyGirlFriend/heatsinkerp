import { computed, shallowReactive, type Ref } from 'vue'

export function useBatchSelection<T>(
  rows: Ref<T[]>,
  id: (row: T) => string,
  available: (row: T) => boolean,
) {
  const selected = shallowReactive(new Map<string, T>())
  const availableRows = computed(() => rows.value.filter(available))
  const checkedCount = computed(
    () => availableRows.value.filter((row) => selected.has(id(row))).length,
  )
  const allChecked = computed(
    () => availableRows.value.length > 0 && checkedCount.value === availableRows.value.length,
  )
  function toggle(row: T, checked: string | number | boolean) {
    const key = id(row)
    if (!checked) selected.delete(key)
    else if (available(row) && (selected.has(key) || selected.size < 100)) selected.set(key, row)
  }
  function toggleAll(checked: string | number | boolean) {
    availableRows.value.forEach((row) => toggle(row, checked))
  }
  function reconcile(items: T[]) {
    for (const row of items)
      if (selected.has(id(row))) {
        if (available(row)) selected.set(id(row), row)
        else selected.delete(id(row))
      }
  }
  return {
    selected,
    available,
    availableRows,
    checkedCount,
    allChecked,
    toggle,
    toggleAll,
    reconcile,
  }
}

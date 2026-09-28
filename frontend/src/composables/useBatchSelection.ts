import { computed, shallowReactive, type Ref } from 'vue'

export function useBatchSelection<T>(rows: Ref<T[]>, id: (row: T) => string, amounts: (row: T) => { quantity: number | null; weight: number | null }) {
  const selected = shallowReactive(new Map<string, T>())
  const available = (row: T) => { const value = amounts(row); return value.quantity !== null && value.weight !== null && (value.quantity > 0 || value.weight > 0) }
  const availableRows = computed(() => rows.value.filter(available))
  const checkedCount = computed(() => availableRows.value.filter(row => selected.has(id(row))).length)
  const allChecked = computed(() => availableRows.value.length > 0 && checkedCount.value === availableRows.value.length)
  const totals = computed(() => [...selected.values()].reduce((sum, row) => {
    const value = amounts(row)
    return { quantity: sum.quantity + (value.quantity ?? 0), weight: Math.round((sum.weight + (value.weight ?? 0)) * 1000) / 1000 }
  }, { quantity: 0, weight: 0 }))
  function toggle(row: T, checked: string | number | boolean) {
    const key = id(row)
    if (!checked) selected.delete(key)
    else if (available(row) && (selected.has(key) || selected.size < 100)) selected.set(key, row)
  }
  function toggleAll(checked: string | number | boolean) { availableRows.value.forEach(row => toggle(row, checked)) }
  function reconcile(items: T[]) {
    for (const row of items) if (selected.has(id(row))) {
      if (available(row)) selected.set(id(row), row)
      else selected.delete(id(row))
    }
  }
  return { selected, available, availableRows, checkedCount, allChecked, totals, toggle, toggleAll, reconcile }
}

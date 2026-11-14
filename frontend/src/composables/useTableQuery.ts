import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'

import type { TableQueryColumn, TableQueryController, TableQueryState } from '@/types/tableQuery'

/** A list owns its query; the table supplies the same header controls everywhere. */
export function useTableQuery(
  columns: MaybeRefOrGetter<Record<string, TableQueryColumn>>,
  reload: () => void,
) {
  const state = ref<TableQueryState>({ filters: [] })
  const params = computed(() =>
    state.value.filters.length || state.value.sort
      ? { table_query: JSON.stringify(state.value) }
      : {},
  )
  const controller = computed<TableQueryController>(() => ({
    columns: toValue(columns),
    state: state.value,
    filter(column, value, end) {
      state.value = {
        ...state.value,
        filters: [
          ...state.value.filters.filter((item) => item.field !== column.field),
          ...(value || end
            ? [{ field: column.field, kind: column.kind || 'text', value, end }]
            : []),
        ],
      }
      reload()
    },
    sort(field, direction) {
      state.value = { ...state.value, sort: direction ? { field, direction } : undefined }
      reload()
    },
  }))
  return {
    state,
    params,
    controller,
    reset: () => {
      state.value = { filters: [] }
    },
  }
}

/** Full in-memory directories only: filter and sort before their own pagination/export. */
export function useLocalTableQuery<T>(
  columns: Record<string, TableQueryColumn>,
  rows: MaybeRefOrGetter<T[]>,
  read: (row: T, field: string) => unknown,
  changed: () => void,
  defaultOrder?: (a: T, b: T) => number,
) {
  const query = useTableQuery(columns, changed)
  const result = computed(() => {
    const items = toValue(rows).filter((row) =>
      query.state.value.filters.every((condition) => {
        const value = read(row, condition.field)
        if (value == null) return false
        const text = String(value)
        if (condition.kind === 'number')
          return (
            (!condition.value || Number(value) >= Number(condition.value)) &&
            (!condition.end || Number(value) <= Number(condition.end))
          )
        if (condition.kind === 'date')
          return (
            (!condition.value || text.slice(0, 10) >= condition.value) &&
            (!condition.end || text.slice(0, 10) <= condition.end)
          )
        if (condition.kind === 'select') return condition.value.split(',').includes(text)
        return text.toLocaleLowerCase().includes(condition.value.toLocaleLowerCase())
      }),
    )
    const sort = query.state.value.sort
    return items.sort((a, b) => {
      if (!sort) return defaultOrder?.(a, b) || 0
      const left = read(a, sort.field),
        right = read(b, sort.field)
      if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
      return order * (sort.direction === 'asc' ? 1 : -1) || defaultOrder?.(a, b) || 0
    })
  })
  return { ...query, rows: result }
}

import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'

import type {
  TableQueryColumn,
  TableQueryController,
  TableQueryState,
  TableColumnCondition,
  TableOptionPage,
} from '@/types/tableQuery'

/** A list owns its query; the table supplies the same header controls everywhere. */
export function useTableQuery(
  columns: MaybeRefOrGetter<Record<string, TableQueryColumn>>,
  reload: () => void,
  optionsSource?: (tableQuery: string) => Promise<unknown>,
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
    loadOptions: optionsSource
      ? async (column, search, offset) => {
          const result = (await optionsSource(
            JSON.stringify({
              ...state.value,
              options: {
                field: column.field,
                kind: column.kind || 'text',
                search: column.options?.length ? '' : (column.optionSearch?.(search) ?? search),
                offset,
              },
            }),
          )) as TableOptionPage
          if (!Array.isArray(result.values)) throw new Error('筛选选项加载失败，请刷新后重试')
          return column.options?.length && search
            ? {
                ...result,
                values: result.values.filter((value) =>
                  (
                    column.options?.find((option) => option.value === value)?.label ||
                    value ||
                    '(空白)'
                  )
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                ),
              }
            : result
        }
      : undefined,
    filter(column, value, end, details) {
      state.value = {
        ...state.value,
        filters: [
          ...state.value.filters.filter((item) => item.field !== column.field),
          ...(value || end || details?.operator
            ? [{ field: column.field, kind: column.kind || 'text', value, end, ...details }]
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
        return matchesTableCondition(read(row, condition.field), condition)
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
  const controller = computed<TableQueryController>(() => ({
    ...query.controller.value,
    async loadOptions(column, search, offset) {
      const values = [
        ...new Set(
          toValue(rows)
            .filter((row) =>
              query.state.value.filters.every(
                (condition) =>
                  condition.field === column.field ||
                  matchesTableCondition(read(row, condition.field), condition),
              ),
            )
            .map((row) => {
              const value = read(row, column.field)
              return value == null || value === '' ? null : String(value)
            }),
        ),
      ]
        .filter(
          (value) => !search || value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .sort((a, b) =>
          a == null ? -1 : b == null ? 1 : a.localeCompare(b, 'zh-CN', { numeric: true }),
        )
      return {
        values: values.slice(offset, offset + 100),
        has_more: values.length > offset + 100,
        next_offset: Math.min(offset + 100, values.length),
      }
    },
  }))
  return { ...query, controller, rows: result }
}

export function matchesTableCondition(value: unknown, condition: TableColumnCondition) {
  const blank = value == null || value === ''
  const operator = condition.operator
  if (operator === 'blank') return blank
  if (operator === 'not_blank') return !blank
  const text = blank ? '' : String(value)
  if (operator === 'in' || operator === 'not_in') {
    const included = (condition.values || []).includes(blank ? null : text)
    return operator === 'in' ? included : !included
  }
  if (blank) return false
  const input = condition.value
  if (condition.kind === 'number' || condition.kind === 'date') {
    const actual = condition.kind === 'number' ? Number(value) : text.slice(0, 10)
    const lower = condition.kind === 'number' ? Number(input) : input
    const upper = condition.kind === 'number' ? Number(condition.end) : condition.end
    if (operator === 'eq') return actual === lower
    if (operator === 'ne') return actual !== lower
    if (operator === 'gt') return actual > lower
    if (operator === 'gte') return actual >= lower
    if (operator === 'lt') return actual < lower
    if (operator === 'lte') return actual <= lower
    return (!input || actual >= lower) && (!condition.end || actual <= upper)
  }
  if (condition.kind === 'select' && !operator) return input.split(',').includes(text)
  const a = text.toLocaleLowerCase(),
    b = input.toLocaleLowerCase()
  if (operator === 'eq') return a === b
  if (operator === 'ne') return a !== b
  if (operator === 'starts_with') return a.startsWith(b)
  if (operator === 'ends_with') return a.endsWith(b)
  if (operator === 'not_contains') return !a.includes(b)
  return a.includes(b)
}

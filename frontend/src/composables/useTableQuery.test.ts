import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useLocalTableQuery, useTableQuery } from './useTableQuery'
const columns = { quantity: { field: 'quantity', kind: 'number' as const } }
describe('table query controllers', () => {
  it('combines column filters and sorting in the same request and clears independently', () => {
    const reload = vi.fn()
    const query = useTableQuery(columns, reload)
    query.controller.value.filter(columns.quantity, '0', '20')
    query.controller.value.sort('quantity', 'desc')
    expect(JSON.parse(query.params.value.table_query!)).toEqual({
      filters: [{ field: 'quantity', kind: 'number', value: '0', end: '20' }],
      sort: { field: 'quantity', direction: 'desc' },
    })
    query.controller.value.filter(columns.quantity, '', '')
    expect(query.state.value.sort?.direction).toBe('desc')
    query.controller.value.sort('quantity')
    expect(query.params.value).toEqual({})
    expect(reload).toHaveBeenCalledTimes(4)
  })
  it('sorts and filters full local directories without mutating them before pagination', () => {
    const rows = ref([{ quantity: 30 }, { quantity: 2 }, { quantity: 10 }])
    const query = useLocalTableQuery(columns, rows, (row) => row.quantity, vi.fn())
    query.controller.value.filter(columns.quantity, '5', '')
    query.controller.value.sort('quantity', 'asc')
    expect(query.rows.value.slice(0, 1)).toEqual([{ quantity: 10 }])
    expect(query.rows.value).toHaveLength(2)
    expect(rows.value[0]?.quantity).toBe(30)
  })
})

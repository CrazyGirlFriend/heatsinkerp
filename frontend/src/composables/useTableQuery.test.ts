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

it('keeps blank and exact multi-value filters active and requests options without changing the list', async () => {
  const source = vi.fn().mockResolvedValue({ values: ['铜,钼'], has_more: false, next_offset: 1 })
  const reload = vi.fn(),
    column = { field: 'material_name', kind: 'text' as const }
  const query = useTableQuery({ column }, reload, source)
  query.controller.value.filter(column, '', '', { operator: 'in', values: ['铜,钼', null] })
  const before = query.params.value.table_query
  await query.controller.value.loadOptions!(column, '铜', 0)
  expect(query.params.value.table_query).toBe(before)
  expect(reload).toHaveBeenCalledTimes(1)
  expect(JSON.parse(source.mock.calls[0]![0]).options).toEqual({
    field: 'material_name',
    kind: 'text',
    search: '铜',
    offset: 0,
  })
  expect(JSON.parse(before!).filters[0].values).toEqual(['铜,钼', null])
})

it('derives local options from all rows under other-column filters, and supports empty selection', async () => {
  const column = { field: 'name', kind: 'text' as const },
    quantity = columns.quantity
  const rows = ref([
    { name: null, quantity: 1 },
    { name: '铜,钼', quantity: 3 },
    { name: '钢', quantity: 10 },
  ])
  const query = useLocalTableQuery(
    { column, quantity },
    rows,
    (row, field) => row[field as keyof typeof row],
    vi.fn(),
  )
  query.controller.value.filter(quantity, '2', '', { operator: 'gt' })
  query.controller.value.filter(column, '', '', { operator: 'in', values: ['铜,钼'] })
  expect(query.rows.value).toHaveLength(1)
  const options = await query.controller.value.loadOptions!(column, '', 0)
  expect(new Set(options.values)).toEqual(new Set(['铜,钼', '钢']))
  query.controller.value.filter(column, '', '', { operator: 'in', values: [] })
  expect(query.rows.value).toHaveLength(0)
  query.controller.value.filter(column, '', '', { operator: 'not_in', values: ['铜,钼'] })
  expect(query.rows.value[0]?.name).toBe('钢')
})

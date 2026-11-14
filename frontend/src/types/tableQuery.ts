export interface TableQueryColumn {
  field: string
  kind?: 'text' | 'number' | 'date' | 'select'
  options?: readonly { value: string; label: string }[]
}
export interface TableColumnCondition {
  field: string
  kind: NonNullable<TableQueryColumn['kind']>
  value: string
  end: string
}
export interface TableQueryState {
  filters: TableColumnCondition[]
  sort?: { field: string; direction: 'asc' | 'desc' }
}
export interface TableQueryController {
  columns: Record<string, TableQueryColumn>
  state: TableQueryState
  filter: (column: TableQueryColumn, value: string, end: string) => void
  sort: (field: string, direction?: 'asc' | 'desc') => void
}

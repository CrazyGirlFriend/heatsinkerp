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
  operator?:
    | 'contains'
    | 'not_contains'
    | 'eq'
    | 'ne'
    | 'starts_with'
    | 'ends_with'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
    | 'blank'
    | 'not_blank'
    | 'in'
    | 'not_in'
  values?: (string | null)[]
}
export interface TableOptionPage {
  values: (string | null)[]
  has_more: boolean
  next_offset: number
}
export type TableFilterDetails = Pick<TableColumnCondition, 'operator' | 'values'>
export interface TableQueryState {
  filters: TableColumnCondition[]
  sort?: { field: string; direction: 'asc' | 'desc' }
}
export interface TableQueryController {
  columns: Record<string, TableQueryColumn>
  state: TableQueryState
  filter: (
    column: TableQueryColumn,
    value: string,
    end: string,
    details?: TableFilterDetails,
  ) => void
  loadOptions?: (
    column: TableQueryColumn,
    search: string,
    offset: number,
  ) => Promise<TableOptionPage>
  sort: (field: string, direction?: 'asc' | 'desc') => void
}

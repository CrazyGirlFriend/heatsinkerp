import type { TeamInventoryParams } from '@/types/teamInventory'
import type { TableColumnCondition, TableQueryColumn, TableQueryState } from '@/types/tableQuery'
import { materialTypeLabel } from '@/types/materialTransfer'
import { processingStateLabels } from '@/types/materialProcessing'
import { inventoryQueryColumns } from '@/utils/tableQueryColumns'

const columns: Record<string, TableQueryColumn> = inventoryQueryColumns
// The query kind describes the stored value; the editor describes how staff find it.
const choiceFields = new Set([
  'task_batch_number',
  'warehouse_location',
  'material_name',
  'purpose_name',
  'team_name',
])
export const inventoryHeaderColumns: Record<string, TableQueryColumn> = Object.fromEntries(
  Object.entries(columns).map(([key, column]) => {
    if (column.field === 'source_name')
      return [key, { ...column, field: 'inventory_source_label', editor: 'choices' }]
    const editor = column.kind === 'select' || choiceFields.has(column.field) ? 'choices' : 'input'
    let valueLabel = column.valueLabel
    if (column.field === 'material_name' || column.field === 'purpose_name')
      valueLabel = (value) => value || '—'
    if (column.field === 'material_type') valueLabel = materialTypeLabel
    if (column.field === 'processing_state')
      valueLabel = (value) =>
        value === 'mixed'
          ? '部分批次有加工记录'
          : processingStateLabels[value as keyof typeof processingStateLabels] || '—'
    return [key, { ...column, editor, valueLabel }]
  }),
)
inventoryHeaderColumns.inventory_source_label = inventoryHeaderColumns.source_name!
const linkedFields = [
  'material_type',
  'processing_state',
  'material_name',
  'processing_role',
] as const

function withChoice(state: TableQueryState, field: string, value: string) {
  const filters = state.filters.filter((item) => item.field !== field)
  if (value)
    filters.push({
      field,
      kind: columns[field]?.kind || 'text',
      value: '',
      end: '',
      operator: 'in',
      values: [
        (field === 'material_type' && value === 'unknown') || value === '\0blank' ? null : value,
      ],
    })
  return { ...state, filters }
}

export function readInventoryQuery(
  params: TeamInventoryParams,
  headers = inventoryHeaderColumns,
): TableQueryState {
  let state: TableQueryState = { filters: [] }
  if (params.table_query) {
    try {
      const parsed = JSON.parse(params.table_query)
      if (Array.isArray(parsed?.filters)) {
        state.filters = parsed.filters.filter(
          (item: TableColumnCondition) =>
            item &&
            Object.hasOwn(headers, item.field) &&
            typeof item.value === 'string' &&
            typeof item.end === 'string' &&
            (!item.values || Array.isArray(item.values)),
        )
      }
    } catch {
      /* Older links may have no usable column query. */
    }
  }
  for (const field of linkedFields) {
    const value = params[field]
    if (value && !state.filters.some((item) => item.field === field))
      state = withChoice(
        state,
        field,
        field === 'material_name' && value === '未填写材质' ? '\0blank' : value,
      )
  }
  return state
}

export function withInventoryQuery(
  params: TeamInventoryParams,
  state: TableQueryState,
): TeamInventoryParams {
  const result = { ...params }
  for (const field of linkedFields) delete result[field]
  if (state.filters.length || state.sort) result.table_query = JSON.stringify(state)
  else delete result.table_query
  return result
}

const operators = {
  contains: '含',
  not_contains: '不含',
  eq: '',
  ne: '不等于',
  starts_with: '开头为',
  ends_with: '结尾为',
  gt: '大于',
  gte: '不少于',
  lt: '小于',
  lte: '不多于',
  blank: '空白',
  not_blank: '非空白',
  in: '',
  not_in: '排除',
  between: '',
}

export function describeCondition(item: TableColumnCondition) {
  const column = columns[item.field]
  const name = (value: string | null) =>
    column?.valueLabel?.(value) ||
    column?.options?.find((option) => option.value === value)?.label ||
    value ||
    '空白'
  const op = item.operator
  if (op === 'in' || op === 'not_in')
    return operators[op] + (item.values?.map(name).join('、') || '未选任何值')
  if (op === 'blank' || op === 'not_blank') return operators[op]
  if (item.end) return item.value ? item.value + ' 至 ' + item.end : '不超过' + item.end
  if (!op && item.kind === 'select') return item.value.split(',').map(name).join('、')
  return (op ? operators[op] : '') + name(item.value)
}

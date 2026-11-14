import { shipmentStatusLabels, scheduleStatusLabels } from '@/types/productionSchedule'
import { inspectionStatusLabels, feedbackStates } from '@/types/qualityStatus'
import type { TableQueryColumn } from '@/types/tableQuery'
import { materialTypeOptions } from '@/types/materialTransfer'
import { warehouseColumns } from '@/types/teamInventory'
import {
  inventoryProcessingStateOptions,
  processingRoleLabels,
  processingProgressLabels,
} from '@/types/materialProcessing'

type Definition = readonly [string, string, TableQueryColumn['kind']?]
export function queryColumns(definitions: readonly Definition[]) {
  return Object.fromEntries(
    definitions.flatMap(([label, field, kind = 'text']) => {
      const column: TableQueryColumn = { field, kind }
      if (field === 'material_type')
        Object.assign(column, { kind: 'select', options: materialTypeOptions })
      if (field === 'work_kind')
        Object.assign(column, {
          kind: 'select',
          options: [
            { value: 'initial', label: '首次加工' },
            { value: 'rework', label: '返工' },
          ],
        })
      const choices: Record<string, Record<string, string>> = {
        processing_status: processingProgressLabels,
        shipment_status: shipmentStatusLabels,
        handover_status: scheduleStatusLabels,
        order_completed: { '1': '已完成', '0': '未完成' },
        order_overdue: { '1': '已逾期', '0': '未逾期' },
        team_planning: { filled: '全部已填', pending: '有待填班组' },
        locked: { 已锁定: '已锁定', 未锁定: '未锁定' },
        planning_state: { 已填写: '已填写', 待填写: '待填写' },
        scope: { full: '全检', sample: '抽检' },
        kind: { inspection: '检验', patrol: '巡检' },
        inspection_type: { inspection: '检验', patrol: '巡检', recheck: '复检' },
        feedback_status: feedbackStates,
        inspection_status: inspectionStatusLabels,
      }
      if (choices[field])
        Object.assign(column, {
          kind: 'select',
          options: Object.entries(choices[field]).map(([value, label]) => ({ value, label })),
        })
      return [
        [label, column],
        [field, column],
      ]
    }),
  )
}
const fulfillmentColumns: Definition[] = [
  ['已发货（件）', 'shipped_quantity', 'number'],
  ['发货状态', 'shipment_status', 'select'],
  ['订单完成', 'order_completed', 'select'],
  ['订单逾期', 'order_overdue', 'select'],
]
export const scheduleQueryColumns = queryColumns([
  ...fulfillmentColumns,
  ['班组交付', 'handover_status', 'select'],
  ['实际交完', 'completed_at', 'date'],
  ['流水号', 'serial_no'],
  ['交货班组', 'team_name'],
  ['接收去向', 'destination'],
  ['要求交货时间', 'due_at', 'date'],
  ['最终交期', 'final_due_at', 'date'],
  ['交期填写', 'planning_state'],
  ['计划件数', 'target_quantity', 'number'],
  ['已转出件数', 'dispatched_quantity', 'number'],
  ['待交件数', 'remaining_quantity', 'number'],
  ['计划批数', 'batch_count', 'number'],
  ['关联批次', 'source_count', 'number'],
])
export const taskQueryColumns = queryColumns([
  ...fulfillmentColumns,
  ['班组排期', 'team_planning', 'select'],
  ['流水号', 'serial_no'],
  ['数量（件）', 'quantity', 'number'],
  ['交货批数', 'delivery_batches', 'number'],
  ['最终交期', 'final_due_at', 'date'],
  ['创建时间', 'created_at', 'date'],
  ['业务人员', 'business_people'],
  ['订单锁定', 'locked'],
])
export const transferQueryColumns = queryColumns([
  ['流水号', 'serial_no'],
  ['批次号', 'batch_no'],
  ['材质', 'material_name'],
  ['物料类型', 'material_type'],
  ['实际尺寸', 'transfer_specification'],
  ['件数', 'quantity', 'number'],
  ['重量 (kg)', 'weight', 'number'],
  ['转出时间', 'created_at', 'date'],
  ['登记时间', 'created_at', 'date'],
  ['入库时间', 'received_at', 'date'],
  ['上序', 'source_team_name'],
  ['转出人', 'sent_employee_name'],
  ['登记人', 'sent_employee_name'],
  ['接收人', 'received_employee_name'],
  ['接收时间', 'received_at', 'date'],
  ['来源', 'external_source'],
  ['原因', 'notes'],
  ['来源班组', 'source_team_name'],
  ['接收班组', 'next_team_name'],
  ['待签收数量（件）', 'quantity', 'number'],
  ['待签收重量（kg）', 'weight', 'number'],
  ['转料 / 登记人', 'sent_employee_name'],
  ['接收 / 登记人', 'received_employee_name'],
  ['原流水号', 'source_serial_no'],
  ['目标流水号', 'serial_no'],
  ['转投时间', 'created_at', 'date'],
  ['操作人', 'created_by'],
  ['来源批次号', 'source_batch_no'],
  ['转投批次号', 'batch_no'],
])
export const processingQueryColumns = queryColumns([
  ['流水号', 'serial_no'],
  ['批次号', 'batch_no'],
  ['实际加工日期', 'processing_date', 'date'],
  ['加工人', 'processor_name'],
  ['加工时长', 'processing_minutes', 'number'],
  ['工艺工序', 'process_step_name'],
  ['加工任务', 'processing_task_name'],
  ['物料类型', 'material_type'],
  ['本次完成件数', 'completed_quantity', 'number'],
  ['本次完成重量 (kg)', 'completed_weight', 'number'],
  ['加工前件数', 'before_quantity', 'number'],
  ['加工后件数', 'after_quantity', 'number'],
  ['加工后重量 (kg)', 'after_weight', 'number'],
  ['备注', 'reason'],
  ['登记后实际尺寸', 'after_specification'],
  ['登记时进度', 'processing_status'],
  ['登记时间', 'created_at', 'date'],
  ['加工性质', 'work_kind'],
  ['炉号', 'furnace_no'],
  ['设备号', 'machine_no'],
  ['保温时长', 'holding_minutes', 'number'],
  ['实际炉温', 'actual_temperature_c', 'number'],
])
export const inspectionQueryColumns = queryColumns([
  ['流水号', 'serial_no'],
  ['批次号', 'batch_no'],
  ['班组', 'team_name'],
  ['材质', 'material_name'],
  ['检验人', 'inspector_name'],
  ['检查人', 'inspector_name'],
  ['加工人', 'processor_name'],
  ['检验时间', 'checked_at', 'date'],
  ['检查时间', 'checked_at', 'date'],
  ['批次件数', 'batch_quantity', 'number'],
  ['抽检件数', 'sample_quantity', 'number'],
  ['发现时间', 'checked_at', 'date'],
  ['来源', 'kind'],
  ['检查类型', 'inspection_type'],
  ['检验范围', 'scope'],
  ['范围', 'scope'],
  ['检查结果', 'inspection_status'],
  ['处理状态', 'feedback_status'],
  ['检验问题', 'problems'],
  ['合格件数', 'passed_quantity', 'number'],
  ['检查件数', 'sample_quantity', 'number'],
  ['不合格件数', 'failed_quantity', 'number'],
  ['备注', 'notes'],
  ['登记时间', 'created_at', 'date'],
])
export const inventoryQueryColumns = {
  ...queryColumns([
    ['流水号', 'serial_no'],
    ['所在班组', 'team_name'],
    ['来源', 'source_name'],
    ['滞留时间', 'stock_age', 'number'],
    ['待签收件数', 'in_transit_quantity', 'number'],
    ...warehouseColumns
      .filter(
        (column) =>
          ![
            'process_route',
            'rework',
            'source',
            'urgency',
            'delivery_due_at',
            'delivery_schedule_status',
            'stock_status',
            'shortage_weight',
          ].includes(column.key),
      )
      .map((column): Definition => [
        column.label,
        column.key,
        'numeric' in column && column.numeric
          ? 'number'
          : column.key.endsWith('_at')
            ? 'date'
            : 'text',
      ]),
  ]),
  加工状态: { field: 'processing_state', kind: 'select', options: inventoryProcessingStateOptions },
  加工分类: {
    field: 'processing_role',
    kind: 'select',
    options: Object.entries(processingRoleLabels).map(([value, label]) => ({ value, label })),
  },
  processing_state: {
    field: 'processing_state',
    kind: 'select',
    options: inventoryProcessingStateOptions,
  },
  processing_role: {
    field: 'processing_role',
    kind: 'select',
    options: Object.entries(processingRoleLabels).map(([value, label]) => ({ value, label })),
  },
} satisfies Record<string, TableQueryColumn>

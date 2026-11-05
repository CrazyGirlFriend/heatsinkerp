import type { MaterialTrace, TraceBatch } from '@/types/materialTrace'
import { tableExportSource } from './tableExport'

export interface TraceProcessRow {
  key: string
  sequence: string
  name: string
  team: string
  planned: string
  received: number
  receivedWeight: number
  sent: number
  sentWeight: number
  completed: number | null
  completedWeight: number | null
  lost: number
  lostWeight: number
  stock: number | null
  stockWeight: number | null
  failed: number | null
  batches: TraceBatch[]
}

export function traceProcessRows(trace: MaterialTrace): TraceProcessRow[] {
  const items = trace.items.filter((item) => !item.context_only && item.status !== 'voided')
  const rows = new Map<string, TraceProcessRow>()
  const create = (key: string, sequence: string, name: string, team: string, planned = '') => {
    const row: TraceProcessRow = {
      key,
      sequence,
      name,
      team,
      planned,
      received: 0,
      receivedWeight: 0,
      sent: 0,
      sentWeight: 0,
      completed: null,
      completedWeight: null,
      lost: 0,
      lostWeight: 0,
      stock: 0,
      stockWeight: 0,
      failed: null,
      batches: [],
    }
    rows.set(key, row)
    return row
  }
  const routeIds = new Set(items.map((item) => item.process_route?.id).filter(Boolean))
  for (const route of trace.process_routes || []) {
    if (!routeIds.has(route.id)) continue
    route.steps.forEach((step, index) => {
      if (
        step.serial_nos?.length &&
        !step.serial_nos.includes(trace.serial_no) &&
        !items.some(
          (item) =>
            item.process_route?.id === route.id &&
            step.serial_nos.includes(item.process_route.execution_serial || item.serial_no),
        )
      )
        return
      create(
        `${route.id}:${index}`,
        `${route.route_kind === 'rework' ? '返工 ' : ''}${step.sequence_no}`,
        step.name,
        step.team_name || '未指定',
        step.planned_quantity,
      )
    })
  }
  const byBatch = new Map<number, TraceProcessRow>()
  for (const item of items) {
    if (item.status !== 'received' || !item.next_team?.id) continue
    const route = item.process_route
    const key = route ? `${route.id}:${route.step_index}` : `team:${item.next_team.id}`
    const row =
      rows.get(key) ||
      create(
        key,
        route ? String(route.sequence_no) : '—',
        route?.step_name || '未关联工艺',
        item.next_team.name,
      )
    row.batches.push(item)
    byBatch.set(Number(item.id), row)
    if (!['processing_output', 'rework_split'].includes(item.entry_kind || '')) {
      // A lot may advance through consecutive steps without another physical receipt.
      const firstWork = trace.processing_records?.find(
        (record) =>
          record.source_transfer_id === Number(item.id) &&
          record.process_route_id != null &&
          record.process_step_index != null,
      )
      const receivingRow = firstWork
        ? rows.get(`${firstWork.process_route_id}:${firstWork.process_step_index}`) || row
        : row
      receivingRow.received += item.quantity
      receivingRow.receivedWeight += item.weight
      if (receivingRow !== row) receivingRow.batches.push(item)
    }
    row.stock =
      row.stock == null || item.on_hand_quantity == null ? null : row.stock + item.on_hand_quantity
    row.stockWeight =
      row.stockWeight == null || item.on_hand_weight == null
        ? null
        : row.stockWeight + item.on_hand_weight
    for (const loss of item.loss_records || []) {
      row.lost += loss.quantity
      row.lostWeight += loss.weight
    }
    if (
      item.inspection_source_batch_no === item.batch_no &&
      item.inspection_failed_quantity != null
    )
      row.failed = (row.failed || 0) + item.inspection_failed_quantity
  }
  for (const item of items) {
    if (
      !['transfer', 'inspection_shipment', 'warehouse_outbound'].includes(
        item.entry_kind || 'transfer',
      )
    )
      continue
    const row =
      (item.process_route && item.sent_process_step_index != null
        ? rows.get(`${item.process_route.id}:${item.sent_process_step_index}`)
        : null) || byBatch.get(Number(item.source_transfer_id))
    if (row) {
      row.sent += item.quantity
      row.sentWeight += item.weight
    }
  }
  for (const record of trace.processing_records || []) {
    if (!byBatch.has(record.source_transfer_id)) continue
    const row =
      record.process_route_id != null && record.process_step_index != null
        ? rows.get(`${record.process_route_id}:${record.process_step_index}`)
        : byBatch.get(record.source_transfer_id)
    if (!row) continue
    if (record.completed_quantity != null)
      row.completed = (row.completed || 0) + record.completed_quantity
    if (record.completed_weight != null)
      row.completedWeight = (row.completedWeight || 0) + record.completed_weight
  }
  return [...rows.values()]
}

export function traceProcessExportSource(trace: MaterialTrace) {
  const rows = traceProcessRows(trace)
  const labels: Partial<Record<keyof TraceProcessRow, string>> = {
    sequence: '工序序号',
    name: '工序',
    team: '班组',
    planned: '计划加工数量',
    received: '收料件数',
    receivedWeight: '收料重量 kg',
    completed: '加工完成件次',
    completedWeight: '加工完成重量 kg',
    sent: '转出件数',
    sentWeight: '转出重量 kg',
    stock: '当前在库件数',
    stockWeight: '当前在库重量 kg',
    lost: '丢失件数',
    lostWeight: '丢失重量 kg',
    failed: '最近检验不合格件数',
  }
  return tableExportSource(
    `${trace.serial_no} · 工序统计`,
    rows.length,
    [
      { key: 'serial', label: '流水号', value: () => trace.serial_no },
      ...Object.entries(labels).map(([key, label]) => ({
        key,
        label,
        value: (row: TraceProcessRow) => row[key as Exclude<keyof TraceProcessRow, 'batches'>],
      })),
      {
        key: 'batches',
        label: '来源批次',
        value: (row) => row.batches.map((batch) => batch.batch_no).join('、'),
      },
    ],
    async () => rows,
  )
}

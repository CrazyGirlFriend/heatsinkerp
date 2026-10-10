import type { SerialHistory } from '@/types/teamBusiness'
import type { MaterialTrace, TraceBatch } from '@/types/materialTrace'
import { historyKindNames } from './serialHistoryChart'
import { formatDateTime } from './format'
import { globalTransferExportFields } from './teamTableExport'
import { tableExportSource } from './tableExport'

export function serialHistoryExportSource(history: SerialHistory) {
  const rows = history.groups
    .flatMap((group) => group.events.map((event) => ({ ...event, business: group.name })))
    .sort((a, b) => b.at.localeCompare(a.at))
  return tableExportSource(
    `${history.team_name} · ${history.serial_no} · 收发历史`,
    rows.length,
    [
      { key: 'serial_no', label: '流水号', value: () => history.serial_no },
      {
        key: 'at',
        label: '收发时间',
        value: (row: (typeof rows)[number]) => formatDateTime(row.at),
      },
      { key: 'kind', label: '操作', value: (row) => historyKindNames[row.kind] },
      { key: 'business', label: '本班组业务', value: (row) => row.business },
      { key: 'counterpart', label: '来源 / 去向', value: (row) => row.counterpart },
      { key: 'quantity', label: '件数', value: (row) => row.quantity },
      { key: 'weight', label: '重量 (kg)', value: (row) => row.weight },
      { key: 'balance_quantity', label: '变动后件数', value: (row) => row.balance_quantity },
      { key: 'balance_weight', label: '变动后重量 (kg)', value: (row) => row.balance_weight },
      { key: 'source_batch_no', label: '来源批次号', value: (row) => row.source_batch_no },
      { key: 'batch_no', label: '批次号', value: (row) => row.batch_no },
    ],
    async () => rows,
  )
}

export function traceExportSource(trace: MaterialTrace) {
  const rows = trace.items.map((row) => ({ ...row }))
  return tableExportSource(
    `${trace.serial_no} · 全链路追踪`,
    rows.length,
    [
      ...globalTransferExportFields,
      {
        key: 'on_hand_quantity',
        label: '当前未转出件数',
        value: (row: TraceBatch) => row.on_hand_quantity,
      },
      { key: 'on_hand_weight', label: '当前未转出重量 (kg)', value: (row) => row.on_hand_weight },
    ],
    async () => rows,
  )
}

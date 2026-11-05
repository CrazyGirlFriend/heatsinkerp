import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { BOARD_DAY, boardDate, boardQuantity } from './scheduleBoard'
import { nodeCompletion, timelineNodes } from './scheduleProgress'
import { planLabel } from './schedulePlanning'
import { scheduleTimestamp } from './scheduleTimeline'
import { formatAmount } from './format'

export const GANTT_ROW_HEIGHT = 32
export const GANTT_LANE_HEIGHT = 24

export function ganttDensity(visibleDays: number) {
  const scale = visibleDays <= 14 ? 1 : visibleDays <= 42 ? 0.9 : 0.8
  return {
    scale,
    barHeight: Math.round(20 * scale),
    rowHeight: GANTT_ROW_HEIGHT * scale,
    laneHeight: GANTT_LANE_HEIGHT * scale,
  }
}

export interface ScheduleGanttRecord {
  id: string
  type: 'project' | 'task' | 'milestone'
  kind: 'serial' | 'team' | 'batch' | 'deadline'
  name: string
  milestoneLabel?: string
  quantity: string
  progress?: number | null
  task: ScheduleTask
  node?: ProductionSchedule
  start?: string
  end?: string
  startTime?: number
  endTime?: number
  children?: ScheduleGanttRecord[]
  hierarchyState?: 'expand' | 'collapse'
  lanes: Record<string, number>
  laneCount: number
  batchNumbers?: number[]
}

// VTable's calendar uses browser-local dates. Supply factory wall time (+08:00)
// so the same schedule stays in the same calendar cell in every browser timezone.
export const ganttDate = (time: number) => new Date(time + 28_800_000).toISOString().slice(0, -1)

export function ganttLeaves(record: ScheduleGanttRecord): ScheduleGanttRecord[] {
  return record.children?.flatMap(ganttLeaves) || [record]
}

export function ganttInlineBars(record: ScheduleGanttRecord): ScheduleGanttRecord[] {
  return (
    record.children?.flatMap((child) =>
      child.type === 'project' ? ganttInlineBars(child) : [child],
    ) || [record]
  )
}

export function ganttBatchRelations(record: ScheduleGanttRecord) {
  const batches = timelineNodes(record.task.nodes).filter((node) => node.status !== 'cancelled')
  // Only saved batch links establish supply relationships. Batch numbers and
  // operation order cannot tell us which material was handed over.
  const upstream = batches.filter((node) => record.node?.upstream_timeline_ids?.includes(node.id))
  const downstream = batches.filter((node) =>
    record.node ? node.upstream_timeline_ids?.includes(record.node.id) : false,
  )
  return { upstream, downstream }
}

function group(record: ScheduleGanttRecord) {
  const bars = ganttInlineBars(record)
  // Batch numbers align display rows only; actual supply links still come from
  // upstream_batch_ids. Dates never move a batch into another display row.
  record.batchNumbers = [
    ...new Set(
      bars.filter((bar) => bar.kind === 'batch').map((bar) => bar.node?.batch_number || 1),
    ),
  ].sort((a, b) => a - b)
  const leaves = bars.filter((leaf) => leaf.startTime != null && leaf.endTime != null)
  for (const leaf of leaves) {
    leaf.lanes[record.id] =
      leaf.kind === 'batch' ? record.batchNumbers.indexOf(leaf.node?.batch_number || 1) : 0
  }
  record.laneCount = Math.max(1, record.batchNumbers.length)
  if (leaves.length) {
    record.startTime = Math.min(...leaves.map((leaf) => leaf.startTime!))
    record.endTime = Math.max(...leaves.map((leaf) => leaf.endTime!))
    record.start = ganttDate(record.startTime)
    record.end = ganttDate(Math.max(record.startTime, record.endTime - 1))
  }
  return record
}

export function scheduleGanttRecords(tasks: ScheduleTask[]): ScheduleGanttRecord[] {
  return tasks.map((task) => {
    const children = [...task.nodes]
      .filter((node) => node.status !== 'cancelled')
      .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
      .map((node): ScheduleGanttRecord => {
        const batches = timelineNodes([node])
          .filter((batch) => batch.status !== 'cancelled')
          .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1))
          .map((batch): ScheduleGanttRecord => {
            const due = scheduleTimestamp(batch.due_at)
            const planned = scheduleTimestamp(batch.planned_start_at)
            const start = planned != null && due != null && planned < due ? planned : due
            return {
              id: `batch:${node.id}:${batch.id}`,
              type: start === due ? 'milestone' : 'task',
              kind: 'batch',
              milestoneLabel: batch.team_name,
              name: batch.batch_number ? `第${batch.batch_number}批` : '交货',
              quantity:
                batch.completion_basis === 'weight'
                  ? `${formatAmount(batch.target_weight)} kg`
                  : formatAmount(batch.target_quantity),
              task,
              node: batch,
              progress: nodeCompletion(batch).dispatched,
              start: start == null ? undefined : ganttDate(start),
              end: due == null ? undefined : ganttDate(start === due ? due : due - 1),
              startTime: start ?? undefined,
              endTime: due ?? undefined,
              lanes: {},
              laneCount: 1,
            }
          })
        const team = group({
          id: `team:${node.id}`,
          type: 'project',
          kind: 'team',
          name: `${String(node.sequence_no).padStart(2, '0')}  ${node.team_name}${batches.length ? '' : ` · ${planLabel(node)}`}`,
          quantity:
            node.completion_basis === 'weight'
              ? `${formatAmount(node.target_weight)} kg`
              : formatAmount(node.target_quantity),
          task,
          node,
          progress: nodeCompletion(node).dispatched,
          children: batches.length ? batches : undefined,
          hierarchyState: 'collapse',
          lanes: {},
          laneCount: 1,
        })
        return team
      })
    const deadline = scheduleTimestamp(task.final_due_at)
    if (deadline != null)
      children.push({
        id: `deadline:${task.id}`,
        type: 'milestone',
        kind: 'deadline',
        name: '最终交期',
        milestoneLabel: '',
        quantity: '',
        task,
        start: ganttDate(deadline),
        end: ganttDate(deadline),
        startTime: deadline,
        endTime: deadline,
        lanes: {},
        laneCount: 1,
      })
    return group({
      id: `serial:${task.id}`,
      type: 'project',
      kind: 'serial',
      name: task.serial_no,
      quantity: formatAmount(boardQuantity(task)),
      task,
      children,
      hierarchyState: 'collapse',
      lanes: {},
      laneCount: 1,
    })
  })
}

export function ganttRange(records: ScheduleGanttRecord[], now: number): [string, string] {
  const times = records
    .flatMap(ganttLeaves)
    .flatMap((leaf) =>
      [leaf.startTime, leaf.endTime].filter((time): time is number => time != null),
    )
  return times.length
    ? [boardDate(Math.min(...times)), boardDate(Math.max(...times) + BOARD_DAY)]
    : [boardDate(now - BOARD_DAY), boardDate(now + 5 * BOARD_DAY)]
}

export const ganttRowHeight = (record?: ScheduleGanttRecord, density = ganttDensity(7)) =>
  (record?.type === 'project' && record.children && record.hierarchyState === 'collapse'
    ? Math.max(GANTT_ROW_HEIGHT, record.laneCount * GANTT_LANE_HEIGHT + 4)
    : GANTT_ROW_HEIGHT) * density.scale

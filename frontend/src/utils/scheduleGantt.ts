import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { BOARD_DAY, boardDate, boardQuantity } from './scheduleBoard'
import { nodeCompletion, timelineNodes } from './scheduleProgress'
import { planLabel } from './schedulePlanning'
import { scheduleTimestamp } from './scheduleTimeline'
import { formatAmount } from './format'

export const GANTT_MIN_DAY_WIDTH = 144
export const GANTT_ROW_HEIGHT = 60
export const GANTT_LANE_HEIGHT = 50

export interface ScheduleGanttRecord {
  id: string
  type: 'project' | 'task' | 'milestone'
  kind: 'serial' | 'team' | 'batch' | 'deadline'
  name: string
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

function group(record: ScheduleGanttRecord) {
  const leaves = ganttInlineBars(record)
    .filter((leaf) => leaf.startTime != null && leaf.endTime != null)
    .sort((a, b) => a.startTime! - b.startTime! || a.endTime! - b.endTime!)
  const ends: number[] = []
  for (const leaf of leaves) {
    let lane = ends.findIndex((end) => end <= leaf.startTime!)
    if (lane < 0) lane = ends.length
    // Reserve a small gap for the endpoint status badge at the smallest zoom.
    // This only changes lanes, never the actual start/end of a batch.
    ends[lane] = Math.max(leaf.endTime!, leaf.startTime!) + (24 / GANTT_MIN_DAY_WIDTH) * BOARD_DAY
    leaf.lanes[record.id] = lane
  }
  record.laneCount = Math.max(1, ends.length)
  if (leaves.length) {
    record.startTime = Math.min(...leaves.map((leaf) => leaf.startTime!))
    record.endTime = Math.max(...leaves.map((leaf) => leaf.endTime!))
    record.start = ganttDate(record.startTime)
    record.end = ganttDate(Math.max(record.startTime, record.endTime - 1))
  }
  return record
}

export function scheduleGanttRecords(tasks: ScheduleTask[]): ScheduleGanttRecord[] {
  return tasks.map((task, index) => {
    const children = [...task.nodes]
      .filter((node) => node.status !== 'cancelled')
      .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
      .map((node): ScheduleGanttRecord => {
        const batches = timelineNodes([node])
          .filter((batch) => batch.status !== 'cancelled')
          .map((batch): ScheduleGanttRecord => {
            const due = scheduleTimestamp(batch.due_at)
            const planned = scheduleTimestamp(batch.planned_start_at)
            const start = planned != null && due != null && planned < due ? planned : due
            return {
              id: `batch:${node.id}:${batch.id}`,
              type: start === due ? 'milestone' : 'task',
              kind: 'batch',
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
        const completeIntervals =
          batches.length > 0 &&
          batches.every(
            (batch) =>
              batch.startTime != null && batch.endTime != null && batch.startTime < batch.endTime,
          )
        const team = group({
          id: `team:${node.id}`,
          type: completeIntervals ? 'task' : 'project',
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
        if (completeIntervals) {
          team.node = {
            ...node,
            planned_start_at: new Date(team.startTime!).toISOString(),
            due_at: new Date(team.endTime!).toISOString(),
          }
        }
        return team
      })
    const deadline = scheduleTimestamp(task.final_due_at)
    if (deadline != null)
      children.push({
        id: `deadline:${task.id}`,
        type: 'milestone',
        kind: 'deadline',
        name: '最终交期',
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
      hierarchyState: index === 0 ? 'expand' : 'collapse',
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

export const ganttRowHeight = (record?: ScheduleGanttRecord) =>
  record?.type === 'project' && record.children && record.hierarchyState === 'collapse'
    ? Math.max(GANTT_ROW_HEIGHT, record.laneCount * GANTT_LANE_HEIGHT + 10)
    : GANTT_ROW_HEIGHT

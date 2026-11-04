<script setup lang="ts">
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  render as renderIcon,
  watch,
} from 'vue'
import { Gantt, TYPES, VRender, type GanttConstructorOptions } from '@visactor/vtable-gantt'
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircle,
  IconCircleCheckFilled,
  IconExclamationCircleFilled,
  IconFocus2,
  IconMinus,
  IconPlus,
  IconChevronsUp,
  IconChevronsDown,
  IconCalendarEvent,
} from '@tabler/icons-vue'
import FactoryNavIcon from './FactoryNavIcon.vue'
import AppButton from './AppButton.vue'
import AppPopover from './AppPopover.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
import ScheduleBatchSummary from './ScheduleBatchSummary.vue'
import ScheduleDeliveryMark from './ScheduleDeliveryMark.vue'
import { useChartPalette } from '@/composables/useChartPalette'
import { BOARD_DAY, boardDate, boardDeliveryState, boardTeamColor } from '@/utils/scheduleBoard'
import {
  ganttDate,
  GANTT_MIN_DAY_WIDTH,
  GANTT_ROW_HEIGHT,
  GANTT_LANE_HEIGHT,
  ganttInlineBars,
  ganttRange,
  ganttRowHeight,
  scheduleGanttRecords,
  type ScheduleGanttRecord,
} from '@/utils/scheduleGantt'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ tasks: ScheduleTask[]; loading?: boolean }>()
const emit = defineEmits<{
  'open-node': [node: ProductionSchedule]
  'open-task': [task: ScheduleTask]
}>()
const host = ref<HTMLElement>()
const palette = useChartPalette()
const now = ref(Date.now())
const range = ref<[string, string]>(ganttRange([], now.value))
const zoom = ref(1)
const allCollapsed = ref(false)
const hovered = ref<ScheduleGanttRecord>()
const popoverVisible = ref(false)
const pointer = ref({ x: 0, y: 0 })
const virtualAnchor = {
  getBoundingClientRect: () => new DOMRect(pointer.value.x, pointer.value.y, 1, 1),
}
let gantt: Gantt | undefined
let boundTable: Gantt['taskListTableInstance']
let records: ScheduleGanttRecord[] = []
let observer: ResizeObserver | undefined
let clock: ReturnType<typeof setInterval> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let resizeFrame = 0
let lastWidth = 0
let lastHeight = 0
let taskIdentity = ''
const iconCache = new Map<string, string>()
const teamSymbols: Record<string, InstanceType<typeof FactoryNavIcon>['$props']['name']> = {
  库房: 'warehouse',
  线切割: 'cutting',
  退火: 'annealing',
  轧制: 'rolling',
  研磨: 'grinding',
  雕刻: 'engraving',
  电镀: 'plating',
  检验: 'inspection',
}
function teamSymbol(name: string, color: string) {
  const key = `team:${name}`
  if (!iconCache.has(key)) {
    const element = document.createElement('div')
    renderIcon(h(FactoryNavIcon, { name: teamSymbols[name] || 'workspaces' }), element)
    element.querySelector('svg')?.setAttribute('color', color)
    iconCache.set(key, `data:image/svg+xml,${encodeURIComponent(element.innerHTML)}`)
    renderIcon(null, element)
  }
  return iconCache.get(key)!
}
function calendarSymbol() {
  if (!iconCache.has('calendar')) {
    const element = document.createElement('div')
    renderIcon(h(IconCalendarEvent, { size: 24, color: '#389bff', strokeWidth: 1.8 }), element)
    iconCache.set('calendar', `data:image/svg+xml,${encodeURIComponent(element.innerHTML)}`)
    renderIcon(null, element)
  }
  return iconCache.get('calendar')!
}
function statusIcon(state: string, color: string) {
  const key = `${state}:${color}`
  if (!iconCache.has(key)) {
    const element = document.createElement('div')
    const icon =
      state === 'overdue'
        ? IconExclamationCircleFilled
        : state === 'completed' || state === 'completed_late'
          ? IconCircleCheckFilled
          : IconCircle
    renderIcon(h(icon, { size: 16, color, strokeWidth: 1.7 }), element)
    iconCache.set(key, `data:image/svg+xml,${encodeURIComponent(element.innerHTML)}`)
    renderIcon(null, element)
  }
  return iconCache.get(key)!
}
const font = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
const colors = computed(
  () =>
    palette.value || {
      surface: '#fff',
      mutedSurface: '#fafafa',
      text: '#18181b',
      muted: '#71717a',
      border: '#e4e4e7',
    },
)

function open(record: ScheduleGanttRecord) {
  popoverVisible.value = false
  if (record.node) {
    // Batch records use synthetic negative ids; the existing dialog accepts a schedule id.
    emit('open-node', { ...record.node, id: record.node.parent_schedule_id || record.node.id })
  } else emit('open-task', record.task)
}
function hidePopover() {
  clearTimeout(closeTimer)
  popoverVisible.value = false
}
function leaveBar() {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(hidePopover, 180)
}
function keepPopover() {
  clearTimeout(closeTimer)
}
function showPopover(record: ScheduleGanttRecord, x: number, y: number) {
  clearTimeout(closeTimer)
  hovered.value = record
  pointer.value = { x, y }
  popoverVisible.value = true
}
function fit() {
  range.value = ganttRange(records, now.value)
  zoom.value = 1
}
function toggleGroups() {
  const collapse = records.some((record) => record.hierarchyState !== 'collapse')
  records.forEach((record) => {
    record.hierarchyState = collapse ? 'collapse' : 'expand'
  })
  allCollapsed.value = collapse
  render()
}
function changeZoom(direction: number) {
  zoom.value = Math.min(2, Math.max(0.5, zoom.value + direction * 0.25))
}
function shift(direction: number) {
  const days = (Date.parse(range.value[1]) - Date.parse(range.value[0])) / BOARD_DAY + 1
  range.value = range.value.map((date) =>
    boardDate(Date.parse(`${date}T00:00:00+08:00`) + direction * days * BOARD_DAY),
  ) as [string, string]
}
function options(): GanttConstructorOptions {
  const c = colors.value
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const header = dark ? '#22202d' : '#f0f0fb'
  const gridBackground = dark ? '#22202d' : '#f0f0fb'
  const groupBackground = dark ? '#282535' : '#e8e8f7'
  const gridLine = dark ? '#393547' : '#d5d9ee'
  const days = (Date.parse(range.value[1]) - Date.parse(range.value[0])) / BOARD_DAY + 1
  const dayWidth =
    Math.round(
      (Math.max(GANTT_MIN_DAY_WIDTH, ((host.value?.clientWidth || 1200) - 304) / days) *
        zoom.value) /
        24,
    ) * 24
  const rowRecord = (index: number, instance = gantt) =>
    instance?.getRecordByIndex(index) as ScheduleGanttRecord | undefined
  const barStyle = ({
    taskRecord,
    index,
    ganttInstance,
  }: TYPES.TaskBarInteractionArgumentType): TYPES.ITaskBarStyle => {
    const record = taskRecord as ScheduleGanttRecord
    const row = rowRecord(index, ganttInstance)
    return {
      barColor: record.node ? boardTeamColor(record.node.team_name) : c.muted,
      completedBarColor: record.node ? boardTeamColor(record.node.team_name) : c.muted,
      width: record.type === 'project' ? 16 : 40,
      cornerRadius: 20,
      borderLineWidth: 0,
      paddingTop:
        record.type === 'project'
          ? 22
          : 10 + (row ? record.lanes[row.id] || 0 : 0) * GANTT_LANE_HEIGHT,
    }
  }
  return {
    records,
    tasksShowMode: TYPES.TasksShowMode.Project_Sub_Tasks_Inline,
    projectSubTasksExpandable: true,
    minDate: `${range.value[0]}T00:00:00.000`,
    maxDate: `${range.value[1]}T23:59:59.999`,
    rowHeight: GANTT_ROW_HEIGHT,
    headerRowHeight: 64,
    overscrollBehavior: 'none',
    underlayBackgroundColor: c.surface,
    taskListTable: {
      tableWidth: 300,
      hierarchyIndent: 16,
      hierarchyExpandLevel: 2,
      columns: [
        {
          field: 'name',
          title: '流水号 / 班组',
          width: 216,
          tree: true,
          style: {
            fontWeight: ({ row, table }) =>
              table.getRecordByCell(0, row)?.kind === 'serial' ? 600 : 400,
            color: ({ row, table }) => {
              const record = table.getRecordByCell(0, row) as ScheduleGanttRecord
              return record?.kind === 'team' ? 'transparent' : c.text
            },
          },
          customLayout: ({ rect, table, col, row }) => {
            const record = table.getRecordByCell(col, row) as ScheduleGanttRecord
            const rootContainer = new VRender.Group({ width: rect!.width, height: rect!.height })
            if (record.kind === 'serial' || record.kind === 'deadline')
              return { rootContainer, renderDefault: true }
            const inset = record.kind === 'batch' ? 54 : 38
            const cardWidth = rect!.width - inset - 16
            const center = inset + cardWidth / 2
            rootContainer.add(
              new VRender.Rect({
                x: inset,
                y: (rect!.height - 40) / 2,
                width: cardWidth,
                height: 40,
                cornerRadius: 20,
                fill: c.surface,
                pickable: false,
              }),
            )
            rootContainer.add(
              new VRender.Text({
                x: center,
                y: rect!.height / 2 - 8,
                text: record.kind === 'team' ? record.node!.team_name : record.name,
                fontFamily: font,
                fontSize: 14,
                fontWeight: 600,
                textAlign: 'center',
                textBaseline: 'middle',
                fill: dark ? '#eeeaf8' : boardTeamColor(record.node!.team_name),
                maxLineWidth: cardWidth - 20,
                ellipsis: '…',
                pickable: false,
              }),
            )
            rootContainer.add(
              new VRender.Text({
                x: center,
                y: rect!.height / 2 + 9,
                text:
                  record.startTime != null && record.endTime != null
                    ? `${boardDate(record.startTime).slice(5).replace('-', '/')}–${boardDate(record.endTime).slice(5).replace('-', '/')}`
                    : '待填写',
                fontFamily: font,
                fontSize: 11,
                fontWeight: 500,
                textAlign: 'center',
                textBaseline: 'middle',
                fill: c.text,
                pickable: false,
              }),
            )
            // Keep VTable's tree control; the custom card replaces only its text.
            return {
              rootContainer,
              renderDefault: record.kind === 'team',
              enableCellPadding: false,
            }
          },
        },
        {
          field: 'quantity',
          title: '数量',
          width: 84,
          style: { textAlign: 'right', padding: [0, 12, 0, 4] },
        },
      ],
      customComputeRowHeight: ({ row, table }) =>
        row === 0 ? 64 : ganttRowHeight(table.getRecordByCell(0, row) as ScheduleGanttRecord),
      theme: {
        underlayBackgroundColor: c.surface,
        defaultStyle: {
          fontFamily: font,
          fontSize: 14,
          color: c.text,
          bgColor: gridBackground,
          borderColor: c.border,
          borderLineWidth: 0,
          padding: [0, 14],
          hover: { cellBgColor: c.mutedSurface, inlineRowBgColor: c.mutedSurface },
        },
        headerStyle: {
          bgColor: header,
          color: c.text,
          fontSize: 13,
          fontWeight: 600,
          borderColor: gridLine,
          borderLineWidth: [0, 0, 1, 0],
        },
        bodyStyle: {
          bgColor: ({ row, table }) =>
            table.getRecordByCell(0, row)?.kind === 'serial' ? groupBackground : gridBackground,
          color: c.text,
          borderColor: c.border,
          borderLineWidth: 0,
          fontFamily: font,
          fontSize: 14,
          fontWeight: 400,
          hover: { cellBgColor: c.mutedSurface, inlineRowBgColor: c.mutedSurface },
        },
        functionalIconsStyle: {
          collapse_color: c.muted,
          collapse_color_opacity: '1',
          expand_color: c.muted,
          expand_color_opacity: '1',
        },
        frameStyle: { borderLineWidth: 0 },
      },
      hover: { highlightMode: 'row' },
      select: { disableSelect: true },
      tooltip: { isShowOverflowTextTooltip: true },
    },
    timelineHeader: {
      colWidth: dayWidth / 24,
      backgroundColor: header,
      verticalLine: { lineColor: gridLine, lineWidth: 0 },
      horizontalLine: { lineColor: gridLine, lineWidth: 0 },
      scales: [
        {
          unit: 'month',
          step: 1,
          rowHeight: 20,
          format: ({ startDate }) => `${startDate.getFullYear()} 年 ${startDate.getMonth() + 1} 月`,
          style: {
            color: c.muted,
            fontSize: 12,
            fontWeight: '500',
            textAlign: 'left',
            padding: [0, 14],
          },
        },
        {
          unit: 'day',
          step: 1,
          rowHeight: 44,
          format: ({ startDate }) => {
            const today = new Date(ganttDate(now.value))
            const label =
              startDate.toDateString() === today.toDateString()
                ? '今天'
                : ['日', '一', '二', '三', '四', '五', '六'][startDate.getDay()]
            return `${String(startDate.getDate()).padStart(2, '0')}  ${label}`
          },
          customLayout: ({ width, height, startDate }) => {
            const rootContainer = new VRender.Group({ width, height, pickable: false })
            const x = width / 2 - 30
            rootContainer.add(
              new VRender.Image({
                x,
                y: (height - 24) / 2,
                width: 22,
                height: 24,
                image: calendarSymbol(),
                pickable: false,
              }),
            )
            rootContainer.add(
              new VRender.Text({
                x: x + 30,
                y: height / 2 - 8,
                text: String(startDate.getDate()).padStart(2, '0'),
                fontFamily: font,
                fontSize: 18,
                fontWeight: 600,
                textBaseline: 'middle',
                fill: c.text,
                pickable: false,
              }),
            )
            rootContainer.add(
              new VRender.Text({
                x: x + 30,
                y: height / 2 + 10,
                text:
                  startDate.toDateString() === new Date(ganttDate(now.value)).toDateString()
                    ? '今天'
                    : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][startDate.getDay()],
                fontFamily: font,
                fontSize: 12,
                textBaseline: 'middle',
                fill: c.text,
                pickable: false,
              }),
            )
            return { rootContainer, renderDefaultText: false }
          },
        },
        // A hidden hourly scale keeps eight-hour batches eight hours wide.
        { unit: 'hour', step: 1, visible: false },
      ],
    },
    grid: {
      backgroundColor: gridBackground,
      horizontalBackgroundColor: ({ index, ganttInstance }) =>
        rowRecord(index, ganttInstance)?.kind === 'serial' ? groupBackground : 'transparent',
      verticalLineDependenceOnTimeScale: 'day',
      verticalLine: { lineColor: gridLine, lineWidth: 0 },
      horizontalLine: { lineColor: gridLine, lineWidth: 1 },
    },
    frame: {
      outerFrameStyle: { borderLineWidth: 0 },
      verticalSplitLine: { lineColor: gridLine, lineWidth: 0 },
      verticalSplitLineMoveable: false,
      horizontalSplitLine: { lineColor: gridLine, lineWidth: 0 },
    },
    scrollStyle: {
      width: 7,
      visible: 'scrolling',
      horizontalVisible: 'always',
      scrollSliderColor: dark ? '#555d6b' : '#b6bcc5',
      scrollRailColor: c.surface,
      hoverOn: true,
    },
    markLine: [
      {
        date: ganttDate(now.value),
        position: 'date',
        style: { lineColor: '#6d68ff', lineWidth: 1, lineDash: [6, 4] },
        scrollToMarkLine: false,
      },
    ],
    taskBar: {
      startDateField: 'start',
      endDateField: 'end',
      progressField: 'progress',
      locateIcon: true,
      labelText: '',
      barStyle,
      projectStyle: barStyle,
      milestoneStyle: {
        width: 12,
        cornerRadius: 2,
        fillColor: c.surface,
        borderColor: c.muted,
        borderLineWidth: 1,
        labelText: '',
      },
      moveable: false,
      resizable: false,
      progressAdjustable: false,
      dragOrder: false,
      scheduleCreatable: false,
      selectable: true,
      selectedBarStyle: { borderLineWidth: 1, borderColor: c.muted },
      clip: false,
      hoverBarStyle: { barOverlayColor: '#ffffff24', cornerRadius: 20 },
      customLayout: ({ width, height, taskRecord, index, startDate, ganttInstance }) => {
        const record = taskRecord as ScheduleGanttRecord
        if (record.type === 'milestone') return { renderDefaultBar: true, renderDefaultText: false }
        const rootContainer = new VRender.Group({
          width,
          height,
          fill: 'transparent',
          pickable: true,
          childrenPickable: false,
        })
        if (record.type === 'project') {
          const offset = ganttInstance.getXByTime(startDate.getTime())
          const laneHeight = height / Math.max(1, record.laneCount)
          for (const leaf of ganttInlineBars(record)) {
            if (!leaf.start || !leaf.end || !leaf.node) continue
            const left = ganttInstance.getXByTime(Date.parse(leaf.start)) - offset
            const right = ganttInstance.getXByTime(Date.parse(leaf.end) + 1) - offset
            rootContainer.add(
              new VRender.Rect({
                x: left,
                y: (leaf.lanes[record.id] || 0) * laneHeight,
                width: Math.max(2, right - left),
                height: Math.min(4, laneHeight),
                cornerRadius: 2,
                fill: boardTeamColor(leaf.node.team_name),
                opacity: 0.75,
                pickable: false,
              }),
            )
          }
          return { rootContainer, renderDefaultBar: false, renderDefaultText: false }
        }
        const state = boardDeliveryState(record.node!, now.value)
        const teamColor = boardTeamColor(record.node!.team_name)
        const progress = record.progress
        // Adapted from VTable's gantt-customLayout demo: the entire interval is a
        // three-stop gradient; progress belongs to the separate circular badge.
        const pale = `rgb(${[1, 3, 5]
          .map((offset) =>
            Math.round(parseInt(teamColor.slice(offset, offset + 2), 16) * 0.62 + 255 * 0.38),
          )
          .join(',')})`
        rootContainer.setAttributes({
          cornerRadius: 20,
          fill: {
            gradient: 'linear',
            x0: 0,
            y0: 0,
            x1: 1,
            y1: 0,
            stops: [
              { offset: 0, color: pale },
              { offset: 0.5, color: teamColor },
              { offset: 1, color: pale },
            ],
          },
        })
        const stateColor =
          state === 'overdue'
            ? '#d44945'
            : state === 'completed'
              ? '#249466'
              : state === 'completed_late'
                ? '#c47a20'
                : c.muted
        if (state !== 'pending' && state !== 'unassessed')
          rootContainer.add(
            new VRender.Image({
              x: width - 8,
              y: -5,
              width: 13,
              height: 13,
              image: statusIcon(state, stateColor),
              pickable: false,
            }),
          )
        const row = rowRecord(index, ganttInstance)
        const label =
          row?.kind === 'serial' || record.kind === 'team' ? record.node!.team_name : record.name
        const showPercent = progress != null && width >= 120
        const compact = width < 160
        const symbolSize = Math.min(32, Math.max(0, width - 8))
        const symbolX = width < 84 ? (width - symbolSize) / 2 : 5
        if (symbolSize >= 20) {
          rootContainer.add(
            new VRender.Circle({
              x: symbolX + symbolSize / 2,
              y: height / 2,
              radius: symbolSize / 2,
              fill: '#fff',
              pickable: false,
            }),
          )
          const glyphSize = symbolSize * 0.6
          rootContainer.add(
            new VRender.Image({
              x: symbolX + (symbolSize - glyphSize) / 2,
              y: (height - glyphSize) / 2,
              width: glyphSize,
              height: glyphSize,
              image: teamSymbol(record.node!.team_name, teamColor),
              pickable: false,
            }),
          )
        }
        const textX = 43
        const textWidth = width - textX - (showPercent ? 40 : 10)
        if (width >= 84 && textWidth >= 36) {
          const textStyle = {
            x: textX,
            fontFamily: font,
            fill: '#fff',
            pickable: false,
            textBaseline: 'middle' as const,
            maxLineWidth: textWidth,
            ellipsis: '…',
          }
          rootContainer.add(
            new VRender.Text({
              ...textStyle,
              y: compact ? height / 2 : height / 2 - 8,
              text: label,
              fontSize: compact ? 13 : 14,
              fontWeight: 600,
            }),
          )
          const hours = (record.endTime! - record.startTime!) / 3_600_000
          const duration =
            hours >= 24
              ? `${Math.floor(hours / 24)}天${hours % 24 ? `${Math.round((hours % 24) * 10) / 10}时` : ''}`
              : `${Math.round(hours * 10) / 10}小时`
          if (!compact)
            rootContainer.add(
              new VRender.Text({
                ...textStyle,
                y: height / 2 + 9,
                text: duration,
                fontSize: 11,
              }),
            )
        }
        if (showPercent) {
          const x = width - 20
          const y = height / 2
          rootContainer.add(
            new VRender.Circle({
              x,
              y,
              radius: 14,
              fill: '#fff',
              pickable: false,
            }),
          )
          rootContainer.add(
            new VRender.Text({
              x,
              y,
              // Never round a partially delivered batch up to 100%.
              text: `${Math.floor(progress)}%`,
              fontSize: 10,
              fontWeight: 600,
              textAlign: 'center',
              textBaseline: 'middle',
              fontFamily: font,
              fill: '#25232d',
              pickable: false,
            }),
          )
        }
        return { rootContainer, renderDefaultBar: false, renderDefaultText: false }
      },
    },
  }
}
function positionLocateIcons() {
  // Native edge arrows share the bar's centre line and can cover another batch's percentage.
  // Keep them in the row's upper gutter instead; the time interval stays untouched.
  gantt?.scenegraph.taskBar.locateIconsGroup?.forEachChildren((child) => {
    const icon = child as unknown as VRender.Group
    icon.setAttributes({ dy: -24, scaleX: 0.65, scaleY: 0.65 })
  })
}
function render(resetScroll = false) {
  if (!host.value) return
  hidePopover()
  if (gantt) {
    const left = gantt.scrollLeft,
      top = gantt.scrollTop
    gantt.updateOption(options())
    if (!resetScroll) {
      gantt.scrollLeft = left
      gantt.scrollTop = top
    }
  } else {
    gantt = new Gantt(host.value, options())
    gantt.on('mouseenter_task_bar', ({ record, federatedEvent }) =>
      showPopover(record as ScheduleGanttRecord, federatedEvent.clientX, federatedEvent.clientY),
    )
    gantt.on('mouseleave_task_bar', leaveBar)
    gantt.on('click_task_bar', ({ record }) => open(record as ScheduleGanttRecord))
    gantt.on('scroll', () => {
      hidePopover()
      positionLocateIcons()
    })
  }
  positionLocateIcons()
  if (boundTable !== gantt.taskListTableInstance) {
    boundTable = gantt.taskListTableInstance
    boundTable?.on('click_cell', ({ row, col, targetIcon }) => {
      if (row === 0 || col !== 0 || targetIcon) return
      const record = boundTable!.getRecordByCell(col, row) as ScheduleGanttRecord
      if (record) open(record)
    })
    boundTable?.on('tree_hierarchy_state_change', () => {
      allCollapsed.value = records.every((record) => record.hierarchyState === 'collapse')
      nextTick(positionLocateIcons)
    })
  }
}
function release() {
  // VTable Gantt 1.26.8 clears scenegraph without releasing its Canvas listeners.
  gantt?.scenegraph.release()
  gantt?.release()
  gantt = undefined
  boundTable = undefined
}
watch(
  () => props.tasks,
  async (tasks) => {
    const states = new Map<string, ScheduleGanttRecord['hierarchyState']>()
    const remember = (items: ScheduleGanttRecord[]) =>
      items.forEach((item) => {
        states.set(item.id, item.hierarchyState)
        if (item.children) remember(item.children)
      })
    remember(records)
    records = scheduleGanttRecords(tasks)
    const restore = (items: ScheduleGanttRecord[]) =>
      items.forEach((item) => {
        if (states.has(item.id)) item.hierarchyState = states.get(item.id)
        if (item.children) restore(item.children)
      })
    restore(records)
    allCollapsed.value = records.every((record) => record.hierarchyState === 'collapse')
    const identity = tasks.map((task) => task.id).join(',')
    if (identity !== taskIdentity) {
      taskIdentity = identity
      fit()
    }
    await nextTick()
    render()
  },
  { immediate: true },
)
watch([range, zoom], () => render(true))
watch(colors, () => {
  const left = gantt?.scrollLeft || 0
  const top = gantt?.scrollTop || 0
  // VTable caches the grid container fill; updateOption does not repaint it.
  release()
  render()
  if (gantt) {
    gantt.scrollLeft = left
    gantt.scrollTop = top
  }
})
onMounted(() => {
  render()
  observer = new ResizeObserver(() => {
    const width = host.value?.clientWidth || 0
    const height = host.value?.clientHeight || 0
    if (width === lastWidth && height === lastHeight) return
    lastWidth = width
    lastHeight = height
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => render())
  })
  observer.observe(host.value!)
  clock = setInterval(() => {
    now.value = Date.now()
    render()
  }, 60_000)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  clearInterval(clock)
  clearTimeout(closeTimer)
  release()
})
</script>

<template>
  <section class="production-gantt" :aria-busy="loading" aria-label="物料交货甘特图">
    <div class="gantt-toolbar">
      <div class="gantt-search">
        <slot />
        <AppButton
          class="gantt-collapse"
          :aria-label="allCollapsed ? '展开流水号' : '收起流水号'"
          :title="allCollapsed ? '展开流水号' : '收起流水号'"
          @click="toggleGroups"
          ><component :is="allCollapsed ? IconChevronsDown : IconChevronsUp" :size="17"
        /></AppButton>
      </div>
      <div class="gantt-controls">
        <ScheduleDateRange v-model="range" compact />
        <div class="gantt-zoom" aria-label="时间缩放">
          <button
            type="button"
            aria-label="缩小时间轴"
            :disabled="zoom <= 0.5"
            @click="changeZoom(-1)"
          >
            <IconMinus :size="14" />
          </button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button
            type="button"
            aria-label="放大时间轴"
            :disabled="zoom >= 2"
            @click="changeZoom(1)"
          >
            <IconPlus :size="14" />
          </button>
        </div>
        <AppButton title="上一时间段" aria-label="上一时间段" @click="shift(-1)"
          ><IconChevronLeft :size="16"
        /></AppButton>
        <AppButton title="适应全部交期" aria-label="适应全部交期" @click="fit"
          ><IconFocus2 :size="16"
        /></AppButton>
        <AppButton title="下一时间段" aria-label="下一时间段" @click="shift(1)"
          ><IconChevronRight :size="16"
        /></AppButton>
        <slot name="view-actions" />
      </div>
    </div>
    <div class="gantt-body">
      <div ref="host" class="gantt-canvas" />
      <div v-if="!tasks.length" class="gantt-empty">
        {{ loading ? '正在加载排期…' : '暂无排期' }}
      </div>
    </div>
    <footer class="gantt-legend">
      <span v-for="state in ['pending', 'completed', 'completed_late', 'overdue']" :key="state"
        ><ScheduleDeliveryMark :state="state" />{{
          {
            pending: '待完成',
            completed: '按时完成',
            completed_late: '逾期完成',
            overdue: '逾期未交齐',
          }[state]
        }}</span
      >
    </footer>
    <AppPopover
      v-model:visible="popoverVisible"
      :virtual-ref="virtualAnchor"
      virtual-triggering
      trigger="manual"
      placement="top"
      :width="324"
      :show-arrow="false"
      :teleported="true"
    >
      <div v-if="hovered" @mouseenter="keepPopover" @mouseleave="leaveBar">
        <ScheduleBatchSummary
          v-if="hovered.node"
          :node="hovered.node"
          :serial-no="hovered.task.serial_no"
          :now="now"
          @open="open(hovered)"
        />
        <div v-else class="gantt-task-summary">
          <strong>{{ hovered.task.serial_no }}</strong
          ><span>最终交期 {{ formatDateTime(hovered.task.final_due_at) }}</span
          ><AppButton text @click="open(hovered)">查看明细</AppButton>
        </div>
      </div>
    </AppPopover>
    <div class="gantt-accessible">
      <template v-for="task in tasks" :key="task.id">
        <button type="button" @click="emit('open-task', task)">
          {{ task.serial_no }} · 查看排期明细
        </button>
        <button
          v-for="node in task.nodes"
          :key="node.id"
          type="button"
          @click="emit('open-node', node)"
        >
          {{ task.serial_no }} · {{ node.sequence_no }} {{ node.team_name }} ·
          {{ formatDateTime(node.due_at) }}
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.production-gantt {
  container-type: inline-size;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--wm-border, #e4e4e7);
  border-radius: 12px;
  background: var(--wm-bg, white);
  color: var(--wm-text, #18181b);
}
.gantt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--wm-border, #e4e4e7);
  flex-wrap: wrap;
}
.gantt-search {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 260px;
}
.gantt-collapse {
  flex-shrink: 0;
}
.gantt-search :deep(.wm-data-toolbar),
.gantt-search :deep(.workspace-data-toolbar) {
  margin: 0;
  padding: 0;
  gap: 8px;
}
.gantt-search :deep(.wm-data-toolbar) {
  flex-wrap: nowrap;
}
.gantt-search :deep(.wm-toolbar-search) {
  flex: 1 1 180px;
  min-width: 140px;
  max-width: 260px;
}
.gantt-search :deep(.wm-toolbar-tools:empty) {
  display: none;
}
.gantt-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
@container (max-width: 900px) {
  .gantt-search {
    flex-basis: 100%;
  }
  .gantt-controls {
    margin-left: auto;
  }
}
.gantt-controls :deep(.el-button) {
  margin: 0;
  padding: 8px;
  min-height: 32px;
  height: 32px;
}
.gantt-zoom {
  display: flex;
  align-items: center;
  padding: 3px;
  margin-inline: 4px;
  border-radius: 8px;
  border: 1px solid var(--wm-border, #e4e4e7);
  background: var(--wm-muted-surface, #fafafa);
}
.gantt-zoom span {
  min-width: 42px;
  font-size: 12px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.gantt-zoom button {
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--wm-muted, #71717a);
  display: grid;
  place-items: center;
  padding: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.gantt-zoom button:hover:not(:disabled) {
  background: var(--wm-bg, white);
  color: var(--wm-text, #18181b);
  box-shadow: 0 1px 3px #00000014;
}
.gantt-zoom button:disabled {
  opacity: 0.35;
  cursor: default;
}
.gantt-zoom button:focus-visible {
  outline: 2px solid #609df5;
  outline-offset: 1px;
}
.gantt-body {
  position: relative;
  flex: 1;
  min-height: 240px;
  overflow: hidden;
}
.gantt-canvas {
  position: absolute;
  inset: 0;
}
.gantt-empty {
  position: absolute;
  inset: 64px 0 0;
  display: grid;
  place-content: center;
  color: var(--wm-muted, #71717a);
  pointer-events: none;
  font-size: 13px;
}
.gantt-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 22px;
  padding: 10px 16px;
  border-top: 1px solid var(--wm-border, #e4e4e7);
  color: var(--wm-muted, #71717a);
  font-size: 12px;
}
.gantt-legend > span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.gantt-legend :deep(.delivery-mark svg) {
  width: 14px;
  height: 14px;
}
.gantt-task-summary {
  display: grid;
  gap: 10px;
  font-size: 12px;
}
.gantt-accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.gantt-accessible:focus-within {
  z-index: 20;
  inset: auto 16px 48px;
  width: auto;
  height: auto;
  clip-path: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: var(--wm-bg, white);
  border: 1px solid var(--wm-border, #e4e4e7);
}
@media (max-width: 900px) {
  .gantt-controls {
    flex-wrap: wrap;
  }
}
</style>

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
  useId,
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
  IconCalendarEvent,
  IconX,
} from '@tabler/icons-vue'
import FactoryNavIcon from './FactoryNavIcon.vue'
import AppButton from './AppButton.vue'
import AppInput from './AppInput.vue'
import AppPopover from './AppPopover.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
import ScheduleBatchSummary from './ScheduleBatchSummary.vue'
import ScheduleDeliveryMark from './ScheduleDeliveryMark.vue'
import { useChartPalette } from '@/composables/useChartPalette'
import { BOARD_DAY, boardDate, boardDeliveryState, boardTeamColor } from '@/utils/scheduleBoard'
import { progressWeek } from '@/utils/scheduleProgress'
import {
  ganttDate,
  ganttBatchRelations,
  ganttDensity,
  ganttInlineBars,
  ganttOpeningRange,
  ganttRange,
  ganttRowHeight,
  scheduleGanttRecords,
  type ScheduleGanttRecord,
} from '@/utils/scheduleGantt'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{
  tasks: ScheduleTask[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  loadError?: string
}>()
const emit = defineEmits<{
  'open-node': [node: ProductionSchedule]
  'open-task': [task: ScheduleTask]
  'load-more': []
}>()
const host = ref<HTMLElement>()
const palette = useChartPalette()
const now = ref(Date.now())
const defaultWeek = progressWeek(now.value, now.value)
const range = ref<[string, string]>([boardDate(defaultWeek.start), boardDate(defaultWeek.end - 1)])
const canvasId = `schedule-gantt-${useId()}`
const baseMillisecondsPerPixel = BOARD_DAY / 120
const millisecondsPerPixel = ref(baseMillisecondsPerPixel / 0.67)
const zoom = computed(() => baseMillisecondsPerPixel / millisecondsPerPixel.value)
const zoomInput = ref('67')
const zoomInputElement = ref<InstanceType<typeof AppInput>>()
const editingZoom = ref(false)
const viewportWidth = ref(900)
const zoomLimits = ref({ min: 30_000, max: BOARD_DAY })
const visibleRange = ref('')
const fittedRange = ref(false)
const overviewLabel = computed(() => {
  const start = new Date(`${range.value[0]}T00:00:00`)
  const end = new Date(`${range.value[1]}T00:00:00`)
  return start.getDate() === 1 &&
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear() &&
    new Date(end.getTime() + BOARD_DAY).getDate() === 1
    ? '整月'
    : '全周期'
})
const hovered = ref<ScheduleGanttRecord>()
const popoverVisible = ref(false)
const pinned = ref(false)
const relations = computed(() =>
  hovered.value?.kind === 'batch' ? ganttBatchRelations(hovered.value) : undefined,
)
const pointer = ref({ x: 0, y: 0 })
const virtualAnchor = {
  getBoundingClientRect: () => new DOMRect(pointer.value.x, pointer.value.y, 1, 1),
}
let gantt: Gantt | undefined
let boundTable: Gantt['taskListTableInstance']
let records: ScheduleGanttRecord[] = []
let observer: ResizeObserver | undefined
let clock: ReturnType<typeof setInterval> | undefined
let resizeFrame = 0
let moreFrame = 0
let viewportFrame = 0
let paintedTop = 0
let paintedBottom = 0
let zoomFrame = 0
let rendering = false
let viewAnimation: Animation | undefined
let densityFrame = 0
let densityGroups: VRender.Group[] = []
let renderedDensity = 1
let lastWidth = 0
let lastHeight = 0
let taskIdentity = ''
let initialRangePending = true
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
const teamLegend = computed(() => {
  const present = new Set(
    props.tasks.flatMap((task) =>
      task.nodes.filter((node) => node.status !== 'cancelled').map((node) => node.team_name),
    ),
  )
  return [...new Set([...Object.keys(teamSymbols), ...present])]
    .filter((name) => present.has(name))
    .map((name) => ({ name, color: boardTeamColor(name) }))
})
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
const tableWidth = 300
const headerHeight = 64
const density = computed(() =>
  ganttDensity(
    Math.min(
      (Date.parse(range.value[1]) - Date.parse(range.value[0])) / BOARD_DAY + 1,
      (millisecondsPerPixel.value * viewportWidth.value) / BOARD_DAY,
    ),
  ),
)
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
  hidePopover()
  if (record.node) {
    // Batch records use synthetic negative ids; the existing dialog accepts a schedule id.
    emit('open-node', { ...record.node, id: record.node.parent_schedule_id || record.node.id })
  } else emit('open-task', record.task)
}
function hidePopover() {
  pinned.value = false
  popoverVisible.value = false
  gantt?.scenegraph.taskBar.removeSelectedBorder()
  highlightBatch()
}
function selectBatch(record: ScheduleGanttRecord, x: number, y: number) {
  if (pinned.value && hovered.value?.id === record.id) return hidePopover()
  hovered.value = record
  pointer.value = { x, y }
  popoverVisible.value = true
  pinned.value = true
  highlightBatch(record)
}
function highlightBatch(record?: ScheduleGanttRecord) {
  const related = record?.kind === 'batch' ? ganttBatchRelations(record) : undefined
  const ids = new Set(
    related
      ? [
          record!.node!.id,
          ...related.upstream.map((n) => n.id),
          ...related.downstream.map((n) => n.id),
        ]
      : [],
  )
  gantt?.scenegraph.taskBar.barContainer?.forEachChildren((child) => {
    const bar = child as unknown as VRender.Group & { record?: ScheduleGanttRecord }
    const item = bar.record
    if (!item) return
    const dim =
      related &&
      item.kind === 'batch' &&
      (item.task.id !== record!.task.id || !ids.has(item.node!.id))
    bar.setAttribute('baseOpacity', dim ? 0.25 : 1)
  })
  gantt?.scenegraph.updateNextFrame()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') hidePopover()
}
function onPointerDown(event: PointerEvent) {
  const target = event.target
  if (
    pinned.value &&
    target instanceof Element &&
    !host.value?.contains(target) &&
    !target.closest('.gantt-batch-popover')
  )
    hidePopover()
}
function initialScale() {
  const days = (Date.parse(range.value[1]) - Date.parse(range.value[0])) / BOARD_DAY + 1
  return (days * BOARD_DAY) / viewportWidth.value
}
function syncZoomState() {
  if (!gantt) return
  millisecondsPerPixel.value = gantt.getCurrentMillisecondsPerPixel()
  const start =
    Date.parse(`${range.value[0]}T00:00:00+08:00`) + gantt.scrollLeft * millisecondsPerPixel.value
  const end = Math.min(
    Date.parse(`${range.value[1]}T23:59:59+08:00`),
    // Native scrolling rounds to whole pixels; use the last visible pixel so
    // rounding at midnight does not add the following day to the range label.
    start + (viewportWidth.value - 1) * millisecondsPerPixel.value,
  )
  visibleRange.value = `${boardDate(start).slice(5)} — ${boardDate(end).slice(5)}`
}
function onNativeZoom() {
  if (rendering) return
  cancelAnimationFrame(zoomFrame)
  zoomFrame = requestAnimationFrame(() => {
    zoomFrame = 0
    const previousDensity = renderedDensity
    syncZoomState()
    fittedRange.value = Math.abs(millisecondsPerPixel.value - initialScale()) < 1
    gantt?.zoomScaleManager?.getDataZoomIntegration()?.syncToDataZoom()
    if (density.value.scale !== previousDensity) {
      render()
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        animateDensity(previousDensity / renderedDensity)
    }
    positionLocateIcons()
  })
}
function applyNativeScale(value: number) {
  if (!gantt?.zoomScaleManager) return
  const manager = gantt.zoomScaleManager
  manager.updateZoomLimits()
  // Explicit percentages stay independent of the period and viewport width.
  zoomLimits.value = {
    min: manager.getGlobalMinMillisecondsPerPixel(),
    max: manager.getGlobalMaxMillisecondsPerPixel(),
  }
  gantt.parsedOptions.zoom!.maxMillisecondsPerPixel = zoomLimits.value.max
  const scale = Math.max(zoomLimits.value.min, Math.min(zoomLimits.value.max, value))
  manager.switchToLevel(manager.findOptimalLevel(scale))
  // Native initialization may round the period up to its initial coarse step.
  gantt.updateDateRange(`${range.value[0]}T00:00:00.000`, `${range.value[1]}T23:59:59.999`)
  gantt.setMillisecondsPerPixel(scale)
}
function changeRange(value: [string, string]) {
  initialRangePending = false
  range.value = value
  fittedRange.value = true
  render(true)
}
function fit() {
  changeRange(ganttRange(records, now.value))
}
function showOverview() {
  const previousDensity = renderedDensity
  fittedRange.value = true
  render()
  if (gantt) gantt.scrollLeft = 0
  syncZoomState()
  animateViewChange(previousDensity)
}
function focusPeriod(start: Date, end: Date) {
  const min = Date.parse(`${range.value[0]}T00:00:00`)
  const max = Date.parse(`${range.value[1]}T00:00:00`) + BOARD_DAY
  const left = Math.max(min, start.getTime())
  const right = Math.min(max, end.getTime() + 1)
  if (right <= left || right - left >= millisecondsPerPixel.value * viewportWidth.value) return
  const previousDensity = renderedDensity
  fittedRange.value = false
  millisecondsPerPixel.value = (right - left) / viewportWidth.value
  render()
  if (gantt) gantt.scrollLeft = (left - min) / millisecondsPerPixel.value
  syncZoomState()
  gantt?.zoomScaleManager?.getDataZoomIntegration()?.syncToDataZoom()
  animateViewChange(previousDensity)
}
function changeZoom(direction: number) {
  gantt?.zoomByFactor(direction > 0 ? 1.2 : 1 / 1.2)
}
function beginZoom() {
  editingZoom.value = true
  zoomInputElement.value?.select()
}
function commitZoom() {
  if (!editingZoom.value) return
  const value = zoomInput.value.trim().replace(/%$/, '').trim()
  const percent = Number(value)
  editingZoom.value = false
  if (/^\d+(\.\d+)?$/.test(value) && Number.isFinite(percent) && percent > 0) {
    fittedRange.value = false
    applyNativeScale((baseMillisecondsPerPixel * 100) / percent)
    syncZoomState()
  }
  zoomInput.value = String(Math.round(zoom.value * 100))
}
function submitZoom() {
  commitZoom()
  zoomInputElement.value?.blur()
}
function cancelZoom() {
  zoomInput.value = String(Math.round(zoom.value * 100))
  editingZoom.value = false
  zoomInputElement.value?.blur()
}
function shift(direction: number) {
  const days = (Date.parse(range.value[1]) - Date.parse(range.value[0])) / BOARD_DAY + 1
  changeRange(
    range.value.map((date) =>
      boardDate(Date.parse(`${date}T00:00:00+08:00`) + direction * days * BOARD_DAY),
    ) as [string, string],
  )
}
function viewportRecords(top: number) {
  const height = host.value?.clientHeight || 900
  let y = 0
  paintedTop = Infinity
  paintedBottom = 0
  return records.map((record) => {
    const start = y
    y += Math.round(ganttRowHeight(record, density.value))
    if (y >= top - height / 2 && start <= top + height * 1.5) {
      paintedTop = Math.min(paintedTop, start)
      paintedBottom = y
      return record
    }
    // Keep row metadata for native scrolling; only mount visible timeline bars.
    return { ...record, start: undefined, end: undefined, children: [] }
  })
}
function refreshViewport() {
  cancelAnimationFrame(viewportFrame)
  viewportFrame = requestAnimationFrame(() => {
    if (!gantt || rendering || !records.length) return
    const bottom = Math.min(gantt.getAllTaskBarsHeight(), gantt.scrollTop + gantt.gridHeight)
    if (gantt.scrollTop < paintedTop || bottom > paintedBottom) render()
  })
}
function options(scrollTop = gantt?.scrollTop || 0): GanttConstructorOptions {
  const c = colors.value
  const sizing = density.value
  const { barHeight, laneHeight, rowHeight } = sizing
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const header = dark ? '#22202d' : '#f0f0fb'
  const gridBackground = dark ? '#22202d' : '#f0f0fb'
  const groupBackground = dark ? '#282535' : '#e8e8f7'
  const gridLine = dark ? '#393547' : '#d5d9ee'
  const rowRecord = (index: number, instance = gantt) =>
    instance?.getRecordByIndex(index) as ScheduleGanttRecord | undefined
  const barStyle = ({
    taskRecord,
    index,
    ganttInstance,
  }: TYPES.TaskBarInteractionArgumentType): TYPES.ITaskBarStyle => {
    const record = taskRecord as ScheduleGanttRecord
    const row = rowRecord(index, ganttInstance)
    const lanes = row?.type === 'project' && row.hierarchyState === 'collapse' ? row.laneCount : 1
    return {
      barColor: record.node ? boardTeamColor(record.node.team_name) : c.muted,
      completedBarColor: record.node ? boardTeamColor(record.node.team_name) : c.muted,
      width: record.type === 'project' ? 12 : barHeight,
      cornerRadius: 20,
      borderLineWidth: 0,
      paddingTop:
        record.type === 'project'
          ? (ganttRowHeight(row, sizing) - 12) / 2
          : (ganttRowHeight(row, sizing) - ((lanes - 1) * laneHeight + barHeight)) / 2 +
            (row ? record.lanes[row.id] || 0 : 0) * laneHeight,
    }
  }
  const scaleLevel = (
    dateUnit: 'hour' | 'day' | 'week' | 'month',
    step = 1,
  ): TYPES.ITimelineScale[] => {
    const scales: TYPES.ITimelineScale[] = [
      {
        unit: dateUnit === 'month' ? 'year' : dateUnit === 'hour' ? 'day' : 'month',
        step: 1,
        rowHeight: 20,
        format: ({ startDate }) =>
          dateUnit === 'month'
            ? `${startDate.getFullYear()} 年`
            : dateUnit === 'hour'
              ? `${startDate.getMonth() + 1} 月 ${startDate.getDate()} 日`
              : `${startDate.getFullYear()} 年 ${startDate.getMonth() + 1} 月`,
        style: {
          color: c.muted,
          fontSize: 12,
          fontWeight: '500',
          textAlign: 'left',
          padding: [0, 14],
        },
      },
      {
        unit: dateUnit,
        step,
        startOfWeek: 'monday',
        rowHeight: 44,
        format: ({ startDate }) => {
          const today = new Date(ganttDate(now.value))
          const label =
            startDate.toDateString() === today.toDateString()
              ? '今天'
              : ['日', '一', '二', '三', '四', '五', '六'][startDate.getDay()]
          return `${String(startDate.getDate()).padStart(2, '0')}  ${label}`
        },
        customLayout: ({ width, height, startDate, endDate }) => {
          const rootContainer = new VRender.Group({
            width,
            height,
            clip: true,
            fill: 'transparent',
            pickable: true,
            cursor: 'pointer',
          })
          // Native week scales keep their zoom thresholds; show individual days
          // when a whole month still leaves enough room for readable dates.
          const daily = dateUnit === 'week'
          const unit = daily ? BOARD_DAY : BOARD_DAY / 24
          const cells = Math.round((endDate.getTime() + 1 - startDate.getTime()) / unit)
          if ((daily || (dateUnit === 'hour' && step > 1)) && width / cells >= (daily ? 24 : 44)) {
            for (let index = 0; index < cells; index++) {
              const start = new Date(startDate.getTime() + index * unit)
              const cell = new VRender.Rect({
                x: (width * index) / cells,
                width: width / cells,
                height,
                fill: 'transparent',
                cursor: daily ? 'pointer' : 'default',
              })
              if (daily)
                cell.addEventListener('click', () =>
                  focusPeriod(start, new Date(start.getTime() + BOARD_DAY - 1)),
                )
              rootContainer.add(cell)
              rootContainer.add(
                new VRender.Text({
                  x: (width * (index + 0.5)) / cells,
                  y: height / 2 - (daily ? 8 : 0),
                  text: daily
                    ? String(start.getDate()).padStart(2, '0')
                    : `${String(start.getHours()).padStart(2, '0')}:00`,
                  fontFamily: font,
                  fontSize: daily ? 14 : 12,
                  fontWeight: 600,
                  textAlign: 'center',
                  textBaseline: 'middle',
                  fill: c.text,
                  pickable: false,
                }),
              )
              if (daily)
                rootContainer.add(
                  new VRender.Text({
                    x: (width * (index + 0.5)) / cells,
                    y: height / 2 + 10,
                    text: ['日', '一', '二', '三', '四', '五', '六'][start.getDay()],
                    fontFamily: font,
                    fontSize: 10,
                    textAlign: 'center',
                    textBaseline: 'middle',
                    fill: c.muted,
                    pickable: false,
                  }),
                )
            }
            return { rootContainer, renderDefaultText: false }
          }
          rootContainer.addEventListener('click', () => focusPeriod(startDate, endDate))
          const withIcon = dateUnit !== 'hour' && width >= (dateUnit === 'week' ? 96 : 80)
          const x = withIcon ? width / 2 - (dateUnit === 'week' ? 38 : 30) : width / 2
          if (withIcon)
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
          const shortDate = (date: Date) =>
            `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
          const textX = withIcon ? x + 30 : x
          const textAlign = withIcon ? 'left' : 'center'
          const maxLineWidth = Math.max(0, withIcon ? width - textX - 3 : width - 4)
          rootContainer.add(
            new VRender.Text({
              x: textX,
              y: dateUnit === 'hour' ? height / 2 : height / 2 - 8,
              text:
                dateUnit === 'week'
                  ? width < 60
                    ? String(startDate.getDate()).padStart(2, '0')
                    : shortDate(startDate)
                  : dateUnit === 'month'
                    ? `${startDate.getMonth() + 1}月`
                    : dateUnit === 'hour'
                      ? `${String(startDate.getHours()).padStart(2, '0')}:00`
                      : String(startDate.getDate()).padStart(2, '0'),
              fontFamily: font,
              fontSize: dateUnit === 'hour' ? 13 : width < 40 || dateUnit === 'week' ? 14 : 18,
              fontWeight: 600,
              textAlign,
              maxLineWidth,
              textBaseline: 'middle',
              fill: c.text,
              pickable: false,
            }),
          )
          rootContainer.add(
            new VRender.Text({
              x: textX,
              y: height / 2 + 10,
              text:
                dateUnit === 'week'
                  ? width < 60
                    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][startDate.getDay()]
                    : `— ${shortDate(endDate)}`
                  : dateUnit === 'month'
                    ? `${startDate.getDate()}–${endDate.getDate()}日`
                    : dateUnit === 'hour'
                      ? ''
                      : startDate.toDateString() === new Date(ganttDate(now.value)).toDateString()
                        ? '今天'
                        : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
                            startDate.getDay()
                          ],
              fontFamily: font,
              fontSize: width < 40 ? 10 : 12,
              textAlign,
              maxLineWidth,
              textBaseline: 'middle',
              fill: c.text,
              pickable: false,
            }),
          )
          return { rootContainer, renderDefaultText: false }
        },
      },
      // A hidden hourly scale keeps eight-hour batches eight hours wide.
      {
        unit: 'hour',
        step: dateUnit === 'month' ? 720 : dateUnit === 'week' ? 168 : 24,
        visible: false,
      },
    ]
    return scales.filter((scale) => dateUnit !== 'hour' || scale.visible !== false)
  }
  const levels = gantt?.zoomScaleManager?.config.levels || [
    scaleLevel('month'),
    scaleLevel('week'),
    scaleLevel('day'),
    scaleLevel('hour', 12),
    scaleLevel('hour'),
  ]
  const scales = levels[gantt?.zoomScaleManager?.findOptimalLevel(millisecondsPerPixel.value) ?? 2]!
  return {
    records: viewportRecords(scrollTop),
    tasksShowMode: TYPES.TasksShowMode.Project_Sub_Tasks_Inline,
    projectSubTasksExpandable: true,
    minDate: `${range.value[0]}T00:00:00.000`,
    maxDate: `${range.value[1]}T23:59:59.999`,
    rowHeight,
    headerRowHeight: headerHeight,
    overscrollBehavior: 'none',
    underlayBackgroundColor: groupBackground,
    taskListTable: {
      tableWidth,
      // The timeline needs every batch row's height before positioning its bars.
      customConfig: { forceComputeAllRowHeight: true },
      columns: [
        {
          field: 'name',
          title: '流水号',
          width: 216,
          tree: false,
          style: {
            padding: [0, 48, 0, 14],
            fontWeight: 600,
            color: c.text,
          },
          customLayout: ({ rect, table, col, row }) => {
            const record = table.getRecordByCell(col, row) as ScheduleGanttRecord
            const rootContainer = new VRender.Group({ width: rect!.width, height: rect!.height })
            if (record.hierarchyState === 'collapse') {
              const top = (rect!.height - ((record.laneCount - 1) * laneHeight + barHeight)) / 2
              for (const [lane, number] of (record.batchNumbers || []).entries())
                rootContainer.add(
                  new VRender.Text({
                    x: rect!.width - 10,
                    y: top + lane * laneHeight + barHeight / 2,
                    text: `${number}批`,
                    fontFamily: font,
                    fontSize: 10,
                    textAlign: 'right',
                    textBaseline: 'middle',
                    fill: c.muted,
                    pickable: false,
                  }),
                )
            }
            return { rootContainer, renderDefault: true }
          },
        },
        {
          field: 'quantity',
          title: '计划数',
          width: 84,
          style: { textAlign: 'right', padding: [0, 12, 0, 4] },
        },
      ],
      customComputeRowHeight: ({ row, table }) =>
        row === 0
          ? headerHeight
          : ganttRowHeight(table.getRecordByCell(0, row) as ScheduleGanttRecord, sizing),
      theme: {
        underlayBackgroundColor: groupBackground,
        defaultStyle: {
          fontFamily: font,
          fontSize: sizing.scale === 1 ? 14 : 13,
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
          fontSize: sizing.scale === 1 ? 14 : 13,
          fontWeight: 400,
          hover: { cellBgColor: c.mutedSurface, inlineRowBgColor: c.mutedSurface },
        },
        frameStyle: { borderLineWidth: 0 },
      },
      hover: { highlightMode: 'row' },
      select: { disableSelect: true },
      tooltip: { isShowOverflowTextTooltip: false },
    },
    timelineHeader: {
      colWidth: ((BOARD_DAY / 24) * (scales.at(-1)?.step || 1)) / millisecondsPerPixel.value,
      backgroundColor: header,
      verticalLine: { lineColor: gridLine, lineWidth: 0 },
      horizontalLine: { lineColor: gridLine, lineWidth: 0 },
      scales,
      zoomScale: {
        enabled: true,
        levels,
        dataZoomAxis: { enabled: false },
      },
    },
    grid: {
      backgroundColor: gridBackground,
      horizontalBackgroundColor: ({ index, ganttInstance }) =>
        rowRecord(index, ganttInstance)?.kind === 'serial' ? groupBackground : 'transparent',
      verticalLineDependenceOnTimeScale: 'hour',
      verticalLine: { lineColor: gridLine, lineWidth: 0.5 },
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
      horizontalVisible: 'none',
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
        cornerRadius: 6,
        fillColor: c.surface,
        borderColor: c.muted,
        borderLineWidth: 0,
        labelText: '{milestoneLabel}',
        textOrient: 'left',
        labelTextStyle: { fontSize: 10, color: c.muted },
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
      customLayout: ({ width, height, taskRecord, startDate, ganttInstance }) => {
        const record = taskRecord as ScheduleGanttRecord
        if (record.type === 'milestone') {
          // Keep a larger hit area around the small time-point marker.
          const rootContainer = new VRender.Group({ width: 12, height: 12, fill: 'transparent' })
          rootContainer.add(
            new VRender.Circle({
              x: 6,
              y: 6,
              radius: 3,
              fill: record.kind === 'deadline' ? c.muted : c.surface,
              stroke: record.node ? boardTeamColor(record.node.team_name) : c.muted,
              lineWidth: 1.5,
              pickable: false,
            }),
          )
          return { rootContainer, renderDefaultBar: false, renderDefaultText: true }
        }
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
        // Keep VTable's three-stop gradient at every zoom level.
        const pale = `rgb(${[1, 3, 5]
          .map((offset) =>
            Math.round(parseInt(teamColor.slice(offset, offset + 2), 16) * 0.62 + 255 * 0.38),
          )
          .join(',')})`
        const gradient = {
          gradient: 'linear' as const,
          x0: 0,
          y0: 0,
          x1: 1,
          y1: 0,
          stops: [
            { offset: 0, color: pale },
            { offset: 0.5, color: teamColor },
            { offset: 1, color: pale },
          ],
        }
        rootContainer.setAttributes({ cornerRadius: 20, fill: gradient })
        if (sizing.scale < 1) {
          rootContainer.setAttributes({ fill: 'transparent' })
          const trackY = height - 1
          // Keep the full team gradient opaque at every progress value, matching the expanded bar.
          rootContainer.add(
            new VRender.Rect({
              x: 0,
              y: trackY,
              width,
              height: 4,
              fill: gradient,
              pickable: false,
            }),
          )
          // Labels stay above the continuous handover line, not inside tiny pills.
          if (width >= 22) {
            const inline = width >= 50
            rootContainer.add(
              new VRender.Text({
                x: width / 2,
                y: inline ? 2 : -2,
                text:
                  inline && progress != null
                    ? `${record.node!.team_name} ${Math.floor(progress)}%`
                    : record.node!.team_name,
                fontFamily: font,
                fontSize: inline
                  ? 10
                  : Math.max(8, Math.min(9, (width - 2) / record.node!.team_name.length)),
                lineHeight: inline ? 12 : 9,
                fontWeight: 600,
                textAlign: 'center',
                textBaseline: 'top',
                fill: c.text,
                pickable: false,
              }),
            )
            if (!inline && progress != null)
              rootContainer.add(
                new VRender.Text({
                  x: width / 2,
                  y: 8,
                  text: `${Math.floor(progress)}%`,
                  fontFamily: font,
                  fontSize: 8,
                  lineHeight: 8,
                  textAlign: 'center',
                  textBaseline: 'top',
                  fill: c.muted,
                  pickable: false,
                }),
              )
          }
          if (state === 'overdue' || state === 'completed_late')
            rootContainer.add(
              new VRender.Circle({
                x: width,
                y: trackY + 2,
                radius: 2,
                fill: state === 'overdue' ? '#d44945' : '#c47a20',
                pickable: false,
              }),
            )
          return { rootContainer, renderDefaultBar: false, renderDefaultText: false }
        }
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
              x: width - 7,
              y: -3,
              width: 10,
              height: 10,
              image: statusIcon(state, stateColor),
              pickable: false,
            }),
          )
        const label = record.node!.team_name
        const percentWidth = Math.max(28, height)
        const showPercent = progress != null && width >= percentWidth + 4
        const labelFontSize = sizing.scale === 1 ? 13 : 12
        const labelGraphic = new VRender.Text({
          text: label,
          fontFamily: font,
          fontSize: labelFontSize,
          fontWeight: 600,
          fill: '#fff',
          textBaseline: 'middle',
          pickable: false,
        })
        const labelWidth = labelGraphic.AABBBounds.width()
        const quantityGraphic = new VRender.Text({
          text: `${record.quantity}${record.node!.completion_basis === 'weight' ? '' : '件'}`,
          fontFamily: font,
          fontSize: sizing.scale === 1 ? 11 : 10,
          fontWeight: 600,
          fill: '#fff',
          textBaseline: 'middle',
          pickable: false,
        })
        let quantityWidth = quantityGraphic.AABBBounds.width()
        const symbolSize = height - 4
        const textEnd = width - (showPercent ? percentWidth + 6 : 4)
        const minFontSize = sizing.scale === 1 ? 11 : 10
        const minLabelWidth = (labelWidth * minFontSize) / labelFontSize
        // Drop decoration before squeezing the team name, batch quantity or progress.
        let showSymbol =
          symbolSize >= 14 && textEnd - symbolSize - 7 >= labelWidth + quantityWidth + 4
        if (textEnd - 4 < minLabelWidth + quantityWidth + 4 && textEnd >= symbolSize + 7) {
          showSymbol = symbolSize >= 14
          // At a wider date range, use the team icon and a compact quantity instead of "…".
          if (showSymbol && quantityWidth > textEnd - symbolSize - 7) {
            quantityGraphic.setAttributes({ text: record.quantity.replace(/,/g, '') })
            quantityWidth = quantityGraphic.AABBBounds.width()
          }
        }
        const textStart = showSymbol ? symbolSize + 7 : 4
        const showQuantity = textEnd - textStart >= quantityWidth
        const quantitySpace = showQuantity ? quantityWidth + 4 : 0
        const space = {
          x: textStart,
          width: textEnd - textStart - quantitySpace,
        }
        const fittedFontSize = Math.max(
          minFontSize,
          Math.min(labelFontSize, Math.floor((labelFontSize * space.width) / labelWidth)),
        )
        const showLabel = space.width >= minLabelWidth
        if (showSymbol) {
          rootContainer.add(
            new VRender.Circle({
              x: 2 + symbolSize / 2,
              y: height / 2,
              radius: symbolSize / 2,
              fill: '#fff',
              pickable: false,
            }),
          )
          const glyphSize = symbolSize * 0.65
          rootContainer.add(
            new VRender.Image({
              x: 2 + (symbolSize - glyphSize) / 2,
              y: (height - glyphSize) / 2,
              width: glyphSize,
              height: glyphSize,
              image: teamSymbol(record.node!.team_name, teamColor),
              pickable: false,
            }),
          )
        }
        if (showLabel) {
          labelGraphic.setAttributes({
            x: space.x,
            y: height / 2,
            fontSize: fittedFontSize,
            maxLineWidth: space.width,
            ellipsis: '…',
          })
          rootContainer.add(labelGraphic)
        }
        if (showQuantity) {
          quantityGraphic.setAttributes({ x: textEnd - quantityWidth, y: height / 2 })
          rootContainer.add(quantityGraphic)
        }
        if (showPercent) {
          const x = width - percentWidth / 2 - 2
          const y = height / 2
          rootContainer.add(
            new VRender.Rect({
              x: x - percentWidth / 2,
              y: 1,
              width: percentWidth,
              height: height - 2,
              cornerRadius: (height - 2) / 2,
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
              fontFamily: font,
              fontSize: height < 18 ? 8 : 9,
              fontWeight: 600,
              textAlign: 'center',
              textBaseline: 'middle',
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
  // Keep navigation arrows inside their batch row, including the first visible row.
  gantt?.scenegraph.taskBar.locateIconsGroup?.forEachChildren((child) => {
    const icon = child as unknown as VRender.Group
    icon.setAttributes({ dy: 0, scaleX: 0.65, scaleY: 0.65 })
  })
}
function requestMoreIfNeeded() {
  cancelAnimationFrame(moreFrame)
  if (!props.hasMore) return
  moreFrame = requestAnimationFrame(() => {
    if (
      gantt &&
      props.hasMore &&
      !props.loading &&
      !props.loadingMore &&
      !props.loadError &&
      gantt.getAllTaskBarsHeight() - gantt.scrollTop - gantt.gridHeight < 160
    )
      emit('load-more')
  })
}
function stopDensityMotion() {
  cancelAnimationFrame(densityFrame)
  densityFrame = 0
  for (const group of densityGroups) group.setAttribute('scaleY', 1)
  densityGroups = []
}
function animateDensity(fromScale: number) {
  if (!gantt || fromScale === 1) return
  const scene = gantt.scenegraph
  const tableScene = gantt.taskListTableInstance?.scenegraph
  // Transform only the row content, keeping both headers and clipping frames fixed.
  // This avoids rebuilding the two canvases on every animation frame.
  densityGroups = [
    tableScene?.bodyGroup,
    tableScene?.rowHeaderGroup,
    scene.grid?.horizontalLineGroup,
    scene.grid?.horizontalBackgroundRectsGroup,
    scene.taskBar.barContainer,
    scene.taskBar.locateIconsGroup,
  ].filter((group): group is VRender.Group => !!group)
  if (!densityGroups.length) return
  const started = performance.now()
  const draw = (time: number) => {
    const progress = Math.min(1, (time - started) / 180)
    const scale = 1 + (fromScale - 1) * (1 - progress) ** 3
    for (const group of densityGroups) group.setAttribute('scaleY', scale)
    scene.updateNextFrame()
    tableScene?.updateNextFrame()
    if (progress < 1) densityFrame = requestAnimationFrame(draw)
    else {
      densityFrame = 0
      densityGroups = []
    }
  }
  draw(started)
}
function render(resetScroll = false) {
  if (!host.value) return
  rendering = true
  viewportWidth.value = Math.max(1, (host.value.clientWidth || 1200) - tableWidth - 4)
  if (fittedRange.value) millisecondsPerPixel.value = initialScale()
  const scale = millisecondsPerPixel.value
  const previousDensity = renderedDensity * (densityGroups[0]?.attribute.scaleY ?? 1)
  stopDensityMotion()
  const animateView = resetScroll && !!gantt
  viewAnimation?.cancel()
  const selection =
    !resetScroll && pinned.value && hovered.value
      ? records
          .flatMap((task) => [
            task,
            ...(task.children || []).flatMap((team) => [team, ...(team.children || [])]),
          ])
          .find((record) => record.id === hovered.value!.id)
      : undefined
  hidePopover()
  if (gantt) {
    const left = gantt.scrollLeft,
      top = gantt.scrollTop
    gantt.updateOption(options(resetScroll ? 0 : top))
    applyNativeScale(scale)
    if (!resetScroll) {
      gantt.scrollLeft = left
      gantt.scrollTop = top
    }
  } else {
    gantt = new Gantt(host.value, options())
    // 1.26.8 calculates zoom thresholds from every scale, including hidden ones.
    // After those thresholds are initialized, keep the drawing grid at 24 hours:
    // a partial last week/month must not stretch an eight-hour batch.
    for (const level of gantt.zoomScaleManager!.config.levels) {
      const precision = level.find((item) => item.unit === 'hour' && item.visible === false)
      if (precision) precision.step = 24
    }
    applyNativeScale(scale)
    gantt.on('zoom', onNativeZoom)
    gantt.on('click_task_bar', ({ record, federatedEvent }) =>
      selectBatch(record as ScheduleGanttRecord, federatedEvent.clientX, federatedEvent.clientY),
    )
    gantt.on('scroll', () => {
      syncZoomState()
      stopDensityMotion()
      hidePopover()
      positionLocateIcons()
      refreshViewport()
      requestMoreIfNeeded()
    })
  }
  gantt.zoomScaleManager?.updateDataZoomResponsive()
  gantt.zoomScaleManager?.getDataZoomIntegration()?.syncToDataZoom()
  syncZoomState()
  rendering = false
  positionLocateIcons()
  if (boundTable !== gantt.taskListTableInstance) {
    boundTable = gantt.taskListTableInstance
    boundTable?.on('click_cell', ({ row, col, targetIcon }) => {
      if (row === 0 || col !== 0 || targetIcon) return
      const record = boundTable!.getRecordByCell(col, row) as ScheduleGanttRecord
      if (record) open(record)
    })
  }
  if (selection) selectBatch(selection, pointer.value.x, pointer.value.y)
  renderedDensity = density.value.scale
  // Fade the date axis and bars together; live resize/data refresh stay immediate.
  if (animateView) animateViewChange(previousDensity)
  requestMoreIfNeeded()
}
function animateViewChange(previousDensity: number) {
  viewAnimation?.cancel()
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    viewAnimation = host.value?.animate?.([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: 180,
      easing: 'ease-out',
    })
    animateDensity(previousDensity / renderedDensity)
  }
}
function release() {
  cancelAnimationFrame(zoomFrame)
  cancelAnimationFrame(viewportFrame)
  stopDensityMotion()
  viewAnimation?.cancel()
  viewAnimation = undefined
  // VTable 1.26.8 disconnects observers but leaves their debounced callbacks queued.
  // Detach callbacks before the Gantt and list-table canvases are released.
  for (const handler of [
    gantt?.eventManager._eventHandler,
    gantt?.taskListTableInstance?.internalProps?.handler,
  ]) {
    const listeners = (
      handler as unknown as { reseizeListeners?: Record<string, { cb: unknown }> } | undefined
    )?.reseizeListeners
    for (const listener of Object.values(listeners || {})) listener.cb = undefined
  }
  // VTable 1.26.8 leaves scrollbar auto-hide timers alive after releasing the canvas.
  const scrollbar = gantt?.scenegraph.scrollbarComponent
  clearTimeout(scrollbar?._clearHorizontalScrollBar)
  clearTimeout(scrollbar?._clearVerticalScrollBar)
  // VTable Gantt 1.26.8 clears scenegraph without releasing its Canvas listeners.
  gantt?.scenegraph.release()
  gantt?.release()
  gantt = undefined
  boundTable = undefined
}
watch(
  () => props.tasks,
  async (tasks, previous) => {
    records = scheduleGanttRecords(tasks)
    if (initialRangePending) {
      const openingRange = ganttOpeningRange(records)
      if (openingRange) {
        initialRangePending = false
        range.value = openingRange
      }
    }
    const identity = tasks.map((task) => task.id).join(',')
    let resetScroll = false
    if (identity !== taskIdentity) {
      taskIdentity = identity
      const appended =
        previous?.length &&
        tasks.length > previous.length &&
        previous.every((task, index) => tasks[index]?.id === task.id)
      if (!appended) {
        resetScroll = true
      }
    }
    await nextTick()
    render(resetScroll)
  },
  { immediate: true },
)
watch(() => [props.loading, props.loadingMore, props.hasMore, props.loadError], requestMoreIfNeeded)
watch(zoom, () => {
  if (!editingZoom.value) zoomInput.value = String(Math.round(zoom.value * 100))
})
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
  viewportWidth.value = Math.max(1, (host.value?.clientWidth || 1200) - tableWidth - 4)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', onPointerDown)
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
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', onPointerDown)
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  cancelAnimationFrame(moreFrame)
  clearInterval(clock)
  release()
})
</script>

<template>
  <section class="production-gantt" :aria-busy="loading" aria-label="物料交货甘特图">
    <div class="gantt-toolbar">
      <div class="gantt-search">
        <slot />
      </div>
      <div class="gantt-controls">
        <ScheduleDateRange :model-value="range" compact @update:model-value="changeRange" />
        <AppButton
          :disabled="fittedRange"
          :aria-label="`返回${overviewLabel}`"
          @click="showOverview"
        >
          {{ overviewLabel }}
        </AppButton>
        <div class="gantt-zoom" aria-label="时间缩放" title="Ctrl + 滚轮缩放">
          <AppButton
            text
            native-type="button"
            aria-label="缩小时间轴"
            :disabled="millisecondsPerPixel >= zoomLimits.max - 1"
            @click="changeZoom(-1)"
          >
            <IconMinus :size="14" />
          </AppButton>
          <AppInput
            ref="zoomInputElement"
            v-model="zoomInput"
            class="gantt-zoom-input"
            size="small"
            inputmode="decimal"
            aria-label="缩放百分比"
            @focus="beginZoom"
            @blur="commitZoom"
            @keydown.enter.prevent="submitZoom"
            @keydown.esc.stop.prevent="cancelZoom"
          >
            <template #suffix>%</template>
          </AppInput>
          <AppButton
            text
            native-type="button"
            aria-label="放大时间轴"
            :disabled="millisecondsPerPixel <= zoomLimits.min + 1"
            @click="changeZoom(1)"
          >
            <IconPlus :size="14" />
          </AppButton>
        </div>
        <AppButton title="上一时间段" aria-label="上一时间段" @click="shift(-1)"
          ><IconChevronLeft :size="16"
        /></AppButton>
        <AppButton title="定位排期" aria-label="定位排期" @click="fit"
          ><IconFocus2 :size="16"
        /></AppButton>
        <AppButton title="下一时间段" aria-label="下一时间段" @click="shift(1)"
          ><IconChevronRight :size="16"
        /></AppButton>
        <slot name="view-actions" />
      </div>
    </div>
    <div class="gantt-body">
      <div :id="canvasId" ref="host" class="gantt-canvas" />
      <div v-if="!tasks.length" class="gantt-empty">
        {{ loading ? '正在加载排期…' : '暂无排期' }}
      </div>
    </div>
    <footer class="gantt-legend">
      <div
        v-if="teamLegend.length"
        class="gantt-team-legend"
        role="group"
        aria-label="班组颜色说明"
      >
        <span class="gantt-legend-label">班组</span>
        <span v-for="team in teamLegend" :key="team.name" class="gantt-team-key">
          <i :style="{ backgroundColor: team.color }" aria-hidden="true" />{{ team.name }}
        </span>
      </div>
      <div class="gantt-status-legend" role="group" aria-label="交期状态说明">
        <span class="gantt-legend-label">交期</span>
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
        <div class="gantt-load-status">
          <slot name="load-status"
            ><span class="gantt-visible-range">{{ visibleRange }}</span></slot
          >
          <span v-if="loadingMore" role="status">加载中…</span>
          <AppButton v-else-if="loadError" text @click="emit('load-more')"
            >加载失败，重试</AppButton
          >
        </div>
      </div>
    </footer>
    <AppPopover
      :visible="popoverVisible"
      popper-class="gantt-batch-popover"
      :virtual-ref="virtualAnchor"
      virtual-triggering
      trigger="manual"
      placement="top-end"
      :width="320"
      :show-arrow="false"
      :teleported="true"
    >
      <div v-if="hovered">
        <ScheduleBatchSummary
          v-if="hovered.node"
          :key="hovered.id"
          :expanded="popoverVisible"
          :node="hovered.node"
          :serial-no="hovered.task.serial_no"
          :now="now"
          :relations="relations"
          :batches="
            hovered.kind === 'team' ? hovered.children?.map((batch) => batch.node!) : undefined
          "
          @open="open(hovered)"
        >
          <template #actions>
            <AppButton text circle size="small" aria-label="取消选中批次" @click="hidePopover"
              ><IconX :size="16"
            /></AppButton>
          </template>
        </ScheduleBatchSummary>
        <div v-else class="gantt-task-summary">
          <AppButton
            class="gantt-summary-close"
            text
            circle
            aria-label="关闭详情"
            @click="hidePopover"
            ><IconX :size="16"
          /></AppButton>
          <strong>{{ hovered.task.serial_no }}</strong
          ><span>最终交期 {{ formatDateTime(hovered.task.final_due_at) }}</span
          ><AppButton text @click="open(hovered)">查看明细</AppButton>
        </div>
      </div>
    </AppPopover>
    <div class="gantt-accessible">
      <template v-for="task in tasks" :key="task.id">
        <AppButton unstyled type="button" @click="emit('open-task', task)">
          {{ task.serial_no }} · 查看排期明细
        </AppButton>
        <AppButton
          unstyled
          v-for="node in task.nodes"
          :key="node.id"
          type="button"
          @click="emit('open-node', node)"
        >
          {{ task.serial_no }} · {{ node.sequence_no }} {{ node.team_name }} ·
          {{ formatDateTime(node.due_at) }}
        </AppButton>
      </template>
    </div>
  </section>
</template>

<style scoped>
:global(.gantt-batch-popover.el-popper) {
  background: var(--wm-surface, #fff);
  color: var(--wm-text, #20242c);
  padding: 0;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border: 0;
  border-radius: 12px;
  box-shadow:
    0 12px 36px #00000024,
    0 2px 8px #00000012;
  backdrop-filter: none;
}
.gantt-summary-close {
  position: absolute;
  right: 10px;
  top: 10px;
}
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
  padding: 8px 12px;
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
.gantt-zoom-input {
  width: 64px;
}
.gantt-zoom-input :deep(.el-input__wrapper) {
  min-height: 28px;
  padding: 0 4px;
  background: transparent;
  box-shadow: none;
}
.gantt-zoom-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--wm-border, #e4e4e7);
}
.gantt-zoom-input :deep(.el-input__inner) {
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.gantt-zoom-input :deep(.el-input__suffix) {
  margin-left: 2px;
  color: var(--wm-text, #18181b);
}
.gantt-zoom button {
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--wm-muted, #71717a);
  display: grid;
  place-items: center;
  margin: 0;
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
  background: #e8e8f7;
}
@media (prefers-color-scheme: dark) {
  .gantt-body {
    background: #282535;
  }
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
  flex-direction: column;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--wm-border, #e4e4e7);
  color: var(--wm-muted, #71717a);
  font-size: 12px;
}
.gantt-team-legend,
.gantt-status-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.gantt-team-legend {
  overflow-x: auto;
  scrollbar-width: thin;
}
.gantt-status-legend {
  flex-wrap: wrap;
  gap: 6px 16px;
}
.gantt-legend-label {
  flex-shrink: 0;
  color: var(--wm-text, #18181b);
  font-weight: 600;
}
.gantt-team-key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.gantt-team-key i {
  width: 14px;
  height: 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.gantt-load-status {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.gantt-status-legend > span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.gantt-legend :deep(.delivery-mark svg) {
  width: 14px;
  height: 14px;
}
.gantt-task-summary {
  position: relative;
  padding: 20px 44px 16px 16px;
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

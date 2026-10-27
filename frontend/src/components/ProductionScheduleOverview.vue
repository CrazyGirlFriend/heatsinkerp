<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Aim,
  Warning,
  CircleCheck,
  VideoPause,
  Clock,
  ZoomIn,
  ZoomOut,
  Lock,
} from '@element-plus/icons-vue'
import { ElButton, ElIcon, ElTooltip } from 'element-plus'
import AppDialog from './AppDialog.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
import ScheduleStockSummary from './ScheduleStockSummary.vue'
import StatePanel from './StatePanel.vue'
import ProductionScheduleGantt from './ProductionScheduleGantt.vue'
import {
  scheduleStatusLabels,
  type ProductionSchedule,
  type ScheduleTask,
} from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import { scheduleTeamStyle } from '@/utils/scheduleTeamColor'
import { scheduleTimestamp, SCHEDULE_ROW_HEIGHT } from '@/utils/scheduleTimeline'
import {
  deadlineRemaining,
  isAssessed,
  isDelivered,
  nodeCompletion,
  nodeProgress,
  nodeTarget,
  nodeActual,
  progressMarkers,
  progressRange,
  progressWeek,
  PROGRESS_CARD_WIDTH,
  PROGRESS_LANE_HEIGHT,
  SCHEDULE_WEEK,
  taskRisk,
} from '@/utils/scheduleProgress'

const props = defineProps<{ tasks: ScheduleTask[]; loading?: boolean }>()
const emit = defineEmits<{
  'open-task': [task: ScheduleTask]
  'open-node': [node: ProductionSchedule]
}>()
const DAY = SCHEDULE_WEEK / 7
const now = ref(Date.now())
const routeTaskId = ref<number | null>(null)
const hoveredNode = ref<{ taskId: number; nodeId: number } | null>(null)
const focusedNode = ref<{ taskId: number; nodeId: number } | null>(null)
const activeNode = computed(() => hoveredNode.value || focusedNode.value)
const routeTask = computed(() => props.tasks.find((task) => task.id === routeTaskId.value))
const routeRisk = computed(() => (routeTask.value ? taskRisk(routeTask.value) : null))
const dateText = (timestamp: number) =>
  formatDateTime(new Date(timestamp).toISOString()).slice(0, 10)
function periodRange(anchor: number, days = 7): [string, string] {
  const period = progressWeek(anchor, now.value, days)
  return [dateText(period.start), dateText(period.end - 1)]
}
const dateRange = ref<[string, string]>(periodRange(now.value - SCHEDULE_WEEK, 14))
const week = computed(() =>
  progressRange(
    Date.parse(`${dateRange.value[0]}T00:00:00+08:00`),
    Date.parse(`${dateRange.value[1]}T00:00:00+08:00`) + DAY,
    now.value,
  ),
)
const dayCount = computed(() => week.value.days.length)
const scrollElement = ref<HTMLElement>(),
  viewportWidth = ref(1000)
const scrollLeft = ref(0)
const sideWidth = computed(() => (viewportWidth.value <= 900 ? 220 : 260))
const zoom = ref(1)
const width = computed(
  () =>
    Math.max(viewportWidth.value - sideWidth.value, dayCount.value * (PROGRESS_CARD_WIDTH + 24)) *
    zoom.value,
)
const gridWidth = computed(() => width.value + sideWidth.value)
const hourTicks = computed(() => {
  const dayWidth = width.value / dayCount.value
  return dayWidth >= 384 ? [0, 3, 6, 9, 12, 15, 18, 21] : dayWidth >= 192 ? [0, 6, 12, 18] : []
})
const weekendShading = computed(() => {
  const stops = week.value.days.flatMap((day, index) => {
    const start = (index / dayCount.value) * 100
    const end = ((index + 1) / dayCount.value) * 100
    const color = day.weekend ? '#f7f2f280' : 'transparent'
    return [`${color} ${start}%`, `${color} ${end}%`]
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
})
watch(dateRange, () => {
  if (scrollElement.value) scrollElement.value.scrollLeft = 0
})
let observer: ResizeObserver | undefined, timer: ReturnType<typeof setInterval> | undefined
const groups = computed(() =>
  props.tasks.map((task) => {
    const progress = progressMarkers(task.nodes, week.value, width.value)
    const hasVisibleCard = progress.markers.some((marker) => {
      const left = marker.x + marker.labelOffset
      return (
        left + PROGRESS_CARD_WIDTH > scrollLeft.value &&
        left < scrollLeft.value + viewportWidth.value - sideWidth.value
      )
    })
    const active = activeNode.value?.taskId === task.id ? activeNode.value.nodeId : null
    const selected = task.nodes.find((node) => node.id === active)
    const related = new Set(
      selected
        ? [
            selected.id,
            selected.predecessor_id,
            ...task.nodes
              .filter((node) => node.predecessor_id === selected.id)
              .map((node) => node.id),
          ]
        : [],
    )
    return {
      task,
      ...progress,
      active,
      related,
      markers: progress.markers.map((marker) => ({
        ...marker,
        completion: nodeCompletion(marker.node),
      })),
      before: hasVisibleCard
        ? []
        : [
            ...progress.outside.filter(
              (node) => (scheduleTimestamp(node.due_at) ?? Infinity) < week.value.start,
            ),
            ...progress.markers
              .filter(
                (marker) => marker.x + marker.labelOffset + PROGRESS_CARD_WIDTH <= scrollLeft.value,
              )
              .map((marker) => marker.node),
          ],
      after: hasVisibleCard
        ? []
        : [
            ...progress.markers
              .filter(
                (marker) =>
                  marker.x + marker.labelOffset >=
                  scrollLeft.value + viewportWidth.value - sideWidth.value,
              )
              .map((marker) => marker.node),
            ...progress.outside.filter(
              (node) => (scheduleTimestamp(node.due_at) ?? -Infinity) >= week.value.end,
            ),
          ],
    }
  }),
)
const calendarBands = computed(() => {
  const bands: { label: string; shortLabel: string; count: number }[] = []
  for (const day of week.value.days) {
    const label = `${dateText(day.date).slice(0, 4)} 年 ${Number(dateText(day.date).slice(5, 7))} 月`
    const last = bands.at(-1)
    if (last?.label === label) last.count++
    else bands.push({ label, shortLabel: `${Number(dateText(day.date).slice(5, 7))} 月`, count: 1 })
  }
  return bands
})
const teamLegend = computed(() => [
  ...new Map(
    props.tasks.flatMap((task) => task.nodes).map((node) => [node.team_id, node]),
  ).values(),
])
const todayPosition = computed(
  () => ((now.value - week.value.start) / (week.value.end - week.value.start)) * 100,
)
async function changeZoom(value: number) {
  const element = scrollElement.value
  const visibleWidth = Math.max(0, viewportWidth.value - sideWidth.value)
  const position = ((element?.scrollLeft || 0) + visibleWidth / 2) / width.value
  zoom.value = Math.max(1, Math.min(8, value))
  await nextTick()
  element?.scrollTo({ left: Math.max(0, position * width.value - visibleWidth / 2) })
}
function openRoute(task: ScheduleTask) {
  routeTaskId.value = task.id
}
function shiftRange(direction: number) {
  const offset = direction * dayCount.value * DAY
  dateRange.value = [dateText(week.value.start + offset), dateText(week.value.end - 1 + offset)]
}
async function locate(node: ProductionSchedule) {
  const time = scheduleTimestamp(node.due_at)
  if (time == null) return
  if (time < week.value.start || time >= week.value.end)
    dateRange.value = periodRange(time, dayCount.value)
  await nextTick()
  if (scrollElement.value)
    scrollElement.value.scrollLeft = Math.max(
      0,
      ((time - week.value.start) / (week.value.end - week.value.start)) * width.value -
        (viewportWidth.value - sideWidth.value) / 2,
    )
}
function locateTask(task: ScheduleTask) {
  const node =
    task.nodes.find((node) => ['current', 'late', 'hold'].includes(state(node))) ||
    task.nodes.find((node) => !isDelivered(node) && node.status !== 'cancelled') ||
    task.nodes.at(-1)
  if (node) locate(node)
  routeTaskId.value = null
}
function state(node: ProductionSchedule) {
  if (node.status === 'cancelled') return 'cancelled'
  if (isDelivered(node)) return 'done'
  if (node.quality_held) return 'hold'
  if (node.status === 'overdue') return 'late'
  if ((node.stock?.on_hand_quantity || 0) > 0 || (node.stock?.on_hand_weight || 0) > 0)
    return 'current'
  if ((node.stock?.pending_quantity || 0) > 0 || (node.stock?.pending_weight || 0) > 0)
    return 'transit'
  return 'pending'
}
function label(node: ProductionSchedule) {
  if (node.quality_held) return '质量暂扣'
  if (!isAssessed(node)) return '库房备料'
  if (node.status === 'overdue' || isDelivered(node) || node.status === 'cancelled')
    return scheduleStatusLabels[node.status]
  if (node.execution_state === 'partial') return '部分交货'
  if ((node.processed_quantity || 0) > 0)
    return node.target_quantity && node.processed_quantity! >= node.target_quantity
      ? '加工完成'
      : '部分加工'
  if ((node.stock?.on_hand_quantity || 0) > 0 || (node.stock?.on_hand_weight || 0) > 0)
    return '物料在此'
  if (node.execution_state === 'pending_receipt') return '待签收'
  return scheduleStatusLabels[node.status]
}
function target(task: ScheduleTask) {
  const last =
    task.nodes.filter((node) => node.status !== 'cancelled' && isAssessed(node)).at(-1) ||
    task.nodes.at(-1)
  if (!last) return '—'
  return nodeTarget(last)
}
function completedAmount(task: ScheduleTask) {
  const last = task.nodes.filter((node) => isAssessed(node) && isDelivered(node)).at(-1)
  return last ? nodeActual(last) : '—'
}

function amounts(quantity: number, weight: number) {
  return `${formatAmount(quantity)} 件 · ${formatAmount(weight)} kg`
}
function stock(node: ProductionSchedule) {
  if (!node.stock) return '未获取库存'
  const value = node.stock
  const parts = []
  if (value.on_hand_quantity || value.on_hand_weight)
    parts.push(`实存 ${amounts(value.on_hand_quantity, value.on_hand_weight)}`)
  if (value.pending_quantity || value.pending_weight)
    parts.push(`待签收 ${amounts(value.pending_quantity, value.pending_weight)}`)
  if (value.rework_quantity) parts.push(`待返工 ${formatAmount(value.rework_quantity)} 件`)
  return parts.join('；') || '当前无关联库存'
}
function markerTitle(task: ScheduleTask, node: ProductionSchedule) {
  return `${task.serial_no} ${task.title} · 第${node.sequence_no}站 ${node.team_name} → ${node.next_team_name || node.external_destination}\n要求转出 ${formatDateTime(node.due_at)}\n${isAssessed(node) ? '加工完成后有效交货' : '实际转出'} ${nodeProgress(node)}\n${isAssessed(node) && node.processed_quantity != null ? `已加工 ${formatAmount(node.processed_quantity)} 件` : ''}\n${stock(node)}\n${label(node)}`
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    let positioned = false
    observer = new ResizeObserver((entries) => {
      const value = entries[0]?.contentRect.width
      if (value) viewportWidth.value = value
      if (value && !positioned) {
        positioned = true
        nextTick(() => {
          const visible = value - sideWidth.value
          const dayWidth = width.value / dayCount.value
          const left = (todayPosition.value / 100) * width.value - visible * 0.7
          // Open near today while keeping earlier operations available by scrolling left.
          scrollElement.value?.scrollTo({
            left: Math.max(0, Math.floor(left / dayWidth) * dayWidth),
          })
        })
      }
    })
    if (scrollElement.value) observer.observe(scrollElement.value)
  }
  timer = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  clearInterval(timer)
})
</script>

<template>
  <section
    class="schedule-progress"
    aria-label="全局交货进度"
    :aria-busy="loading"
    :style="{
      '--timeline-width': `${width}px`,
      '--grid-width': `${gridWidth}px`,
      '--day-count': dayCount,
      '--hour-count': hourTicks.length || 1,
      '--weekend-shading': weekendShading,
      '--frozen-width': `${sideWidth}px`,
      '--card-width': `${PROGRESS_CARD_WIDTH}px`,
      '--lane-height': `${PROGRESS_LANE_HEIGHT}px`,
    }"
  >
    <div class="sp-weekbar">
      <div class="sp-range">
        <ScheduleDateRange v-model="dateRange" />
      </div>
      <div class="sp-week-actions">
        <div class="sp-zoom" role="group" aria-label="时间轴缩放">
          <span>缩放</span>
          <button
            type="button"
            aria-label="缩小时间轴"
            title="缩小时间轴"
            :disabled="zoom === 1"
            @click="changeZoom(zoom / 2)"
          >
            <ElIcon><ZoomOut /></ElIcon>
          </button>
          <button
            type="button"
            class="sp-zoom-reset"
            aria-label="恢复时间轴比例"
            title="恢复默认比例"
            @click="changeZoom(1)"
          >
            {{ zoom * 100 }}%
          </button>
          <button
            type="button"
            aria-label="放大时间轴"
            title="放大时间轴"
            :disabled="zoom === 8"
            @click="changeZoom(zoom * 2)"
          >
            <ElIcon><ZoomIn /></ElIcon>
          </button>
        </div>
        <button
          type="button"
          class="sp-icon-button"
          aria-label="上一时间段"
          @click="shiftRange(-1)"
        >
          <ElIcon><ArrowLeft /></ElIcon>
        </button>
        <button type="button" class="sp-subtle-button" @click="dateRange = periodRange(now)">
          本周
        </button>
        <button type="button" class="sp-icon-button" aria-label="下一时间段" @click="shiftRange(1)">
          <ElIcon><ArrowRight /></ElIcon>
        </button>
      </div>
    </div>
    <div
      ref="scrollElement"
      class="sp-scroll"
      tabindex="0"
      role="region"
      aria-label="排期表，可左右滚动时间轴"
      @scroll="scrollLeft = scrollElement?.scrollLeft || 0"
    >
      <div class="sp-table-head sp-grid">
        <span class="sp-head-serial">流水号</span>
        <span class="sp-head-target">数量</span>
        <div class="sp-calendar">
          <div class="sp-calendar-bands">
            <span
              v-for="(band, index) in calendarBands"
              :key="index"
              :style="{ flex: band.count }"
              :title="band.label"
              ><b>{{ band.count < 3 ? band.shortLabel : band.label }}</b></span
            >
          </div>
          <div class="sp-days">
            <div
              v-for="day in week.days"
              :key="day.date"
              class="sp-day"
              :class="{ 'is-today': day.today, 'is-weekend': day.weekend }"
            >
              <b>{{ day.label }}</b
              ><small>{{ day.today ? '今天' : day.weekday }}</small>
            </div>
          </div>
          <div v-if="hourTicks.length" class="sp-hours" aria-label="小时刻度">
            <div v-for="day in week.days" :key="day.date" class="sp-hour-day">
              <span v-for="hour in hourTicks" :key="hour">{{ String(hour).padStart(2, '0') }}</span>
            </div>
          </div>
          <span
            v-if="todayPosition >= 0 && todayPosition <= 100"
            class="sp-now-head"
            :style="{ left: `${todayPosition}%` }"
            aria-label="当前时间"
          />
        </div>
      </div>
      <StatePanel v-if="loading && !tasks.length" state="loading" compact />
      <div v-else-if="!tasks.length" class="sp-empty">当前范围没有交货任务</div>
      <article
        v-for="group in groups"
        :key="group.task.id"
        class="sp-row"
        :aria-label="`${group.task.serial_no} ${group.task.title}`"
      >
        <div class="sp-row-main sp-grid">
          <div class="sp-serial">
            <button
              type="button"
              class="sp-serial-button"
              aria-haspopup="dialog"
              :title="group.task.serial_no"
              @click="openRoute(group.task)"
            >
              {{ group.task.serial_no }}
            </button>
            <button
              v-if="
                group.task.route_changed || group.task.reworks?.some((r) => r.state !== 'processed')
              "
              class="sp-route-alert"
              type="button"
              @click="emit('open-task', group.task)"
            >
              {{ group.task.route_changed ? '工艺有更新' : '有返工待处理' }}
            </button>
          </div>
          <div class="sp-target" :title="target(group.task)">{{ target(group.task) }}</div>
          <div
            class="sp-track"
            :style="{
              minHeight: `${group.height}px`,
            }"
            aria-label="班组要求转出时间"
          >
            <span
              v-if="todayPosition >= 0 && todayPosition <= 100"
              class="sp-now-line"
              :style="{ left: `${todayPosition}%` }"
            />
            <ElTooltip
              v-for="edge in (['before', 'after'] as const).filter((edge) => group[edge].length)"
              :key="edge"
              :content="`${edge === 'before' ? '左侧' : '右侧'}还有 ${group[edge].length} 道工序`"
            >
              <button
                type="button"
                class="sp-edge"
                :class="`is-${edge}`"
                :aria-label="`定位范围${edge === 'before' ? '前' : '后'}的 ${group[edge].length} 道工序`"
                @click="locate(group[edge][0]!)"
              >
                <ElIcon><ArrowLeft v-if="edge === 'before'" /><ArrowRight v-else /></ElIcon
                ><span>{{ group[edge].length }}</span>
              </button>
            </ElTooltip>
            <svg
              class="sp-links"
              :viewBox="`0 0 ${width} ${group.height}`"
              :style="{ height: `${group.height}px` }"
              aria-hidden="true"
            >
              <defs>
                <marker
                  :id="`route-arrow-${group.task.id}`"
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M0 0 L6 3 L0 6" fill="#a3b2ab" stroke="none" />
                </marker>
              </defs>
              <path
                v-for="link in group.links"
                :key="link.id"
                :d="link.path"
                :marker-end="`url(#route-arrow-${group.task.id})`"
                :class="{
                  'is-done': link.done,
                  'is-related': link.id === group.active || link.fromId === group.active,
                }"
              />
            </svg>
            <ElTooltip
              v-for="marker in group.markers"
              :key="marker.node.id"
              :trigger="['hover', 'focus']"
              :show-after="350"
              :hide-after="0"
              placement="top"
              effect="light"
              popper-class="schedule-node-tooltip"
            >
              <template #content>
                <div class="sp-node-info" :style="scheduleTeamStyle(marker.node.team_name)">
                  <header>
                    <strong>{{ marker.node.sequence_no }} · {{ marker.node.team_name }}</strong
                    ><span :class="`is-${state(marker.node)}`">{{ label(marker.node) }}</span>
                  </header>
                  <dl>
                    <dt>交期</dt>
                    <dd>{{ formatDateTime(marker.node.due_at) }}</dd>
                    <dt>计划</dt>
                    <dd>{{ nodeTarget(marker.node) }}</dd>
                    <template
                      v-if="isAssessed(marker.node) && marker.node.processed_quantity != null"
                    >
                      <dt>已加工</dt>
                      <dd>
                        {{ formatAmount(marker.node.processed_quantity) }} 件
                        <small v-if="marker.completion.processed != null"
                          >{{ Math.round(marker.completion.processed) }}%</small
                        >
                      </dd>
                    </template>
                    <dt>已转出</dt>
                    <dd>
                      {{ nodeActual(marker.node) }}
                      <small v-if="marker.completion.dispatched != null"
                        >{{ Math.round(marker.completion.dispatched) }}%</small
                      >
                    </dd>
                    <template v-if="marker.node.stock">
                      <dt>在库</dt>
                      <dd>
                        {{
                          amounts(
                            marker.node.stock.on_hand_quantity,
                            marker.node.stock.on_hand_weight,
                          )
                        }}
                      </dd>
                      <template
                        v-if="
                          marker.node.stock.pending_quantity || marker.node.stock.pending_weight
                        "
                      >
                        <dt>待签收</dt>
                        <dd>
                          {{
                            amounts(
                              marker.node.stock.pending_quantity,
                              marker.node.stock.pending_weight,
                            )
                          }}
                        </dd>
                      </template>
                    </template>
                    <dt>去向</dt>
                    <dd>
                      {{ marker.node.next_team_name || marker.node.external_destination || '—' }}
                    </dd>
                  </dl>
                </div>
              </template>
              <button
                type="button"
                class="sp-node"
                :class="[
                  `is-${state(marker.node)}`,
                  {
                    'is-today': marker.node.status === 'today',
                    'is-related': group.related.has(marker.node.id),
                    'is-active': group.active === marker.node.id,
                    'has-stock':
                      (marker.node.stock?.on_hand_quantity ||
                        marker.node.stock?.on_hand_weight ||
                        0) > 0,
                  },
                ]"
                :style="{
                  ...scheduleTeamStyle(marker.node.team_name),
                  left: `${(marker.x / width) * 100}%`,
                  top: `${marker.top}px`,
                  '--label-offset': `${marker.labelOffset}px`,
                  '--anchor-offset': `${-marker.labelOffset}px`,
                }"
                :aria-label="markerTitle(group.task, marker.node)"
                aria-haspopup="dialog"
                @mouseenter="hoveredNode = { taskId: group.task.id, nodeId: marker.node.id }"
                @mouseleave="hoveredNode = null"
                @focus="focusedNode = { taskId: group.task.id, nodeId: marker.node.id }"
                @blur="focusedNode = null"
                @click="emit('open-node', marker.node)"
              >
                <i class="sp-node-anchor" aria-hidden="true" />
                <span class="sp-team">
                  <i
                    v-if="
                      (marker.node.stock?.on_hand_quantity ||
                        marker.node.stock?.on_hand_weight ||
                        0) > 0
                    "
                    class="sp-stock-dot"
                    aria-label="有在库物料"
                  />
                  <strong class="sp-team-name">{{ marker.node.team_name }}</strong>
                  <time :datetime="marker.node.due_at">{{
                    formatDateTime(marker.node.due_at).slice(11)
                  }}</time>
                </span>
                <span
                  v-if="
                    isDelivered(marker.node) ||
                    marker.node.quality_held ||
                    ['overdue', 'today', 'cancelled'].includes(marker.node.status)
                  "
                  class="sp-node-state"
                  :aria-label="label(marker.node)"
                >
                  <ElIcon v-if="marker.node.status === 'cancelled'"><VideoPause /></ElIcon>
                  <ElIcon v-else-if="isDelivered(marker.node)"><Check /></ElIcon>
                  <ElIcon v-else-if="marker.node.quality_held"><Lock /></ElIcon>
                  <ElIcon v-else-if="marker.node.status === 'overdue'"><Warning /></ElIcon>
                  <ElIcon v-else><Clock /></ElIcon>
                </span>
              </button>
            </ElTooltip>
          </div>
        </div>
      </article>
    </div>
    <AppDialog
      :model-value="!!routeTask"
      :title="routeTask ? `${routeTask.serial_no} · 流水号详情` : '流水号详情'"
      width="min(1320px, 96vw)"
      append-to-body
      destroy-on-close
      @close="routeTaskId = null"
    >
      <section
        v-if="routeTask"
        class="sp-detail"
        :aria-label="`${routeTask.serial_no} ${routeTask.title}详细路线`"
      >
        <div class="sp-detail-head">
          <span class="sp-detail-number">{{ routeTask.task_no }}</span>
          <div class="sp-detail-actions">
            <ElButton size="small" :icon="Aim" class="sp-locate" @click="locateTask(routeTask)"
              >定位交期</ElButton
            >
            <ElButton size="small" class="sp-task-details" @click="emit('open-task', routeTask)"
              >任务详情</ElButton
            >
          </div>
        </div>
        <div class="sp-detail-fields">
          <table aria-label="交货任务信息">
            <tbody>
              <tr>
                <th scope="row">交货任务</th>
                <td>{{ routeTask.title }}</td>
                <th scope="row">计划交货量</th>
                <td>{{ target(routeTask) }}</td>
                <th scope="row">业务人员</th>
                <td>{{ routeTask.business_person_name || '未指定' }}</td>
              </tr>
              <tr>
                <th scope="row">最终交期</th>
                <td>
                  <time :datetime="routeTask.final_due_at">{{
                    formatDateTime(routeTask.final_due_at)
                  }}</time>
                </td>
                <th scope="row">交货状态</th>
                <td>
                  <ElTooltip
                    :content="deadlineRemaining(routeTask, now)"
                    :disabled="!deadlineRemaining(routeTask, now)"
                  >
                    <span v-if="routeRisk" class="sp-risk" :class="`is-${routeRisk.tone}`"
                      ><ElIcon>
                        <VideoPause v-if="routeRisk.tone === 'hold'" />
                        <Warning v-else-if="['watch', 'late'].includes(routeRisk.tone)" />
                        <CircleCheck v-else-if="routeRisk.tone === 'done'" />
                        <Clock v-else /> </ElIcon
                      >{{ routeRisk.label }}</span
                    >
                  </ElTooltip>
                </td>
                <th scope="row">物料所在班组</th>
                <td class="sp-detail-stock">
                  <ScheduleStockSummary v-if="routeTask.locations?.length" :task="routeTask" />
                  <ElTooltip
                    v-else-if="['completed', 'completed_late'].includes(routeTask.status)"
                    :content="completedAmount(routeTask)"
                  >
                    <span class="sp-stock-empty is-done"
                      ><ElIcon><Check /></ElIcon>已交完</span
                    >
                  </ElTooltip>
                  <span v-else class="sp-stock-empty">暂无物料</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="routeTask.notes" class="sp-detail-reason">{{ routeTask.notes }}</p>
        <div
          class="sp-detail-timeline"
          :style="{ height: `min(${176 + routeTask.nodes.length * SCHEDULE_ROW_HEIGHT}px, 60dvh)` }"
        >
          <ProductionScheduleGantt
            :tasks="[routeTask]"
            @open-node="emit('open-node', $event)"
            @open-task="emit('open-task', $event)"
          />
        </div>
      </section>
      <template #footer>
        <ElButton @click="routeTaskId = null">关闭</ElButton>
      </template>
    </AppDialog>
    <footer class="sp-bottom">
      <div v-if="teamLegend.length" class="sp-team-legend" aria-label="班组颜色">
        <span
          v-for="node in teamLegend"
          :key="node.team_id"
          :style="scheduleTeamStyle(node.team_name)"
          ><i />{{ node.team_name }}</span
        >
      </div>
      <div class="sp-legend">
        <span
          ><ElIcon><Check /></ElIcon>已交完</span
        >
        <span><i class="sp-legend-current" />物料在此</span>
        <span
          ><ElIcon><Warning /></ElIcon>逾期</span
        >
        <span
          ><ElIcon><Lock /></ElIcon>暂扣</span
        >
      </div>
    </footer>
  </section>
</template>

<style scoped>
.sp-route-alert {
  border: 0;
  background: transparent;
  color: #8a601e;
  font-size: 12px;
  padding: 2px 0;
  cursor: pointer;
}
.schedule-progress {
  --sp-green: var(--primary);
  --sp-muted: #69716d;
  --sp-line: #e4e6e5;
  --sp-red: #b93434;
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  color: #171b18;
  background: white;
  font-size: 14px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.schedule-progress * {
  box-sizing: border-box;
}
.schedule-progress button {
  font: inherit;
  cursor: pointer;
}
.schedule-progress button:focus-visible,
.sp-detail button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.sp-weekbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--sp-line);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: #fff;
}
.sp-week-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sp-zoom {
  display: flex;
  align-items: center;
  padding: 2px;
  margin-right: 6px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #f7faf8;
}
.schedule-progress .sp-zoom button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
}
.sp-zoom > span {
  padding: 0 6px;
  color: var(--muted);
  font-size: 12px;
}
.schedule-progress .sp-zoom .sp-zoom-reset {
  width: 44px;
}
.sp-zoom button:hover:not(:disabled) {
  background: white;
  box-shadow: 0 1px 4px #173a2212;
}
.sp-zoom button:disabled {
  opacity: 0.3;
  cursor: default;
}
.sp-range {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.schedule-progress .sp-subtle-button,
.schedule-progress .sp-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid #e2e9e4;
  border-radius: 8px;
  background: white;
  color: var(--text);
  padding: 5px 8px;
  font-size: 12px;
  min-height: 30px;
}
.sp-subtle-button:hover,
.sp-icon-button:hover {
  background: #eef6f1;
}
.sp-scroll {
  overflow: auto;
  flex: 0 1 auto;
  min-height: 0;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  scrollbar-color: #b6c6be #f5f7f6;
}
.sp-grid {
  display: grid;
  grid-template-columns: 170px 90px var(--timeline-width);
  width: var(--grid-width);
}
.sp-team-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  align-items: center;
  margin-right: auto;
  font-size: 12px;
  color: var(--sp-muted);
}
.sp-team-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sp-team-legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--team-color);
}
.sp-calendar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sp-calendar-bands {
  display: flex;
  height: 24px;
  border-bottom: 1px solid #e4e6e5;
  background: #fff;
  color: #303d36;
  font-size: 12px;
  font-weight: 600;
}
.sp-calendar-bands span {
  min-width: 0;
  padding: 4px 12px;
  border-right: 1px solid #e4e6e5;
  white-space: nowrap;
  overflow: clip;
}
.sp-calendar-bands b {
  position: sticky;
  left: calc(var(--frozen-width) + 12px);
  font-weight: 600;
}
.sp-calendar .sp-days {
  flex: 1;
  min-height: 30px;
}
.sp-scroll {
  border: 1px solid #d9ddda;
  border-radius: 0 0 6px 6px;
  background: white;
  box-shadow: 0 2px 5px #23473605;
}
.sp-row:nth-of-type(even) :is(.sp-row-main, .sp-serial, .sp-target) {
  background-color: #fafafa;
}
.sp-row:is(:hover, :focus-within) :is(.sp-row-main, .sp-serial, .sp-target) {
  background-color: #f0f6f5;
}
.sp-table-head {
  position: sticky;
  top: 0;
  z-index: 3;
  border-bottom: 1px solid #cfd4d1;
  background: #fff;
  align-items: stretch;
  color: #232824;
  font-size: 13px;
  font-weight: 600;
  min-height: 48px;
}
.sp-table-head > span {
  display: flex;
  align-items: center;
  background: #fff;
  border-right: 1px solid var(--sp-line);
}
.sp-head-serial {
  padding-left: 12px;
}
.sp-days {
  display: grid;
  grid-template-columns: repeat(var(--day-count), minmax(0, 1fr));
  min-height: 48px;
}
.sp-day {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-right: 1px solid var(--sp-line);
}
.sp-day b {
  font-size: 12px;
  font-weight: 600;
}
.sp-day small {
  white-space: nowrap;
  font-size: 12px;
  color: var(--sp-muted);
  font-weight: 400;
}
.sp-day.is-weekend {
  background: #fcf5f5;
}
.sp-day.is-today {
  color: var(--primary);
  background: #edf6f1;
  box-shadow: inset 0 -2px 0 var(--primary);
}
.sp-day.is-today small {
  color: var(--primary);
}
.sp-hours,
.sp-hour-day {
  display: grid;
  grid-template-columns: repeat(var(--day-count), minmax(0, 1fr));
}
.sp-hours {
  border-top: 1px solid var(--sp-line);
  background: #fff;
}
.sp-hour-day {
  grid-template-columns: repeat(var(--hour-count), minmax(0, 1fr));
  border-right: 1px solid #cfdad3;
}
.sp-hour-day span {
  padding: 2px 5px;
  border-left: 1px solid #e6ebe7;
  color: #68766e;
  font-size: 10px;
  font-weight: 400;
}
.sp-now-head {
  position: absolute;
  bottom: 0;
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-bottom: 0;
  border-top-color: #40876a;
  transform: translateX(-50%);
}
.sp-node-info {
  min-width: 220px;
  color: #25332b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sp-node-info header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 9px;
  border-bottom: 1px solid #e0e7e2;
}
.sp-node-info header strong {
  padding-left: 8px;
  border-left: 3px solid var(--team-color);
  font-size: 14px;
}
.sp-node-info header span {
  color: #63706c;
}
.sp-node-info header .is-late,
.sp-node-info header .is-hold {
  color: #b93434;
}
.sp-node-info dl {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 6px 16px;
  margin: 10px 0 0;
}
.sp-node-info dt {
  color: #63706c;
}
.sp-node-info dd small {
  margin-left: 8px;
  color: #64736c;
  font-size: 11px;
}
.sp-node-info dd {
  margin: 0;
  text-align: right;
}
.sp-row {
  width: var(--grid-width);
  border-bottom: 1px solid var(--sp-line);
}
.sp-row-main {
  align-items: stretch;
  min-height: var(--lane-height);
  transition: background var(--motion-fast);
}
.sp-serial,
.sp-head-serial,
.sp-target,
.sp-head-target {
  position: sticky;
  left: 0;
  z-index: 1;
  background: white;
  border-right: 1px solid var(--line);
}
.sp-serial,
.sp-target {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: 4px 12px;
  gap: 2px;
}
.sp-target,
.sp-head-target {
  left: 170px;
  align-items: center;
  justify-content: center;
  box-shadow: 3px 0 4px #24463308;
  border-right-color: #bacbc1;
}
.schedule-progress .sp-serial-button {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: 14px;
  font-weight: 600;
  color: #171b18;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-target {
  display: block;
  align-content: center;
  padding-inline: 12px;
  text-align: right;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #252a27;
}
.sp-serial-button:hover {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.sp-track {
  position: relative;
  isolation: isolate;
  min-width: 0;
  min-height: var(--lane-height);
  background-image:
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(100% / var(--day-count) - 1px),
      #dfe6e2 calc(100% / var(--day-count) - 1px),
      #dfe6e2 calc(100% / var(--day-count))
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(100% / var(--day-count) / var(--hour-count) - 1px),
      #e9eeeb calc(100% / var(--day-count) / var(--hour-count) - 1px),
      #e9eeeb calc(100% / var(--day-count) / var(--hour-count))
    ),
    var(--weekend-shading);
}
.sp-now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  z-index: 1;
  background: #40876a;
  pointer-events: none;
}
.sp-links {
  position: absolute;
  inset: 0;
  width: 100%;
  overflow: visible;
  pointer-events: none;
}
.sp-links > path {
  stroke: #bdcbc3;
  stroke-width: 1.3;
  fill: none;
  transition:
    stroke 160ms,
    stroke-width 160ms;
}
.sp-links > path.is-done {
  stroke: #7aa28a;
}
.sp-links > path.is-related {
  stroke: #3c6b5b;
  stroke-width: 2;
}
.schedule-progress .sp-node {
  position: absolute;
  width: var(--card-width);
  height: 32px;
  transform: translateX(var(--label-offset));
  padding: 0;
  display: flex;
  align-items: center;
  border: 0;
  border-left: 3px solid var(--team-color);
  border-radius: 4px;
  background: color-mix(in srgb, var(--team-color) 12%, white);
  color: #24332d;
  z-index: 2;
  text-align: left;
  transition:
    background-color 160ms,
    color 160ms,
    box-shadow 160ms,
    transform 160ms;
}
.sp-edge {
  position: sticky;
  margin-top: 16px;
  z-index: 3;
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 3px 4px;
  border: 1px solid #d6e2db;
  border-radius: 4px;
  background: #fff;
  color: var(--primary);
  font-size: 10px;
}
.sp-edge.is-before {
  float: left;
  left: calc(var(--frozen-width) + 4px);
}
.sp-edge.is-after {
  float: right;
  right: 4px;
}
.sp-edge:hover {
  background: #edf6f1;
}
.sp-node-anchor {
  position: absolute;
  top: -4px;
  left: calc(var(--anchor-offset) - 3px);
  width: 1px;
  height: 4px;
  background: var(--team-color);
}
.sp-team {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0 7px 0 5px;
}
.sp-team-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.sp-node time {
  margin-left: auto;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}
.schedule-progress .sp-node.is-related {
  background: color-mix(in srgb, var(--team-color) 24%, white);
}
.schedule-progress .sp-node.has-stock,
.schedule-progress .sp-node.is-active {
  background: var(--team-color);
  color: white;
}
.schedule-progress .sp-node.is-active {
  box-shadow: 0 3px 8px #172a2326;
  transform: translate(var(--label-offset), -1px);
  z-index: 3;
}
.sp-stock-dot {
  flex: 0 0 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
.sp-node-state {
  position: absolute;
  top: -5px;
  right: -4px;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #edf5f0;
  color: #32664f;
  box-shadow: 0 0 0 2px white;
  font-size: 11px;
}
.sp-node.is-late .sp-node-state,
.sp-node.is-hold .sp-node-state {
  background: #c43f3f;
  color: white;
}
.sp-node.is-today:not(.is-hold) .sp-node-state {
  background: #f9e7bb;
  color: #785209;
}
.schedule-progress .sp-node.is-transit {
  border-left-style: dashed;
}
.schedule-progress .sp-node.is-cancelled {
  background: #f1f2f2;
  color: #737b77;
  border-left-color: #9ba59f;
}
.sp-node.is-cancelled .sp-node-state {
  background: #e5e8e6;
  color: #59615d;
}
.sp-stock-empty {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--sp-muted);
  font-size: 12px;
}
.sp-stock-empty.is-done {
  color: var(--primary);
}
.sp-detail .sp-risk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  border: 1px solid #d4e4da;
  border-radius: 5px;
  font-size: 11px;
  color: #31634c;
  background: #f0f7f3;
  line-height: 18px;
  white-space: nowrap;
}
.sp-detail .sp-risk:hover {
  filter: brightness(0.97);
}
.sp-detail .sp-risk.is-watch {
  color: #946018;
  border-color: #e9d8b9;
  background: #fff7e9;
}
.sp-detail .sp-risk.is-hold,
.sp-detail .sp-risk.is-late {
  color: #ad2929;
  border-color: #ecd1cd;
  background: #fff1ef;
}
.sp-detail .sp-risk.is-muted {
  color: var(--muted);
  border-color: var(--line);
  background: #f5f7f6;
}
.sp-detail {
  --sp-red: #ba5050;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.sp-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.sp-detail-number {
  color: var(--muted);
  font-size: 12px;
}
.sp-detail-actions {
  display: flex;
  gap: 8px;
}
.sp-detail-actions .el-button + .el-button {
  margin-left: 0;
}
.sp-detail-fields {
  margin-bottom: 16px;
  overflow-x: auto;
}
.sp-detail-fields table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 13px;
}
.sp-detail-fields th,
.sp-detail-fields td {
  border: 1px solid #dde3e0;
  padding: 10px 12px;
  text-align: left;
}
.sp-detail-fields th {
  width: 100px;
  white-space: nowrap;
  background: #f5f7f6;
  color: #53625a;
  font-weight: 500;
}
.sp-detail-fields td {
  background: white;
  color: #181c1a;
}
.sp-detail-fields time {
  white-space: nowrap;
}
.sp-detail-reason {
  font-size: 13px;
  line-height: 1.7;
  padding: 0 0 12px;
  color: #496454;
}
.sp-detail-timeline {
  display: flex;
  min-width: 0;
}
.sp-bottom {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 2px 0;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
}
.sp-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
}
.sp-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sp-legend > span > i:not(.el-icon) {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid #bdcbbf;
}
.sp-legend-current {
  background: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px #e1eee5;
}
.sp-empty {
  padding: 70px 16px;
  color: var(--muted);
  text-align: center;
}
@container (max-width:900px) {
  .sp-grid {
    grid-template-columns: 140px 80px var(--timeline-width);
  }
  .sp-target,
  .sp-head-target {
    left: 140px;
  }
  .sp-serial {
    padding-inline: 10px;
  }
}
@container (max-width:480px) {
  .sp-weekbar {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .schedule-progress * {
    transition: none !important;
  }
}
</style>

<style>
.el-popper.schedule-node-tooltip {
  padding: 12px 14px;
  border: 1px solid #d2ded6;
  border-radius: 7px;
  background: #ffffff;
  box-shadow: 0 8px 24px #19332720;
}
</style>

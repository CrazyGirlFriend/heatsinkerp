<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ElButton, ElTooltip } from 'element-plus'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import StatePanel from './StatePanel.vue'
import {
  completionBasisLabels,
  scheduleExecutionLabels,
  scheduleStatusLabels,
  type ProductionSchedule,
  type ScheduleTask,
} from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import {
  scheduleAxis,
  scheduleLanes,
  scheduleTimestamp,
  SCHEDULE_ROW_HEIGHT,
  SCHEDULE_PLAN_Y,
  SCHEDULE_ACTUAL_Y,
  type ScheduleZoom,
} from '@/utils/scheduleTimeline'

const props = defineProps<{ tasks: ScheduleTask[]; loading?: boolean }>()
const emit = defineEmits<{
  'open-node': [node: ProductionSchedule]
  'open-task': [task: ScheduleTask]
}>()
const viewport = ref<HTMLElement>()
const canvas = ref<HTMLElement>()
const scrollHints = ref({ horizontal: '', vertical: '' })
const zoom = ref<ScheduleZoom>('week')
const now = ref(Date.now())
const anchor = ref(now.value)
const labelWidth = 224
const dependencyArrowId = useId()
const hoveredNode = ref<number | null>(null)
const focusedNode = ref<number | null>(null)
const isActiveNode = (id: number) => hoveredNode.value === id || focusedNode.value === id
function leaveNodeFocus(event: FocusEvent) {
  if (
    !(event.relatedTarget instanceof Node) ||
    !(event.currentTarget as HTMLElement).contains(event.relatedTarget)
  )
    focusedNode.value = null
}
const axis = computed(() => scheduleAxis(now.value, zoom.value, anchor.value))
const groups = computed(() =>
  props.tasks.map((task) => ({ task, ...scheduleLanes(task.nodes, axis.value) })),
)
const canvasStyle = computed(() => ({
  width: `${labelWidth + axis.value.width}px`,
  '--label-width': `${labelWidth}px`,
  '--chart-width': `${axis.value.width}px`,
  '--day-width': `${axis.value.dayWidth}px`,
  '--tick-width': `${axis.value.pixelsPerHour * (zoom.value === 'day' ? 6 : 24)}px`,
  '--row-height': `${SCHEDULE_ROW_HEIGHT}px`,
  '--planned-y': `${SCHEDULE_PLAN_Y}px`,
  '--actual-y': `${SCHEDULE_ACTUAL_Y}px`,
  '--now-position': `${axis.value.position(now.value)}px`,
}))
const executionLabel = (node: ProductionSchedule) =>
  node.execution_state ? scheduleExecutionLabels[node.execution_state] : ''
function milestoneLabel(node: ProductionSchedule, actual = false) {
  const lines = [
    `${node.team_name} → ${node.next_team_name || node.external_destination || '未指定去向'}`,
    `要求交货 ${formatDateTime(node.due_at)}`,
  ]
  if (actual) lines.push(`实际交完 ${formatDateTime(node.completed_at)}`)
  lines.push(scheduleStatusLabels[node.status])
  const basis = node.completion_basis || (node.target_quantity != null ? 'quantity' : 'weight')
  if (node.target_quantity != null)
    lines.push(
      `${basis === 'weight' ? '参考件数：' : ''}已交 ${formatAmount(node.dispatched_quantity)} / 目标 ${formatAmount(node.target_quantity)} 件`,
    )
  if (node.target_weight != null)
    lines.push(
      `${basis === 'quantity' ? '参考重量：' : ''}已交 ${formatAmount(node.dispatched_weight)} / 目标 ${formatAmount(node.target_weight)} kg`,
    )
  lines.push(`完成口径：${completionBasisLabels[basis]}`)
  if (node.execution_state) lines.push(executionLabel(node))
  if (node.quality_held) lines.push('质量暂扣，暂不可转出')
  return lines.join('\n')
}
const shortDate = (value: string) => formatDateTime(value).slice(5)
const inWindow = (x: number | null) => x != null && x >= 0 && x <= axis.value.width
const markerPosition = (x: number) =>
  inWindow(x) ? x : Math.max(18, Math.min(x, axis.value.width - 18))
async function locate(timestamp: number) {
  anchor.value = timestamp
  await nextTick()
  positionAt(timestamp)
}
function locateTask(task: ScheduleTask) {
  const dates = task.nodes
    .map((node) => scheduleTimestamp(node.due_at))
    .filter((date): date is number => date != null)
  const closest = dates.sort((a, b) => Math.abs(a - now.value) - Math.abs(b - now.value))[0]
  if (closest != null) void locate(closest)
}
function selectMilestone(node: ProductionSchedule, x: number, actual = false) {
  if (inWindow(x)) emit('open-node', node)
  else {
    const timestamp = scheduleTimestamp(actual ? node.completed_at : node.due_at)
    if (timestamp != null) void locate(timestamp)
  }
}
function positionAt(timestamp: number) {
  const element = viewport.value
  if (!element) return
  const visibleWidth = Math.max(0, element.clientWidth - labelWidth)
  const left = Math.max(0, axis.value.position(timestamp) - visibleWidth / 2)
  element.scrollLeft = left
  updateScrollHints()
}
function updateScrollHints() {
  const element = viewport.value
  if (!element) return
  const horizontalOverflow = element.scrollWidth - element.clientWidth > 1
  const verticalOverflow = element.scrollHeight - element.clientHeight > 1
  const left = horizontalOverflow && element.scrollLeft > 1
  const right =
    horizontalOverflow && element.scrollWidth - element.clientWidth - element.scrollLeft > 1
  const above = verticalOverflow && element.scrollTop > 1
  const below =
    verticalOverflow && element.scrollHeight - element.clientHeight - element.scrollTop > 1
  scrollHints.value = {
    horizontal:
      left && right ? '← 更多日期 →' : left ? '← 前面还有日期' : right ? '后面还有日期 →' : '',
    vertical:
      above && below ? '↑ 更多节点 ↓' : above ? '↑ 上方还有节点' : below ? '下方还有节点 ↓' : '',
  }
}
async function changeZoom(value: ScheduleZoom) {
  if (zoom.value === value) return
  const element = viewport.value
  const center = element
    ? element.scrollLeft + Math.max(0, element.clientWidth - labelWidth) / 2
    : axis.value.position(now.value)
  const timestamp = axis.value.start + (center / axis.value.pixelsPerHour) * 3_600_000
  anchor.value = timestamp
  zoom.value = value
  await nextTick()
  positionAt(timestamp)
}
function locateToday() {
  now.value = Date.now()
  void locate(now.value)
}
function shiftWindow(direction: number) {
  void locate(anchor.value + direction * (zoom.value === 'day' ? 3 : 14) * 86_400_000)
}
function refreshNow() {
  if (!document.hidden) now.value = Date.now()
}
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(refreshNow, 60_000)
  document.addEventListener('visibilitychange', refreshNow)
})
onBeforeUnmount(() => {
  clearInterval(clock)
  document.removeEventListener('visibilitychange', refreshNow)
})
watch(
  [viewport, canvas],
  ([element, content], _, onCleanup) => {
    if (!element || !content) return
    updateScrollHints()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateScrollHints)
    observer.observe(element)
    observer.observe(content)
    onCleanup(() => observer.disconnect())
  },
  { flush: 'post' },
)
watch(
  () => props.tasks.map((task) => task.id).join(','),
  async () => {
    hoveredNode.value = null
    focusedNode.value = null
    await nextTick()
    if (props.tasks[0]) locateTask(props.tasks[0])
  },
  { immediate: true },
)
</script>

<template>
  <section
    class="schedule-gantt"
    aria-label="任务交货里程碑甘特图"
    :aria-busy="loading || undefined"
  >
    <header class="gantt-toolbar">
      <div class="gantt-caption">
        <strong>交货时间轴</strong
        ><span
          >{{ formatDateTime(new Date(axis.start).toISOString()).slice(0, 10) }} —
          {{ formatDateTime(new Date(axis.end - 1).toISOString()).slice(0, 10) }} · 北京时间</span
        >
      </div>
      <div class="gantt-controls">
        <div class="gantt-scale" role="group" aria-label="时间刻度">
          <button type="button" :aria-pressed="zoom === 'day'" @click="changeZoom('day')">
            小时
          </button>
          <button type="button" :aria-pressed="zoom === 'week'" @click="changeZoom('week')">
            日期
          </button>
        </div>
        <ElButton size="small" :icon="ArrowLeft" aria-label="前一时间段" @click="shiftWindow(-1)" />
        <ElButton size="small" @click="locateToday">定位今天</ElButton>
        <ElButton size="small" :icon="ArrowRight" aria-label="后一时间段" @click="shiftWindow(1)" />
      </div>
    </header>
    <StatePanel v-if="loading && !tasks.length" state="loading" compact title="正在读取交货排期" />
    <StatePanel
      v-else-if="!tasks.length"
      state="empty"
      compact
      title="暂无交货任务"
      description="设置班组交货节点后，在这里查看各任务的交货安排。"
    />
    <template v-else>
      <div
        ref="viewport"
        class="gantt-viewport"
        tabindex="0"
        role="region"
        aria-label="可横向滚动的交货时间轴，使用方向键滚动"
        @scroll.passive="updateScrollHints"
      >
        <div ref="canvas" class="gantt-canvas" :style="canvasStyle">
          <div class="gantt-axis">
            <div class="gantt-corner">任务 / 班组交货节点</div>
            <div class="gantt-axis-track">
              <div
                v-for="day in axis.days"
                :key="day.timestamp"
                class="gantt-day"
                :class="{ 'is-today': day.today, 'is-weekend': day.weekend }"
                :style="{ left: `${day.x}px` }"
              >
                <div class="gantt-day-caption">
                  <span>{{ day.label }}<b v-if="day.today">今天</b></span>
                  <small v-if="zoom !== 'day'">{{
                    new Date(day.timestamp).toLocaleDateString('zh-CN', {
                      weekday: 'short',
                      timeZone: 'Asia/Shanghai',
                    })
                  }}</small>
                </div>
                <div v-if="zoom === 'day'" class="gantt-hours">
                  <span v-for="hour in ['00', '06', '12', '18']" :key="hour">{{ hour }}:00</span>
                </div>
              </div>
              <span
                v-if="inWindow(axis.position(now))"
                class="gantt-now-cap"
                :title="formatDateTime(new Date(now).toISOString())"
                >现在</span
              >
            </div>
          </div>
          <section
            v-for="group in groups"
            :key="group.task.id"
            class="gantt-task"
            :aria-label="`${group.task.task_no} ${group.task.title}`"
          >
            <div class="gantt-task-heading">
              <div class="gantt-task-label">
                <button
                  type="button"
                  class="gantt-task-open"
                  @click="emit('open-task', group.task)"
                >
                  <strong :title="group.task.title">{{ group.task.title }}</strong
                  ><span>{{ group.task.task_no }}</span></button
                ><button
                  v-if="group.rows.length"
                  type="button"
                  class="gantt-task-locate"
                  :aria-label="`定位任务 ${group.task.task_no}`"
                  @click="locateTask(group.task)"
                >
                  定位
                </button>
              </div>
              <div class="gantt-task-meta">
                <div class="gantt-task-meta-content">
                  <span class="gantt-task-serial"
                    >流水号
                    <strong :title="group.task.serial_no">{{ group.task.serial_no }}</strong></span
                  ><span>{{ group.rows.length }} 个交货节点</span>
                  <span v-if="group.task.final_due_at" class="gantt-task-due"
                    >最终交期
                    <time :datetime="group.task.final_due_at">{{
                      formatDateTime(group.task.final_due_at)
                    }}</time></span
                  >
                </div>
              </div>
            </div>
            <div v-if="!group.rows.length" class="gantt-empty-task">
              <span>尚未设置交货节点</span>
            </div>
            <div v-else class="gantt-node-group">
              <svg
                class="gantt-dependencies"
                :width="axis.width"
                :height="group.rows.length * SCHEDULE_ROW_HEIGHT"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    v-for="link in group.links"
                    :id="`${dependencyArrowId}-${group.task.id}-${link.id}`"
                    :key="link.id"
                    :class="[`status-${link.status}`, { 'is-cancelled': link.cancelled }]"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M 1 1 L 5 3 L 1 5" />
                  </marker>
                </defs>
                <path
                  v-for="link in group.links"
                  :key="link.id"
                  :d="link.path"
                  :marker-end="`url(#${dependencyArrowId}-${group.task.id}-${link.id})`"
                  :class="[
                    `status-${link.status}`,
                    {
                      'is-cancelled': link.cancelled,
                      'is-highlighted': isActiveNode(link.sourceId) || isActiveNode(link.targetId),
                    },
                  ]"
                />
              </svg>
              <div
                v-for="(row, index) in group.rows"
                :key="row.node.id"
                class="gantt-node-row"
                :class="[
                  `status-${row.node.status}`,
                  {
                    'is-cancelled': row.node.status === 'cancelled',
                    'is-active': isActiveNode(row.node.id),
                  },
                ]"
                @mouseenter="hoveredNode = row.node.id"
                @mouseleave="hoveredNode = null"
                @focusin="focusedNode = row.node.id"
                @focusout="leaveNodeFocus"
              >
                <button
                  type="button"
                  class="gantt-node-label"
                  :aria-label="`${row.node.team_name}第${index + 1}节点，${scheduleStatusLabels[row.node.status]}，打开交货详情`"
                  @click="emit('open-node', row.node)"
                >
                  <span class="gantt-node-title"
                    ><i>{{ String(index + 1).padStart(2, '0') }}</i
                    ><strong>{{ row.node.team_name }}</strong
                    ><span v-if="row.node.quality_held" class="gantt-quality">暂扣</span></span
                  >
                  <span class="gantt-node-subtitle"
                    >{{ scheduleStatusLabels[row.node.status]
                    }}<span
                      v-if="
                        row.node.execution_state &&
                        row.node.execution_state !== 'completed' &&
                        row.node.execution_state !== 'cancelled'
                      "
                    >
                      · {{ executionLabel(row.node) }}</span
                    ></span
                  >
                </button>
                <div class="gantt-lane">
                  <span
                    v-if="inWindow(axis.position(now))"
                    class="gantt-now-line"
                    aria-hidden="true"
                  />
                  <span
                    v-if="
                      row.dueX != null &&
                      row.completedX != null &&
                      inWindow(row.dueX) &&
                      inWindow(row.completedX)
                    "
                    class="gantt-completion-gap"
                    aria-hidden="true"
                    :style="{
                      left: `${Math.min(row.dueX, row.completedX)}px`,
                      width: `${Math.abs(row.dueX - row.completedX)}px`,
                    }"
                  />
                  <ElTooltip
                    v-if="row.dueX != null"
                    placement="top"
                    effect="light"
                    :show-after="160"
                  >
                    <template #content
                      ><span class="gantt-tooltip">{{ milestoneLabel(row.node) }}</span></template
                    >
                    <button
                      type="button"
                      class="gantt-milestone gantt-planned"
                      :class="{
                        'label-before': row.dueX > axis.width - 145,
                        'is-outside': !inWindow(row.dueX),
                      }"
                      :style="{ left: `${markerPosition(row.dueX)}px` }"
                      :aria-label="`${inWindow(row.dueX) ? '计划节点' : '定位窗外交货节点'}，${milestoneLabel(row.node)}`"
                      @click="selectMilestone(row.node, row.dueX)"
                    >
                      <i aria-hidden="true" /><span
                        >{{ !inWindow(row.dueX) && row.dueX < 0 ? '← ' : ''
                        }}{{ shortDate(row.node.due_at)
                        }}{{ !inWindow(row.dueX) && row.dueX > 0 ? ' →' : '' }}</span
                      >
                    </button>
                  </ElTooltip>
                  <span v-else class="gantt-invalid-date">未设置有效交期</span>
                  <ElTooltip
                    v-if="row.completedX != null"
                    placement="bottom"
                    effect="light"
                    :show-after="160"
                  >
                    <template #content
                      ><span class="gantt-tooltip">{{
                        milestoneLabel(row.node, true)
                      }}</span></template
                    >
                    <button
                      type="button"
                      class="gantt-milestone gantt-actual"
                      :class="{
                        'label-before': row.completedX > axis.width - 145,
                        'is-outside': !inWindow(row.completedX),
                      }"
                      :style="{ left: `${markerPosition(row.completedX)}px` }"
                      :aria-label="`${inWindow(row.completedX) ? '真实交完' : '定位窗外实际交完时间'}，${milestoneLabel(row.node, true)}`"
                      @click="selectMilestone(row.node, row.completedX, true)"
                    >
                      <i aria-hidden="true" /><span
                        >{{ !inWindow(row.completedX) && row.completedX < 0 ? '← ' : '' }}实
                        {{ shortDate(row.node.completed_at!)
                        }}{{ !inWindow(row.completedX) && row.completedX > 0 ? ' →' : '' }}</span
                      >
                    </button>
                  </ElTooltip>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      <footer class="gantt-legend">
        <span><i class="legend-planned" />要求交货</span
        ><span><i class="legend-actual" />实际交完</span
        ><span><i class="legend-link" />前后序关系</span
        ><span v-if="scrollHints.horizontal || scrollHints.vertical" class="gantt-scroll-hints">
          <span v-if="scrollHints.horizontal">{{ scrollHints.horizontal }}</span>
          <span v-if="scrollHints.vertical">{{ scrollHints.vertical }}</span>
        </span>
        <span class="gantt-explanation">不表示加工时长 · 虚线为交期差异 · 点击窗外箭头定位</span>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.schedule-gantt {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--card-radius);
  background: var(--glass-surface);
  box-shadow: var(--glass-shadow);
  overflow: hidden;
}
.gantt-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
}
.gantt-caption,
.gantt-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.gantt-caption {
  flex-wrap: wrap;
  row-gap: 2px;
}
.gantt-controls {
  gap: 6px;
  flex-shrink: 0;
}
.gantt-controls .el-button + .el-button {
  margin-left: 0;
}
.gantt-caption strong {
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
}
.gantt-caption > span {
  color: var(--muted);
  font-size: 12px;
}
.gantt-scale {
  display: flex;
  padding: 3px;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.gantt-scale button {
  padding: 3px 15px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition:
    color var(--motion-fast),
    background var(--motion-fast),
    box-shadow var(--motion-fast);
}
.gantt-scale button[aria-pressed='true'] {
  color: var(--primary);
  background: var(--surface);
  box-shadow:
    0 1px 4px #203b2e15,
    inset 0 0 0 1px #205c4814;
}
.gantt-viewport {
  container-type: inline-size;
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #9aafa4 #f5f8f6;
  overscroll-behavior: contain;
  border-block: 1px solid var(--line);
}
.gantt-viewport::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.gantt-viewport::-webkit-scrollbar-track {
  background: #f5f8f6;
}
.gantt-viewport::-webkit-scrollbar-thumb {
  border: 2px solid #f5f8f6;
  border-radius: 8px;
  background: #9aafa4;
}
.gantt-canvas {
  min-width: 100%;
  font-variant-numeric: tabular-nums;
}
.gantt-axis,
.gantt-task-heading,
.gantt-node-row {
  display: grid;
  grid-template-columns: var(--label-width) var(--chart-width);
}
.gantt-axis {
  position: sticky;
  top: 0;
  z-index: 8;
  height: 60px;
  background: linear-gradient(180deg, #fffffffa, #f6faf8f5);
  backdrop-filter: blur(12px);
  box-shadow: 0 1px var(--line);
}
.gantt-corner,
.gantt-task-label,
.gantt-node-label {
  position: sticky;
  left: 0;
  z-index: 4;
  background: var(--surface);
  border: 0;
  border-right: 1px solid var(--line);
  text-align: left;
}
.gantt-corner {
  display: flex;
  align-items: center;
  padding: 0 18px;
  z-index: 9;
  font-size: 12px;
  color: var(--muted);
  background: #f7faf8;
}
.gantt-axis-track {
  position: relative;
}
.gantt-day {
  position: absolute;
  height: 60px;
  width: var(--day-width);
  border-left: 1px solid var(--line);
  padding-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
.gantt-day-caption {
  box-sizing: border-box;
  position: sticky;
  left: var(--label-width);
  width: max-content;
  max-width: 100%;
  padding-inline: 10px;
  white-space: nowrap;
}
.gantt-day small {
  display: block;
  margin-top: 4px;
  color: var(--subtle);
  font-size: 10px;
}
.gantt-day b {
  font-weight: 500;
  font-size: 10px;
  margin-left: 8px;
}
.gantt-day.is-today {
  background: linear-gradient(180deg, #e8f4efba, #f7fbf900);
  color: var(--primary);
}
.gantt-day.is-weekend:not(.is-today) {
  background: #edf2f44f;
}
.gantt-hours {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-top: 5px;
  font-size: 10px;
}
.gantt-hours > span {
  padding-left: 7px;
  border-left: 1px solid #b7c5ca7a;
}
.gantt-now-cap {
  position: absolute;
  bottom: 0;
  left: var(--now-position);
  transform: translateX(-50%);
  z-index: 2;
  color: #fff;
  background: var(--primary);
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  border-radius: 4px 4px 0 0;
}
.gantt-task-heading {
  height: 52px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(90deg, #edf6f1a1, #f9fbfa90);
}
.gantt-task-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 12px 6px 18px;
  color: var(--primary);
  background: #f2f8f5;
}
.gantt-task-open {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 0;
  background: transparent;
  color: inherit;
  border: 0;
  cursor: pointer;
}
.gantt-task-open strong {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}
.gantt-task-open > span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--muted);
}
.gantt-task-locate {
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  flex-shrink: 0;
  cursor: pointer;
}
.gantt-task-meta {
  min-width: 0;
}
.gantt-task-meta-content {
  box-sizing: border-box;
  position: sticky;
  left: var(--label-width);
  width: min(100%, calc(100cqi - var(--label-width)));
  height: 100%;
  display: flex;
  align-items: center;
  align-content: center;
  flex-wrap: wrap;
  gap: 2px 18px;
  padding: 4px 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
.gantt-task-serial {
  display: inline-flex;
  min-width: 0;
  max-width: 65%;
}
.gantt-task-serial strong {
  margin-left: 4px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gantt-task-due time {
  margin-left: 4px;
  color: var(--text);
  font-weight: 500;
}
.gantt-node-group {
  position: relative;
}
.gantt-dependencies {
  --link-color: #64796d;
  position: absolute;
  left: var(--label-width);
  top: 0;
  z-index: 2;
  pointer-events: none;
  overflow: visible;
}
.gantt-dependencies path {
  fill: none;
  stroke: var(--link-color);
  stroke-width: 1.4;
  stroke-opacity: 0.82;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition:
    stroke-opacity var(--motion-fast),
    stroke-width var(--motion-fast);
}
.gantt-dependencies .status-completed {
  --link-color: #2f7656;
}
.gantt-dependencies .status-today {
  --link-color: #a56b16;
}
.gantt-dependencies .status-overdue,
.gantt-dependencies .status-completed_late {
  --link-color: #b94747;
}
.gantt-dependencies > path.is-highlighted {
  stroke-width: 2;
  stroke-opacity: 1;
}
.gantt-dependencies .is-cancelled {
  --link-color: #9ba8a2;
}
.gantt-dependencies path.is-cancelled {
  stroke-dasharray: 3 4;
  stroke-opacity: 0.45;
}
.gantt-node-row {
  --milestone-color: #566a60;
  height: var(--row-height);
}
.gantt-node-row.status-completed {
  --milestone-color: #25734f;
}
.gantt-node-row.status-today {
  --milestone-color: #a56b16;
}
.gantt-node-row.status-overdue,
.gantt-node-row.status-completed_late {
  --milestone-color: #b94747;
}
.gantt-node-row.is-cancelled {
  --milestone-color: #849189;
}
.gantt-node-label {
  display: flex;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
  padding: 8px 18px;
  min-width: 0;
  cursor: pointer;
  border-bottom: 1px solid var(--line);
  transition: background var(--motion-fast);
}
.gantt-node-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  color: var(--text);
}
.gantt-node-title i {
  font-style: normal;
  color: var(--muted);
  font-size: 10px;
}
.gantt-node-title strong {
  font-weight: 500;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gantt-node-subtitle {
  color: var(--milestone-color);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 23px;
}
.gantt-quality {
  color: #b94747;
  font-size: 10px;
  flex-shrink: 0;
}
.gantt-task-label:hover {
  background: var(--table-hover-bg);
}
.gantt-lane {
  position: relative;
  border-bottom: 1px solid var(--line);
  transition: background-color var(--motion-fast);
  background: repeating-linear-gradient(
    90deg,
    #acbfc22b 0,
    #acbfc22b 1px,
    transparent 1px,
    transparent var(--tick-width)
  );
}
.gantt-node-row:nth-of-type(even) .gantt-lane {
  background-color: #f6faf82b;
}
.gantt-node-row:is(:hover, :focus-within, .is-active) .gantt-lane {
  background-color: #edf5f0b3;
}
.gantt-node-row:is(:hover, :focus-within, .is-active) .gantt-node-label {
  background: #edf5f0;
}
.gantt-now-line {
  position: absolute;
  left: var(--now-position);
  height: 100%;
  width: 1px;
  background: #205c4861;
  z-index: 2;
  pointer-events: none;
}
.gantt-milestone {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  width: 24px;
  height: 24px;
  margin-left: -12px;
  padding: 0;
  color: var(--milestone-color);
  border: 0;
  background: transparent;
  cursor: pointer;
}
.gantt-milestone i {
  position: absolute;
  left: 6px;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  background: #fff;
  box-shadow: 0 0 0 3px #ffffffbd;
  transition: box-shadow var(--motion-fast);
}
.gantt-planned {
  top: calc(var(--planned-y) - 12px);
}
.gantt-planned i {
  transform: rotate(45deg);
  border-radius: 2px;
}
.gantt-milestone > span {
  position: absolute;
  left: 25px;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  padding: 0 3px;
  background: #ffffffcf;
  border-radius: 3px;
}
.gantt-milestone.label-before > span {
  left: auto;
  right: 25px;
}
.gantt-milestone:hover i,
.gantt-milestone:focus-visible i {
  box-shadow:
    0 0 0 4px #fff,
    0 0 0 6px color-mix(in srgb, currentColor 20%, transparent);
}
.gantt-actual {
  top: calc(var(--actual-y) - 12px);
}
.gantt-actual i {
  left: 7px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
}
.gantt-actual > span {
  font-size: 12px;
}
.gantt-completion-gap {
  position: absolute;
  top: var(--actual-y);
  border-top: 1px dashed var(--milestone-color);
  opacity: 0.55;
  pointer-events: none;
}
.gantt-node-row.is-cancelled .gantt-planned i {
  border-style: dashed;
}
.gantt-node-row.is-cancelled .gantt-planned > span {
  text-decoration: line-through;
}
.gantt-milestone.is-outside i {
  display: none;
}
.gantt-milestone.is-outside > span {
  border: 1px dashed currentColor;
  padding-inline: 6px;
}
.gantt-invalid-date {
  color: var(--muted);
  font-size: 12px;
  position: absolute;
  left: 18px;
  top: var(--planned-y);
}
.gantt-empty-task {
  height: 56px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.gantt-empty-task > span {
  display: inline-flex;
  position: sticky;
  left: 18px;
  margin: 16px 18px;
}
.gantt-legend {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 20px;
  padding: 10px 18px;
  color: var(--muted);
  font-size: 11px;
}
.gantt-legend > span:not(.gantt-explanation) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.gantt-legend i {
  display: inline-block;
  color: var(--primary);
}
.legend-planned {
  width: 8px;
  height: 8px;
  border: 1.5px solid currentColor;
  transform: rotate(45deg);
  border-radius: 1px;
}
.legend-actual {
  width: 7px;
  height: 7px;
  background: currentColor;
  border-radius: 50%;
}
.legend-link {
  width: 20px;
  height: 7px;
  border-top: 1px solid #608d7c;
  border-right: 1px solid #608d7c;
  border-radius: 0 5px 0 0;
}
.gantt-explanation {
  margin-left: auto;
}
.gantt-scroll-hints {
  margin-left: auto;
  color: var(--primary);
}
.gantt-tooltip {
  white-space: pre-line;
  line-height: 1.75;
}
@media (max-width: 1100px) {
  .gantt-toolbar {
    padding: 12px;
  }
  .gantt-caption {
    gap: 8px;
  }
  .gantt-explanation {
    width: 100%;
    margin-left: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .gantt-milestone i,
  .gantt-node-label,
  .gantt-scale button,
  .gantt-lane,
  .gantt-dependencies path {
    transition: none;
  }
}
</style>

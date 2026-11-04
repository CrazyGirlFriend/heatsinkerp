<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconChevronRight,
  IconChevronLeft,
  IconChevronsUp,
  IconChevronsDown,
  IconFlag,
  IconMapPinFilled,
  IconExclamationCircleFilled,
  IconFocus2,
} from '@tabler/icons-vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
import ScheduleTimelineBar from './ScheduleTimelineBar.vue'
import ScheduleDeliveryMark from './ScheduleDeliveryMark.vue'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import { progressRange, timelineNodes } from '@/utils/scheduleProgress'
import { planLabel, hasConfirmedPlan } from '@/utils/schedulePlanning'
import { scheduleTimestamp } from '@/utils/scheduleTimeline'
import {
  BOARD_DAY,
  boardDay,
  boardDate,
  boardQuantity,
  boardSummaryNodes,
  boardTeamColor,
  layoutBoardBars,
  type BoardBar,
} from '@/utils/scheduleBoard'

const props = defineProps<{ tasks: ScheduleTask[]; loading?: boolean }>()
const emit = defineEmits<{
  'open-task': [task: ScheduleTask]
  'open-node': [node: ProductionSchedule]
}>()
const now = ref(Date.now())
const range = ref<[string, string]>([
  boardDate(boardDay(now.value) - 2 * BOARD_DAY),
  boardDate(boardDay(now.value) + 4 * BOARD_DAY),
])
const period = ref(7)
const expanded = ref(new Set<number>())
const seen = new Set<number>()
const grid = ref<HTMLElement>()
const measured = ref(1100)
const identityWidth = ref(224)
const quantityWidth = 76
let observer: ResizeObserver | undefined
let clock: ReturnType<typeof setInterval> | undefined
const start = computed(() => Date.parse(`${range.value[0]}T00:00:00+08:00`))
const end = computed(() => Date.parse(`${range.value[1]}T00:00:00+08:00`) + BOARD_DAY)
const days = computed(() => progressRange(start.value, end.value, now.value).days)
const trackWidth = computed(() => Math.max(1, measured.value - identityWidth.value - quantityWidth))
const gridWidth = computed(() =>
  Math.max(940, identityWidth.value + quantityWidth + days.value.length * 192),
)
const monthLabel = computed(() => {
  const first = range.value[0],
    last = range.value[1]
  return `${first.slice(0, 4)} 年 ${Number(first.slice(5, 7))} 月${first.slice(0, 7) === last.slice(0, 7) ? '' : ` — ${first.slice(0, 4) === last.slice(0, 4) ? '' : `${last.slice(0, 4)} 年 `}${Number(last.slice(5, 7))} 月`}`
})
const todayPosition = computed(() => ((now.value - start.value) / (end.value - start.value)) * 100)
const todayVisible = computed(() => todayPosition.value >= 0 && todayPosition.value <= 100)
const groups = computed(() =>
  props.tasks.map((task) => {
    const nodes = [...task.nodes]
      .filter((node) => node.status !== 'cancelled')
      .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
    const steps = nodes.map((node) => ({
      node,
      ...layoutBoardBars([node], start.value, end.value, trackWidth.value),
    }))
    const summary = layoutBoardBars(
      boardSummaryNodes(nodes),
      start.value,
      end.value,
      trackWidth.value,
    )
    const open = expanded.value.has(task.id)
    const headerHeight = open ? 52 : Math.max(60, summary.height)
    const height = open
      ? headerHeight + steps.reduce((sum, step) => sum + step.height, 0)
      : headerHeight
    const due = scheduleTimestamp(task.final_due_at)
    return {
      task,
      steps,
      summary,
      open,
      headerHeight,
      height,
      due,
      deadline:
        due != null && due >= start.value && due < end.value
          ? Math.min(
              trackWidth.value - 18,
              Math.max(18, ((due - start.value) / (end.value - start.value)) * trackWidth.value),
            )
          : null,
      pending: nodes.filter((node) => !hasConfirmedPlan(node)).length,
    }
  }),
)
const teamLegend = computed(() => [
  ...new Set(
    props.tasks.flatMap((task) =>
      task.nodes.filter((node) => node.status !== 'cancelled').map((node) => node.team_name),
    ),
  ),
])
const anyOpen = computed(
  () => !!props.tasks.length && props.tasks.some((task) => expanded.value.has(task.id)),
)
watch(
  () => props.tasks,
  (tasks) => {
    const fresh = tasks.filter((task) => !seen.has(task.id))
    if (fresh.length) expanded.value.add(fresh[0]!.id)
    tasks.forEach((task) => seen.add(task.id))
  },
  { immediate: true },
)
watch(range, () => {
  const count = Math.round((end.value - start.value) / BOARD_DAY)
  period.value = [7, 14, 30].includes(count) ? count : 0
})
function toggle(id: number) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}
function toggleAll() {
  expanded.value = anyOpen.value ? new Set() : new Set(props.tasks.map((task) => task.id))
}
function setPeriod(count: number) {
  period.value = count
  const from = todayVisible.value
    ? boardDay(now.value) - (count === 7 ? 2 : 5) * BOARD_DAY
    : start.value
  range.value = [boardDate(from), boardDate(from + (count - 1) * BOARD_DAY)]
}
function shift(direction: number) {
  const span = end.value - start.value
  range.value = [
    boardDate(start.value + direction * span),
    boardDate(end.value - BOARD_DAY + direction * span),
  ]
}
function today() {
  const count = days.value.length
  const from = boardDay(now.value) - Math.min(5, Math.floor(count / 3)) * BOARD_DAY
  range.value = [boardDate(from), boardDate(from + (count - 1) * BOARD_DAY)]
}
function locate(task: ScheduleTask) {
  const dates = timelineNodes(task.nodes)
    .flatMap((node) => [scheduleTimestamp(node.planned_start_at), scheduleTimestamp(node.due_at)])
    .filter((time): time is number => time != null)
  const finalDue = scheduleTimestamp(task.final_due_at)
  if (finalDue != null) dates.push(finalDue)
  if (!dates.length) return
  const first = boardDay(Math.min(...dates)),
    last = boardDay(Math.max(...dates))
  range.value = [
    boardDate(first - BOARD_DAY),
    boardDate(Math.max(first + 6 * BOARD_DAY, last + BOARD_DAY)),
  ]
  expanded.value.add(task.id)
}
function openBar(task: ScheduleTask, bar: BoardBar) {
  const parent = task.nodes.find((node) => node.id === (bar.node.parent_schedule_id || bar.node.id))
  if (parent) emit('open-node', parent)
}
function amount(node: ProductionSchedule) {
  return node.completion_basis === 'weight'
    ? `${formatAmount(node.target_weight)} kg`
    : formatAmount(node.target_quantity)
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (grid.value) {
      measured.value = grid.value.clientWidth
      identityWidth.value =
        Number.parseFloat(getComputedStyle(grid.value).getPropertyValue('--identity')) || 224
    }
  })
  if (grid.value) observer.observe(grid.value)
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  clearInterval(clock)
})
</script>

<template>
  <section class="production-timeline" aria-label="生产排期看板" :aria-busy="loading">
    <div class="board-toolbar">
      <div class="toolbar-start">
        <slot />
        <button
          class="icon-button collapse-button"
          :aria-label="anyOpen ? '收起全部班组' : '展开全部班组'"
          :title="anyOpen ? '收起全部班组' : '展开全部班组'"
          @click="toggleAll"
        >
          <component :is="anyOpen ? IconChevronsUp : IconChevronsDown" :size="18" />
        </button>
      </div>
      <div class="toolbar-end">
        <ScheduleDateRange v-model="range" compact />
        <div class="period-switch" aria-label="排期显示周期">
          <button
            v-for="item in [
              { days: 7, label: '周' },
              { days: 14, label: '双周' },
              { days: 30, label: '月' },
            ]"
            :key="item.days"
            :aria-pressed="period === item.days"
            @click="setPeriod(item.days)"
          >
            {{ item.label }}
          </button>
        </div>
        <span class="toolbar-divider" />
        <button class="icon-button" aria-label="上一时间段" @click="shift(-1)">
          <IconChevronLeft :size="18" />
        </button>
        <button class="today-button" @click="today">今天</button>
        <button class="icon-button" aria-label="下一时间段" @click="shift(1)">
          <IconChevronRight :size="18" />
        </button>
        <slot name="view-actions" />
      </div>
    </div>
    <div class="board-scroll">
      <div
        ref="grid"
        class="schedule-grid"
        :style="{ minWidth: `${gridWidth}px`, '--days': days.length }"
      >
        <header class="grid-heading">
          <div class="identity-heading">流水号 / 班组</div>
          <div class="quantity-heading">计划数</div>
          <div class="date-heading">
            <div class="month-caption">{{ monthLabel }}</div>
            <div class="day-headings">
              <div
                v-for="day in days"
                :key="day.date"
                :class="{ weekend: day.weekend, today: day.today }"
              >
                <b>{{ day.label.slice(-2) }}</b
                ><span>{{ day.today ? '今天' : day.weekday?.slice(-1) }}</span>
              </div>
            </div>
          </div>
        </header>
        <div v-if="loading && !tasks.length" class="board-empty" role="status">正在读取排期…</div>
        <div v-else-if="!tasks.length" class="board-empty">暂无排期</div>
        <div
          v-for="group in groups"
          :key="group.task.id"
          class="order-group"
          :style="{ height: `${group.height}px` }"
        >
          <div
            class="schedule-row order-row"
            :class="{ expanded: group.open }"
            :style="{ height: `${group.headerHeight}px` }"
          >
            <div class="identity-cell">
              <button
                class="icon-button"
                :aria-expanded="group.open"
                :aria-label="`${group.open ? '收起' : '展开'} ${group.task.serial_no} 的班组`"
                @click="toggle(group.task.id)"
              >
                <IconChevronRight :size="18" class="chevron" :class="{ open: group.open }" />
              </button>
              <button
                class="serial-link"
                :title="group.task.serial_no"
                @click="emit('open-task', group.task)"
              >
                {{ group.task.serial_no }}
              </button>
              <IconExclamationCircleFilled
                v-if="group.task.status === 'overdue'"
                class="order-warning"
                :size="14"
                aria-label="交期已逾期"
              />
            </div>
            <div class="quantity-cell">{{ formatAmount(boardQuantity(group.task)) }}</div>
            <div class="track">
              <div class="track-grid">
                <span
                  v-for="day in days"
                  :key="day.date"
                  :class="{ weekend: day.weekend, 'today-column': day.today }"
                />
              </div>
              <span v-if="todayVisible" class="today-line" :style="{ left: `${todayPosition}%` }" />
              <template v-if="group.open">
                <template v-for="(step, index) in group.steps" :key="step.node.id">
                  <span
                    v-if="step.bars.length"
                    class="summary-line"
                    :title="step.node.team_name"
                    :style="{
                      left: `${Math.min(...step.bars.map((bar) => bar.left))}px`,
                      width: `${Math.max(...step.bars.map((bar) => bar.left + (bar.interval ? bar.width : 4))) - Math.min(...step.bars.map((bar) => bar.left))}px`,
                      top: `${23 + (index % 3) * 3}px`,
                      background: boardTeamColor(step.node.team_name),
                    }"
                  />
                </template>
              </template>
              <template v-else>
                <ScheduleTimelineBar
                  v-for="bar in group.summary.bars"
                  :key="bar.node.id"
                  :bar="bar"
                  :serial-no="group.task.serial_no"
                  :now="now"
                  summary
                  @open="openBar(group.task, bar)"
                />
                <button
                  v-if="!group.summary.bars.length && group.pending"
                  class="pending-plan"
                  @click="toggle(group.task.id)"
                >
                  {{ group.pending }} 个班组待填写 <IconChevronRight :size="14" />
                </button>
              </template>
              <button
                v-if="group.deadline !== null"
                class="deadline"
                :style="{ left: `${group.deadline}px` }"
                :title="`最终交期 ${formatDateTime(group.task.final_due_at)}`"
                :aria-label="`查看 ${group.task.serial_no} 最终交期 ${formatDateTime(group.task.final_due_at)}`"
                @click="emit('open-task', group.task)"
              >
                <IconFlag :size="19" />
              </button>
              <button
                v-else-if="group.summary.outside || group.due !== null"
                class="locate-button"
                title="定位完整排期"
                :aria-label="`定位 ${group.task.serial_no} 排期`"
                @click="locate(group.task)"
              >
                <IconFocus2 :size="17" /><small v-if="group.summary.outside">{{
                  group.summary.outside
                }}</small>
              </button>
            </div>
          </div>
          <template v-if="group.open">
            <div
              v-for="step in group.steps"
              :key="step.node.id"
              class="schedule-row step-row"
              :style="{ height: `${step.height}px`, '--team': boardTeamColor(step.node.team_name) }"
            >
              <div class="identity-cell step-identity">
                <span class="step-number">{{ String(step.node.sequence_no).padStart(2, '0') }}</span
                ><span class="team-dot" /><button
                  class="team-name"
                  @click="emit('open-node', step.node)"
                >
                  {{ step.node.team_name }}</button
                ><button
                  v-if="
                    (step.node.stock?.on_hand_quantity || 0) > 0 ||
                    (step.node.stock?.on_hand_weight || 0) > 0
                  "
                  class="stock-pill"
                  :title="`本班组在库 ${formatAmount(step.node.stock?.on_hand_quantity)} 件 · ${formatAmount(step.node.stock?.on_hand_weight)} kg`"
                  @click="emit('open-node', step.node)"
                >
                  <IconMapPinFilled :size="12" />{{
                    step.node.completion_basis === 'weight'
                      ? `${formatAmount(step.node.stock?.on_hand_weight)} kg`
                      : formatAmount(step.node.stock?.on_hand_quantity)
                  }}
                </button>
              </div>
              <div class="quantity-cell">{{ amount(step.node) }}</div>
              <div class="track">
                <div class="track-grid">
                  <span
                    v-for="day in days"
                    :key="day.date"
                    :class="{ weekend: day.weekend, 'today-column': day.today }"
                  />
                </div>
                <span
                  v-if="todayVisible"
                  class="today-line"
                  :style="{ left: `${todayPosition}%` }"
                />
                <ScheduleTimelineBar
                  v-for="bar in step.bars"
                  :key="bar.node.id"
                  :bar="bar"
                  :serial-no="group.task.serial_no"
                  :now="now"
                  @open="openBar(group.task, bar)"
                />
                <button
                  v-if="!hasConfirmedPlan(step.node)"
                  class="pending-plan"
                  @click="emit('open-node', step.node)"
                >
                  {{ planLabel(step.node) }} <IconChevronRight :size="14" />
                </button>
                <button
                  v-else-if="!step.bars.length && step.outside"
                  class="pending-plan outside-plan"
                  :title="`查看${step.node.team_name}排期`"
                  :aria-label="`定位${group.task.serial_no}的${step.node.team_name}排期`"
                  @click="locate(group.task)"
                >
                  <IconFocus2 :size="16" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
    <footer class="board-footer">
      <div class="team-legend">
        <span v-for="name in teamLegend" :key="name" :style="{ '--team': boardTeamColor(name) }"
          ><span class="team-dot" />{{ name }}</span
        >
      </div>
      <div class="state-legend">
        <span><ScheduleDeliveryMark state="pending" />待完成</span>
        <span><ScheduleDeliveryMark state="completed" />按时完成</span>
        <span><ScheduleDeliveryMark state="overdue" />逾期</span>
        <span><ScheduleDeliveryMark state="completed_late" />逾期完成</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.production-timeline {
  --line: color-mix(in srgb, var(--wm-border, #dde2e8) 60%, var(--wm-bg, #fff));
  --identity: 224px;
  --quantity: 76px;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  color: var(--wm-text, #20242c);
  background: var(--wm-bg, #fff);
  border: 1px solid var(--wm-border, #dde2e8);
  border-radius: 12px;
  font-family: 'HeatSink Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 3px 14px #25395204;
}
.production-timeline button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
  padding: 0;
}
.production-timeline button:focus-visible {
  outline: 2px solid #318fdf;
  outline-offset: 2px;
}
.board-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  min-height: 54px;
  padding: 5px 14px;
  gap: 10px;
  border-bottom: 1px solid var(--line);
}
.toolbar-start,
.toolbar-end {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.toolbar-start {
  flex: 1;
}
.toolbar-end {
  flex-shrink: 0;
}
.production-timeline .icon-button {
  width: 30px;
  height: 30px;
  border-radius: 5px;
  flex-shrink: 0;
  color: var(--wm-muted, #7b838d);
}
.production-timeline .icon-button:hover {
  background: var(--wm-muted-surface, #f2f5f7);
  color: #25766b;
}
.collapse-button {
  border-left: 1px solid var(--line) !important;
  margin-left: 4px;
}
.toolbar-divider {
  width: 1px;
  height: 18px;
  background: #e0e4e9;
  margin: 0 5px;
}
.period-switch {
  display: flex;
  padding: 3px;
  border-radius: 5px;
  background: var(--wm-muted-surface, #f4f6f8);
}
.period-switch button {
  height: 28px;
  padding: 0 10px;
  border-radius: 3px;
  color: var(--wm-muted, #808893);
  font-size: 12px;
}
.period-switch button[aria-pressed='true'] {
  background: var(--wm-bg, #fff);
  box-shadow: 0 1px 3px #2434481c;
  color: #246f64;
}
.production-timeline .today-button {
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--wm-muted-surface, #e2e7eb);
  border-radius: 5px;
}
.production-timeline .toolbar-start :deep(form.workspace-data-toolbar.workspace-toolbar) {
  flex: 0 1 325px;
  min-width: 0;
  gap: 5px;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}
.toolbar-start :deep(.wm-data-toolbar) {
  max-width: 360px;
}
.toolbar-start :deep(.workspace-toolbar__search) {
  flex: 0 1 210px;
  min-width: 100px;
}
.toolbar-start :deep(.el-input__wrapper) {
  box-shadow: none !important;
  background: transparent;
  padding: 0 4px;
}
.toolbar-start :deep(.el-input__inner) {
  font-size: 13px;
}
.toolbar-start :deep(.workspace-query),
.toolbar-start :deep(.workspace-tools) {
  display: none;
}
.toolbar-start :deep(.el-button:not(.is-link)) {
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  box-shadow: none;
  font-size: 13px;
  color: var(--wm-muted, #6b7480);
}
.toolbar-start :deep(.el-button::before),
.toolbar-start :deep(.el-button::after) {
  display: none;
}
.toolbar-start :deep(.el-button:hover) {
  background: var(--wm-muted-surface, #f2f5f7);
  transform: none;
}
.toolbar-end :deep(.schedule-date-trigger) {
  border: 0;
  border-radius: 5px;
  background: transparent;
  box-shadow: none;
  font-size: 13px;
  color: var(--wm-muted, #414b57);
}
.toolbar-end :deep(.schedule-date-trigger::before),
.toolbar-end :deep(.schedule-date-trigger::after) {
  display: none;
}
.board-scroll {
  overflow: auto;
  flex: 1;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--wm-border, #d4dae1) transparent;
  scroll-behavior: smooth;
}
.schedule-grid {
  position: relative;
  min-height: 100%;
}
.grid-heading,
.schedule-row {
  display: grid;
  grid-template-columns: var(--identity) var(--quantity) minmax(0, 1fr);
}
.grid-heading {
  position: sticky;
  top: 0;
  z-index: 8;
  height: 58px;
  background: var(--wm-bg, #fff);
  border-bottom: 1px solid var(--wm-border, #dbe2e7);
}
.identity-heading,
.quantity-heading {
  position: sticky;
  display: flex;
  align-items: center;
  z-index: 2;
  border-right: 1px solid var(--line);
  color: var(--wm-muted, #76808c);
  background: var(--wm-bg, #fff);
  font-size: 12px;
}
.identity-heading {
  left: 0;
  padding-left: 24px;
}
.quantity-heading {
  left: var(--identity);
  justify-content: flex-end;
  gap: 4px;
  padding-right: 15px;
}
.quantity-heading small {
  font-size: 11px;
}
.date-heading {
  min-width: 0;
}
.month-caption {
  height: 27px;
  padding: 8px 13px 0;
  color: var(--wm-muted, #657080);
  font-size: 12px;
  font-weight: 550;
}
.day-headings {
  display: grid;
  grid-template-columns: repeat(var(--days), minmax(0, 1fr));
  height: 31px;
}
.day-headings > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-left: 1px solid var(--wm-muted-surface, #f2f3f5);
  color: var(--wm-muted, #6b7480);
  font-size: 11px;
}
.day-headings b {
  font-size: 13px;
  font-weight: 500;
}
.day-headings .weekend {
  background: var(--wm-muted-surface, #f8f9fb);
}
.day-headings .today {
  background: var(--wm-success-bg, #eaf4f0);
  border-bottom: 2px solid #308e77;
  color: #206e5e;
}
.order-group {
  position: relative;
}
.schedule-row {
  position: relative;
  border-bottom: 1px solid var(--line);
  background: var(--wm-bg, #fff);
}
.order-row {
  border-bottom-color: var(--wm-border, #dde2e8);
}
.order-row.expanded .track-grid {
  opacity: 0;
}
.order-group + .order-group {
  border-top: 1px solid var(--wm-border, #dae1e7);
}
.identity-cell,
.quantity-cell {
  position: sticky;
  display: flex;
  align-items: center;
  z-index: 4;
  border-right: 1px solid var(--line);
  background: inherit;
}
.identity-cell {
  left: 0;
  padding: 0 13px;
  gap: 6px;
  min-width: 0;
}
.quantity-cell {
  left: var(--identity);
  padding: 0 16px;
  justify-content: flex-end;
}
.order-row .quantity-cell {
  font-weight: 600;
}
.production-timeline .serial-link {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 600;
  padding: 6px 0;
}
.serial-link:hover,
.team-name:hover {
  color: #1f8975;
}
.chevron {
  transition: transform 0.18s ease;
}
.chevron.open {
  transform: rotate(90deg);
}
.order-warning {
  flex-shrink: 0;
  color: #d47960;
  margin-left: auto;
}
.step-row {
  animation: row-in 0.18s ease-out;
}
.step-row:hover {
  background: var(--wm-muted-surface, #fcfdff);
}
.step-identity {
  padding-left: 25px;
  gap: 10px;
}
.step-number {
  color: var(--wm-muted, #7b838d);
  width: 18px;
  font-size: 11px;
}
.team-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--team);
  flex-shrink: 0;
}
.production-timeline .stock-pill {
  margin-left: auto;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--team);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.track {
  position: relative;
  min-width: 0;
  isolation: isolate;
  overflow: hidden;
}
.track-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--days), minmax(0, 1fr));
  z-index: -1;
  pointer-events: none;
}
.track-grid > span {
  border-left: 1px solid var(--wm-muted-surface, #f0f2f5);
}
.track-grid .weekend {
  background: var(--wm-muted-surface, #f9fafc);
}

.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #65a999;
  opacity: 0.8;
  pointer-events: none;
}
.summary-line {
  position: absolute;
  height: 3px;
  border-radius: 2px;
  opacity: 0.7;
}
.production-timeline .deadline {
  position: absolute;
  top: 13px;
  transform: translateX(-50%);
  width: 32px;
  height: 32px;
  border: 1px solid var(--wm-border, #d6e0e8);
  border-radius: 5px;
  background: var(--wm-bg, #fff);
  color: var(--wm-muted, #728497);
  z-index: 3;
}
.deadline::after {
  content: '';
  position: absolute;
  width: 1px;
  height: 9px;
  top: 32px;
  border-left: 1px dashed var(--wm-muted, #7e91a3);
}
.production-timeline .pending-plan {
  position: absolute;
  left: 16px;
  top: 12px;
  height: 28px;
  padding: 0 9px;
  color: var(--wm-warning-text, #8d764c);
  font-size: 12px;
  border: 1px dashed var(--wm-border, #d7cbb5);
  border-radius: 4px;
  background: var(--wm-warning-bg, #fffcf6);
}
.production-timeline .outside-plan {
  width: 28px;
  padding: 0;
  color: var(--wm-muted, #7c8998);
  border-color: var(--wm-border, #dbe2e8);
  background: var(--wm-muted-surface, #fafbfd);
}
.production-timeline .locate-button {
  position: absolute;
  right: 9px;
  top: 14px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid var(--wm-border, #e1e7ed);
  border-radius: 4px;
  background: var(--wm-bg, #fff);
  color: var(--wm-muted, #6c8491);
}
.locate-button small {
  font-size: 10px;
}
.board-empty {
  display: grid;
  place-items: center;
  min-height: 280px;
  height: calc(100% - 58px);
  color: var(--wm-muted, #929aa4);
}
.board-footer {
  min-height: 38px;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
  color: var(--wm-muted, #7a8591);
  font-size: 11px;
}
.team-legend,
.state-legend,
.team-legend > span,
.state-legend > span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.team-legend,
.state-legend {
  gap: 13px;
  flex-wrap: wrap;
}
@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 1200px) {
  .production-timeline {
    --identity: 210px;
  }
  .board-toolbar {
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  .toolbar-start {
    flex: 1 1 280px;
  }
  .toolbar-end {
    margin-left: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .step-row {
    animation: none;
  }
  .board-scroll {
    scroll-behavior: auto;
  }
  .chevron {
    transition: none;
  }
}
</style>

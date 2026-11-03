<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
  IconChevronRight,
  IconChevronLeft,
  IconChevronsUp,
  IconChevronsDown,
  IconFlag,
  IconCheck,
  IconMapPinFilled,
  IconExclamationCircleFilled,
  IconFocus2,
  IconX,
  IconArrowRight,
} from '@tabler/icons-vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
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
  boardBatchFlow,
  boardBarState,
  type BoardBar,
} from '@/utils/scheduleBoard'

const props = defineProps<{ tasks: ScheduleTask[]; loading?: boolean }>()
const emit = defineEmits<{
  'open-task': [task: ScheduleTask]
  'open-node': [node: ProductionSchedule]
}>()
const arrowId = `schedule-flow-${useId()}`
const now = ref(Date.now())
const range = ref<[string, string]>([
  boardDate(boardDay(now.value) - 5 * BOARD_DAY),
  boardDate(boardDay(now.value) + 8 * BOARD_DAY),
])
const period = ref(14)
const expanded = ref(new Set<number>())
const seen = new Set<number>()
const selected = ref<{ task: number; node: number } | null>(null)
const grid = ref<HTMLElement>()
const measured = ref(1100)
const identityWidth = ref(236)
const quantityWidth = 76
let observer: ResizeObserver | undefined
let clock: ReturnType<typeof setInterval> | undefined
const start = computed(() => Date.parse(`${range.value[0]}T00:00:00+08:00`))
const end = computed(() => Date.parse(`${range.value[1]}T00:00:00+08:00`) + BOARD_DAY)
const days = computed(() => progressRange(start.value, end.value, now.value).days)
const trackWidth = computed(() => Math.max(1, measured.value - identityWidth.value - quantityWidth))
const gridWidth = computed(() =>
  Math.max(940, identityWidth.value + quantityWidth + days.value.length * 40),
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
    const headerHeight = open ? 54 : Math.max(60, summary.height)
    const positions = new Map<number, { bar: BoardBar; y: number }>()
    let top = headerHeight
    for (const step of steps) {
      for (const bar of step.bars)
        positions.set(bar.node.id, { bar, y: top + 9 + bar.lane * 36 + 17 })
      top += step.height
    }
    const flow =
      selected.value?.task === task.id ? boardBatchFlow(nodes, selected.value.node) : null
    const links =
      open && flow
        ? flow.links.flatMap((link) => {
            const a = positions.get(link.from),
              b = positions.get(link.to)
            if (!a || !b) return []
            const x1 = a.bar.left + a.bar.width,
              x2 = b.bar.left
            const y1 = a.y,
              y2 = b.y
            const middle = y1 + (y2 - y1) / 2
            return [
              {
                key: `${link.from}-${link.to}`,
                path: `M ${x1} ${y1} H ${x1 + 7} V ${middle} H ${Math.max(2, x2 - 7)} V ${y2} H ${x2}`,
                color: boardTeamColor(b.bar.node.team_name),
              },
            ]
          })
        : []
    const due = scheduleTimestamp(task.final_due_at)
    return {
      task,
      steps,
      summary,
      open,
      headerHeight,
      height: open ? top : headerHeight,
      flow,
      links,
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
const active = computed(() => {
  if (!selected.value) return null
  const task = props.tasks.find((task) => task.id === selected.value?.task)
  const node = task && timelineNodes(task.nodes).find((node) => node.id === selected.value?.node)
  const parent = task?.nodes.find((item) => item.id === (node?.parent_schedule_id || node?.id))
  return task && node && parent ? { task, node, parent } : null
})
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
    if (
      selected.value &&
      !tasks.some(
        (task) =>
          task.id === selected.value?.task &&
          timelineNodes(task.nodes).some((node) => node.id === selected.value?.node),
      )
    )
      selected.value = null
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
function selectBar(task: ScheduleTask, bar: BoardBar) {
  selected.value = { task: task.id, node: bar.node.id }
  expanded.value.add(task.id)
}
function openBar(task: ScheduleTask, bar: BoardBar) {
  const parent = task.nodes.find((node) => node.id === (bar.node.parent_schedule_id || bar.node.id))
  if (parent) emit('open-node', parent)
}
function style(bar: BoardBar) {
  return {
    left: `${bar.left}px`,
    width: `${bar.width}px`,
    top: `${9 + bar.lane * 36}px`,
    '--team': boardTeamColor(bar.node.team_name),
  }
}
function amount(node: ProductionSchedule) {
  return node.completion_basis === 'weight'
    ? `${formatAmount(node.target_weight)} kg`
    : formatAmount(node.target_quantity)
}
function barTitle(bar: BoardBar) {
  const node = bar.node
  return `${node.team_name}${node.batch_number ? ` · 第 ${node.batch_number} 批` : ''} · ${amount(node)}${node.completion_basis === 'weight' ? '' : ' 件'}\n${bar.interval ? `${formatDateTime(node.planned_start_at)} → ` : '交期 '}${formatDateTime(node.due_at)}${node.status === 'overdue' ? '\n已逾期' : ''}`
}
function progress(node: ProductionSchedule) {
  const values: number[] = []
  if (node.completion_basis !== 'weight' && node.target_quantity)
    values.push(node.dispatched_quantity / node.target_quantity)
  if (node.completion_basis !== 'quantity' && node.target_weight)
    values.push(node.dispatched_weight / node.target_weight)
  return `${Math.min(100, Math.max(0, (values.length ? Math.min(...values) : 0) * 100))}%`
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && selected.value && !event.defaultPrevented) {
    event.preventDefault()
    selected.value = null
  }
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (grid.value) {
      measured.value = grid.value.clientWidth
      identityWidth.value =
        Number.parseFloat(getComputedStyle(grid.value).getPropertyValue('--identity')) || 236
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
  <section
    class="production-timeline"
    aria-label="生产排期看板"
    :aria-busy="loading"
    @keydown="escape"
  >
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
          <div class="quantity-heading">数量 <small>件</small></div>
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
            <div class="track" @click.self="selected = null">
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
                      top: `${13 + index * Math.min(5, 30 / Math.max(1, group.steps.length - 1))}px`,
                      background: boardTeamColor(step.node.team_name),
                    }"
                  />
                </template>
              </template>
              <template v-else>
                <button
                  v-for="bar in group.summary.bars"
                  :key="bar.node.id"
                  class="batch-bar"
                  :class="[
                    boardBarState(bar.node),
                    {
                      milestone: !bar.interval,
                      overdue: bar.node.status === 'overdue',
                      narrow: bar.width < 68,
                      tiny: bar.width < 32,
                    },
                  ]"
                  :style="style(bar)"
                  :title="barTitle(bar)"
                  :aria-label="barTitle(bar)"
                  @click="expanded.add(group.task.id)"
                  @dblclick="openBar(group.task, bar)"
                >
                  <span
                    v-if="boardBarState(bar.node) === 'partial'"
                    class="bar-progress"
                    :style="{ width: progress(bar.node) }"
                  />
                  <IconCheck
                    v-if="boardBarState(bar.node) === 'done'"
                    :size="14"
                  /><IconMapPinFilled
                    v-else-if="boardBarState(bar.node) === 'stock'"
                    :size="14"
                  /><IconArrowRight v-else-if="boardBarState(bar.node) === 'partial'" :size="14" />
                  <span class="bar-label">{{ bar.node.team_name }}</span
                  ><IconExclamationCircleFilled
                    v-if="bar.node.status === 'overdue'"
                    class="bar-warning"
                    :size="14"
                  />
                </button>
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
              <div class="track" @click.self="selected = null">
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
                <button
                  v-for="bar in step.bars"
                  :key="bar.node.id"
                  class="batch-bar"
                  :class="[
                    boardBarState(bar.node),
                    {
                      milestone: !bar.interval,
                      overdue: bar.node.status === 'overdue',
                      narrow: bar.width < 68,
                      tiny: bar.width < 32,
                      selected: selected?.task === group.task.id && selected.node === bar.node.id,
                      dimmed: group.flow && !group.flow.ids.has(bar.node.id),
                      related: group.flow?.ids.has(bar.node.id),
                      'clipped-start': bar.clippedStart,
                      'clipped-end': bar.clippedEnd,
                    },
                  ]"
                  :style="style(bar)"
                  :title="barTitle(bar)"
                  :aria-label="barTitle(bar)"
                  :aria-pressed="selected?.task === group.task.id && selected.node === bar.node.id"
                  @click="selectBar(group.task, bar)"
                  @dblclick="openBar(group.task, bar)"
                >
                  <span
                    v-if="boardBarState(bar.node) === 'partial'"
                    class="bar-progress"
                    :style="{ width: progress(bar.node) }"
                  />
                  <IconCheck v-if="boardBarState(bar.node) === 'done'" :size="14" /><IconArrowRight
                    v-else-if="boardBarState(bar.node) === 'partial'"
                    :size="14"
                  />
                  <span class="bar-label">{{
                    bar.node.batch_number ? `第${bar.node.batch_number}批` : step.node.team_name
                  }}</span
                  ><span class="bar-quantity">{{ amount(bar.node) }}</span
                  ><IconExclamationCircleFilled
                    v-if="bar.node.status === 'overdue'"
                    class="bar-warning"
                    :size="14"
                  />
                </button>
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
                  @click="locate(group.task)"
                >
                  <IconFocus2 :size="14" />定位排期
                </button>
              </div>
            </div>
          </template>
          <svg
            v-if="group.links.length"
            class="flow-links"
            :style="{ left: `${identityWidth + quantityWidth}px` }"
            :width="trackWidth"
            :height="group.height"
            aria-hidden="true"
          >
            <defs>
              <marker
                :id="`${arrowId}-${group.task.id}`"
                viewBox="0 0 6 6"
                refX="5"
                refY="3"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M 0 0 L 6 3 L 0 6 Z" fill="context-stroke" />
              </marker>
            </defs>
            <path
              v-for="link in group.links"
              :key="link.key"
              :d="link.path"
              :stroke="link.color"
              :marker-end="`url(#${arrowId}-${group.task.id})`"
            />
          </svg>
        </div>
      </div>
    </div>
    <footer class="board-footer" :class="{ 'has-selection': active }">
      <template v-if="active"
        ><span
          class="selection-identity"
          :style="{ '--team': boardTeamColor(active.node.team_name) }"
          ><span class="team-dot" /><strong>{{ active.node.team_name }}</strong
          ><span v-if="active.node.batch_number">第 {{ active.node.batch_number }} 批</span></span
        ><span
          >{{ amount(active.node)
          }}{{ active.node.completion_basis === 'weight' ? '' : ' 件' }}</span
        ><span class="selection-dates"
          >{{
            active.node.planned_start_at
              ? formatDateTime(active.node.planned_start_at)
              : '未填开始时间'
          }}
          <IconArrowRight :size="14" /> {{ formatDateTime(active.node.due_at) }}</span
        ><button class="detail-button" @click="emit('open-node', active.parent)">
          查看详情 <IconArrowRight :size="14" /></button
        ><button class="icon-button" aria-label="取消批次选择" @click="selected = null">
          <IconX :size="16" /></button
      ></template>
      <template v-else
        ><div class="team-legend">
          <span v-for="name in teamLegend" :key="name" :style="{ '--team': boardTeamColor(name) }"
            ><span class="team-dot" />{{ name }}</span
          >
        </div>
        <div class="state-legend">
          <span><IconCheck :size="13" />已转出</span
          ><span><IconMapPinFilled :size="13" />物料在此</span
          ><span><IconArrowRight :size="13" />部分转出</span
          ><span><i class="legend-planned" />已计划</span
          ><span><IconFlag :size="14" />最终交期</span>
        </div></template
      >
    </footer>
  </section>
</template>

<style scoped>
.production-timeline {
  --line: #e8ebef;
  --identity: 236px;
  --quantity: 76px;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  color: #20242c;
  background: #fff;
  border: 1px solid #dde2e8;
  border-radius: 10px;
  font-family: 'HeatSink Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
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
  color: #7b838d;
}
.production-timeline .icon-button:hover {
  background: #f2f5f7;
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
  background: #f4f6f8;
}
.period-switch button {
  height: 28px;
  padding: 0 10px;
  border-radius: 3px;
  color: #808893;
  font-size: 12px;
}
.period-switch button[aria-pressed='true'] {
  background: #fff;
  box-shadow: 0 1px 3px #2434481c;
  color: #246f64;
}
.production-timeline .today-button {
  height: 28px;
  padding: 0 9px;
  border: 1px solid #e2e7eb;
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
  color: #6b7480;
}
.toolbar-start :deep(.el-button::before),
.toolbar-start :deep(.el-button::after) {
  display: none;
}
.toolbar-start :deep(.el-button:hover) {
  background: #f2f5f7;
  transform: none;
}
.toolbar-end :deep(.schedule-date-trigger) {
  border: 0;
  border-radius: 5px;
  background: transparent;
  box-shadow: none;
  font-size: 13px;
  color: #414b57;
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
  scrollbar-color: #d4dae1 transparent;
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
  height: 68px;
  background: #fff;
  border-bottom: 1px solid #dbe2e7;
}
.identity-heading,
.quantity-heading {
  position: sticky;
  display: flex;
  align-items: center;
  z-index: 2;
  border-right: 1px solid var(--line);
  color: #76808c;
  background: #fbfcfd;
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
  color: #657080;
  font-size: 12px;
  font-weight: 550;
}
.day-headings {
  display: grid;
  grid-template-columns: repeat(var(--days), minmax(0, 1fr));
  height: 41px;
}
.day-headings > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-left: 1px solid #f2f3f5;
  color: #6b7480;
  font-size: 11px;
}
.day-headings b {
  font-size: 13px;
  font-weight: 500;
}
.day-headings .weekend {
  background: #f8f9fb;
}
.day-headings .today {
  background: #eaf4f0;
  border-bottom: 2px solid #308e77;
  color: #206e5e;
}
.order-group {
  position: relative;
}
.schedule-row {
  position: relative;
  border-bottom: 1px solid var(--line);
  background: #fff;
}
.order-row.expanded {
  background: #fafbfd;
}
.order-group + .order-group {
  border-top: 1px solid #dae1e7;
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
  background: #fcfdff;
}
.step-identity {
  padding-left: 25px;
  gap: 9px;
}
.step-number {
  color: #7b838d;
  width: 18px;
  font-size: 11px;
}
.team-dot {
  width: 7px;
  height: 7px;
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
  overflow: clip;
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
  border-left: 1px solid #f0f2f5;
}
.track-grid .weekend {
  background: #f9fafc;
}
.track-grid .today-column {
  background: #f6fbf9;
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
  height: 4px;
  border-radius: 3px;
  opacity: 0.75;
}
.production-timeline .batch-bar {
  position: absolute;
  height: 34px;
  border: 1px solid color-mix(in srgb, var(--team) 45%, white);
  border-radius: 4px;
  background: color-mix(in srgb, var(--team) 5%, white);
  color: var(--team);
  padding: 0 7px;
  justify-content: flex-start;
  gap: 4px;
  font-size: 13px;
  text-align: left;
  transition:
    box-shadow 0.15s,
    opacity 0.15s,
    filter 0.15s;
  z-index: 2;
}
.batch-bar:hover {
  filter: brightness(0.98);
  box-shadow: 0 2px 6px #23394c24;
  z-index: 5;
}
.batch-bar > span:not(.bar-progress),
.batch-bar > svg {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}
.batch-bar .bar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1 !important;
}
.batch-bar .bar-quantity {
  margin-left: auto;
  font-weight: 550;
}
.production-timeline .batch-bar.done {
  border-color: transparent;
  background: color-mix(in srgb, var(--team) 10%, white);
}
.production-timeline .batch-bar.partial,
.production-timeline .batch-bar.stock {
  border-color: var(--team);
  background: var(--team);
  color: #fff;
}
.bar-progress {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: #0000001a;
  border-radius: 3px;
}
.production-timeline .batch-bar.overdue {
  border-color: #d77561;
}
.batch-bar .bar-warning {
  position: absolute !important;
  right: -5px;
  top: -5px;
  color: #d96e59;
  background: white;
  border-radius: 50%;
}
.production-timeline .batch-bar.selected {
  box-shadow:
    0 0 0 2px white,
    0 0 0 4px var(--team);
  z-index: 6;
}
.batch-bar.dimmed {
  opacity: 0.3;
}
.batch-bar.related {
  z-index: 4;
}
.batch-bar.tiny .bar-label,
.batch-bar.narrow .bar-quantity {
  display: none;
}
.production-timeline .batch-bar.narrow {
  padding: 0 3px;
  justify-content: center;
}
.production-timeline .batch-bar.milestone {
  top: 14px !important;
  height: 24px;
  border-radius: 50%;
  padding: 0;
  background: color-mix(in srgb, var(--team) 10%, white);
}
.batch-bar.milestone::before {
  content: '';
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  border: 1px solid var(--team);
  margin: auto;
}
.batch-bar.milestone > svg:not(.bar-warning) {
  display: none;
}
.batch-bar.clipped-start {
  border-left-style: dashed;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.batch-bar.clipped-end {
  border-right-style: dashed;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.production-timeline .deadline {
  position: absolute;
  top: 13px;
  transform: translateX(-50%);
  width: 32px;
  height: 32px;
  border: 1px solid #d6e0e8;
  border-radius: 5px;
  background: #fff;
  color: #728497;
  z-index: 3;
}
.deadline::after {
  content: '';
  position: absolute;
  width: 1px;
  height: 9px;
  top: 32px;
  border-left: 1px dashed #7e91a3;
}
.production-timeline .pending-plan {
  position: absolute;
  left: 16px;
  top: 12px;
  height: 28px;
  padding: 0 9px;
  color: #8d764c;
  font-size: 12px;
  border: 1px dashed #d7cbb5;
  border-radius: 4px;
  background: #fffcf6;
}
.production-timeline .outside-plan {
  color: #7c8998;
  border-color: #dbe2e8;
  background: #fafbfd;
}
.production-timeline .locate-button {
  position: absolute;
  right: 9px;
  top: 14px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid #e1e7ed;
  border-radius: 4px;
  background: #fff;
  color: #6c8491;
}
.locate-button small {
  font-size: 10px;
}
.flow-links {
  position: absolute;
  top: 0;
  pointer-events: none;
  z-index: 3;
  overflow: hidden;
}
.flow-links > path {
  fill: none;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.7;
}
.board-empty {
  display: grid;
  place-items: center;
  min-height: 280px;
  height: calc(100% - 68px);
  color: #929aa4;
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
  color: #7a8591;
  font-size: 11px;
}
.team-legend,
.state-legend,
.team-legend > span,
.state-legend > span,
.selection-identity,
.selection-dates {
  display: flex;
  align-items: center;
  gap: 5px;
}
.team-legend,
.state-legend {
  gap: 13px;
  flex-wrap: wrap;
}
.state-legend i {
  width: 11px;
  height: 8px;
  border: 1px solid #8a9da8;
  border-radius: 2px;
}
.legend-planned {
  background: #f7f9fa;
}
.board-footer.has-selection {
  min-height: 44px;
  font-size: 12px;
  justify-content: flex-start;
  color: #55616f;
}
.selection-identity {
  gap: 7px;
}
.selection-dates {
  gap: 8px;
}
.production-timeline .detail-button {
  margin-left: auto;
  color: #24796c;
  font-size: 12px;
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
  .selection-dates {
    font-size: 11px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .step-row {
    animation: none;
  }
  .chevron,
  .batch-bar {
    transition: none;
  }
}
</style>

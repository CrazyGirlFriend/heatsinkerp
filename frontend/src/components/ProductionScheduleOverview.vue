<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ArrowUp,
  Warning,
  CircleCheck,
  VideoPause,
} from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import StatePanel from './StatePanel.vue'
import {
  scheduleStatusLabels,
  type ProductionSchedule,
  type ScheduleTask,
} from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import { scheduleTimestamp } from '@/utils/scheduleTimeline'
import {
  deadlineRemaining,
  isAssessed,
  isDelivered,
  nodeProgress,
  nodeTarget,
  nodeActual,
  progressMarkers,
  progressWeek,
  SCHEDULE_WEEK,
  taskRisk,
} from '@/utils/scheduleProgress'

const props = defineProps<{ tasks: ScheduleTask[]; loading?: boolean }>()
const emit = defineEmits<{
  'open-task': [task: ScheduleTask]
  'open-node': [node: ProductionSchedule]
}>()
const now = ref(Date.now()),
  anchor = ref(now.value),
  expanded = ref<number | null>(null),
  selected = ref<number | null>(null)
const scrollElement = ref<HTMLElement>(),
  viewportWidth = ref(1000),
  dayCount = ref(7)
const width = computed(() =>
  Math.max(viewportWidth.value - (viewportWidth.value <= 900 ? 292 : 482), dayCount.value * 64),
)
const gridWidth = computed(() => width.value + (viewportWidth.value <= 900 ? 292 : 482))
let observer: ResizeObserver | undefined, timer: ReturnType<typeof setInterval> | undefined
const week = computed(() => progressWeek(anchor.value, now.value, dayCount.value))
const groups = computed(() =>
  props.tasks.map((task) => ({
    task,
    risk: taskRisk(task),
    ...progressMarkers(task.nodes, week.value, width.value),
  })),
)
const todayPosition = computed(
  () => ((now.value - week.value.start) / (week.value.end - week.value.start)) * 100,
)
function toggle(task: ScheduleTask, node?: ProductionSchedule) {
  expanded.value = node || expanded.value !== task.id ? task.id : null
  selected.value = node?.id ?? null
}
function locate(node: ProductionSchedule) {
  const time = scheduleTimestamp(node.due_at)
  if (time != null) anchor.value = time
}
function locateTask(task: ScheduleTask) {
  const node =
    task.nodes.find((node) => ['current', 'late', 'hold'].includes(state(node))) ||
    task.nodes.find((node) => !isDelivered(node) && node.status !== 'cancelled') ||
    task.nodes.at(-1)
  if (node) locate(node)
  if (scrollElement.value) scrollElement.value.scrollLeft = 0
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
  if (!isAssessed(node)) return '备料与转出，不考核完成量'
  if (node.status === 'overdue' || isDelivered(node) || node.status === 'cancelled')
    return scheduleStatusLabels[node.status]
  if (node.execution_state === 'partial') return '部分交货'
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
function locationSummary(task: ScheduleTask) {
  return (
    (task.locations || [])
      .map((item) => {
        const onHand = item.quantity
          ? `${formatAmount(item.quantity)} 件`
          : item.weight
            ? `${formatAmount(item.weight)} kg`
            : ''
        const pending = item.pending_quantity
          ? `${formatAmount(item.pending_quantity)} 件`
          : item.pending_weight
            ? `${formatAmount(item.pending_weight)} kg`
            : ''
        return `${item.team_name} ${onHand}${pending ? `${onHand ? '，另 ' : ''}${pending} 待签收` : ''}`
      })
      .join(' / ') || '待关联物料'
  )
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
  return `${task.serial_no} ${task.title} · 第${node.sequence_no}站 ${node.team_name} → ${node.next_team_name || node.external_destination}\n要求转出 ${formatDateTime(node.due_at)}\n${isAssessed(node) ? '加工完成后有效交货' : '实际转出'} ${nodeProgress(node)}\n${stock(node)}\n${label(node)}`
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      const value = entries[0]?.contentRect.width
      if (value) viewportWidth.value = value
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
      '--viewport-width': `${viewportWidth}px`,
      '--day-count': dayCount,
    }"
  >
    <div class="sp-weekbar">
      <div>
        <strong
          >{{
            dayCount > 7
              ? formatDateTime(new Date(week.start).toISOString()).slice(0, 10)
              : week.days[0]?.label
          }}—{{
            dayCount > 7
              ? formatDateTime(new Date(week.end - 1).toISOString()).slice(0, 10)
              : week.days.at(-1)?.label
          }}</strong
        ><span class="sp-week-caption">各班组要求转出时间</span>
      </div>
      <div class="sp-week-actions">
        <label class="sp-range"
          >周期
          <select v-model.number="dayCount" aria-label="排期展示周期">
            <option :value="7">1 周</option>
            <option :value="28">4 周</option>
            <option :value="84">12 周</option>
          </select></label
        >
        <button
          type="button"
          class="sp-icon-button"
          aria-label="上一周"
          @click="anchor -= SCHEDULE_WEEK"
        >
          <ElIcon><ArrowLeft /></ElIcon>
        </button>
        <button type="button" class="sp-subtle-button" @click="anchor = now">本周</button>
        <button
          type="button"
          class="sp-icon-button"
          aria-label="下一周"
          @click="anchor += SCHEDULE_WEEK"
        >
          <ElIcon><ArrowRight /></ElIcon>
        </button>
      </div>
    </div>
    <div ref="scrollElement" class="sp-scroll">
      <div class="sp-table-head sp-grid">
        <span class="sp-head-task">流水号 / 交货任务</span>
        <div class="sp-days">
          <div
            v-for="day in week.days"
            :key="day.date"
            class="sp-day"
            :class="{ 'is-today': day.today }"
          >
            <b>{{ day.label }}</b
            ><small>{{ day.today ? '今天' : day.weekday }}</small>
          </div>
        </div>
        <span class="sp-head-where">当前物料所在</span><span>最终交期 / 提醒</span>
      </div>
      <StatePanel v-if="loading && !tasks.length" state="loading" compact />
      <div v-else-if="!tasks.length" class="sp-empty">当前范围没有交货任务</div>
      <article
        v-for="group in groups"
        :key="group.task.id"
        class="sp-row"
        :class="{ 'is-expanded': expanded === group.task.id }"
        :aria-label="`${group.task.serial_no} ${group.task.title}`"
      >
        <div class="sp-row-main sp-grid">
          <div class="sp-identity">
            <button
              type="button"
              class="sp-task-button"
              :aria-expanded="expanded === group.task.id"
              :aria-controls="`schedule-route-${group.task.id}`"
              @click="toggle(group.task)"
            >
              <strong>{{ group.task.serial_no }}</strong
              ><small
                >{{ group.task.title }} ·
                {{
                  group.task.nodes.find((node) => node.material_name)?.material_name ||
                  group.task.task_no
                }}</small
              ><small v-if="group.task.business_person_name"
                >业务 {{ group.task.business_person_name }}</small
              ><span class="sp-target">{{ target(group.task) }}</span>
              <span class="sp-mobile-where">{{ locationSummary(group.task) }}</span>
            </button>
            <button
              v-if="dayCount > 7"
              type="button"
              class="sp-locate"
              @click="locateTask(group.task)"
            >
              定位节点 <ElIcon><ArrowRight /></ElIcon>
            </button>
          </div>
          <div
            class="sp-track"
            :style="{ minHeight: `${group.height + (group.outside.length ? 28 : 0)}px` }"
            aria-label="班组要求转出时间"
          >
            <span
              v-if="todayPosition >= 0 && todayPosition <= 100"
              class="sp-now-line"
              :style="{ left: `${todayPosition}%` }"
            />
            <svg
              class="sp-links"
              :viewBox="`0 0 ${width} ${group.height}`"
              :style="{ height: `${group.height}px` }"
              aria-hidden="true"
            >
              <path
                v-for="link in group.links"
                :key="link.id"
                :d="link.path"
                :class="{ 'is-done': link.done }"
              />
            </svg>
            <button
              v-for="marker in group.visible"
              :key="marker.node.id"
              type="button"
              class="sp-node"
              :class="[
                `is-${state(marker.node)}`,
                { 'is-selected': selected === marker.node.id && expanded === group.task.id },
              ]"
              :style="{ left: `${(marker.x / width) * 100}%`, top: `${17 + marker.lane * 82}px` }"
              :title="markerTitle(group.task, marker.node)"
              :aria-label="markerTitle(group.task, marker.node)"
              @click="toggle(group.task, marker.node)"
            >
              <span class="sp-team">{{ marker.node.team_name }}</span
              ><span class="sp-mark"
                ><ElIcon v-if="isDelivered(marker.node)"><Check /></ElIcon></span
              ><time :datetime="marker.node.due_at">{{
                formatDateTime(marker.node.due_at).slice(11)
              }}</time>
            </button>
            <div v-if="group.outside.length" class="sp-outside">
              <span>{{ group.outside.length }} 个节点在本周外</span
              ><button type="button" @click="locate(group.outside[0]!)">
                定位交期 <ElIcon><ArrowRight /></ElIcon></button
              ><button type="button" @click="toggle(group.task)">完整路线</button>
            </div>
          </div>
          <div class="sp-where">
            <div
              v-if="
                !group.task.locations?.length &&
                ['completed', 'completed_late'].includes(group.task.status)
              "
              class="sp-location"
            >
              <b>已交完</b><span>{{ completedAmount(group.task) }}</span>
            </div>
            <template v-for="item in group.task.locations" :key="item.team_id">
              <div v-if="item.quantity || item.weight" class="sp-location">
                <b>{{ item.team_name }}</b
                ><span
                  >{{ formatAmount(item.quantity) }} 件<small
                    >{{ formatAmount(item.weight) }} kg</small
                  ></span
                >
              </div>
              <div
                v-if="item.pending_quantity || item.pending_weight"
                class="sp-location is-transit"
              >
                <b>{{ item.team_name }}<small>待签收</small></b
                ><span
                  >{{ formatAmount(item.pending_quantity) }} 件<small
                    >{{ formatAmount(item.pending_weight) }} kg</small
                  ></span
                >
              </div>
            </template>
            <small>{{
              ['completed', 'completed_late'].includes(group.task.status) &&
              !group.task.locations?.length
                ? '末端实际交货量'
                : group.task.shared_source
                  ? '共用批次实存，未分摊到任务'
                  : group.task.locations?.length
                    ? '关联批次实存 · 不跨工序合计'
                    : '暂无关联在库 / 在途料'
            }}</small>
          </div>
          <div class="sp-due">
            <strong>{{ formatDateTime(group.task.final_due_at).slice(5) }}</strong
            ><small>{{ deadlineRemaining(group.task, now) }}</small
            ><span class="sp-risk" :class="`is-${group.risk.tone}`"
              ><ElIcon
                ><VideoPause v-if="group.risk.tone === 'hold'" /><Warning
                  v-else-if="group.risk.tone === 'watch'" /><CircleCheck v-else /></ElIcon
              >{{ group.risk.label }}</span
            >
          </div>
        </div>
        <section
          v-if="expanded === group.task.id"
          :id="`schedule-route-${group.task.id}`"
          class="sp-detail"
          :aria-label="`${group.task.serial_no} ${group.task.title}详细路线`"
        >
          <div class="sp-detail-head">
            <div>
              <h2>{{ group.task.serial_no }} · {{ group.task.title }}</h2>
              <p>
                {{ group.task.task_no }} · 最终交期 {{ formatDateTime(group.task.final_due_at) }}
              </p>
            </div>
            <div class="sp-detail-actions">
              <button type="button" class="sp-subtle-button" @click="emit('open-task', group.task)">
                任务详情</button
              ><button type="button" class="sp-subtle-button" @click="toggle(group.task)">
                收起 <ElIcon><ArrowUp /></ElIcon>
              </button>
            </div>
          </div>
          <p class="sp-detail-reason">
            {{ group.task.notes || '分批加工、分批转出，逐笔累计。各节点按自己的交货目标计算。' }}
          </p>
          <div class="sp-detail-scroll">
            <table>
              <thead>
                <tr>
                  <th>班组 / 去向</th>
                  <th>要求转出时间</th>
                  <th>实际交出 / 当前库存</th>
                  <th>本节点目标</th>
                  <th>节点状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="node in group.task.nodes"
                  :key="node.id"
                  :class="{ 'sp-selected': selected === node.id }"
                >
                  <td>
                    <strong>{{ node.team_name }}</strong
                    ><small>→ {{ node.next_team_name || node.external_destination }}</small>
                  </td>
                  <td>
                    <time :datetime="node.due_at">{{ formatDateTime(node.due_at).slice(5) }}</time
                    ><small v-if="node.completed_at"
                      >交完 {{ formatDateTime(node.completed_at).slice(5) }}</small
                    >
                  </td>
                  <td>
                    <strong
                      >{{ isAssessed(node) ? '有效交货' : '实际转出' }}
                      {{ nodeActual(node) }}</strong
                    ><small>{{ stock(node) }}</small>
                  </td>
                  <td>
                    {{ nodeTarget(node) }}
                  </td>
                  <td class="sp-cell-status" :class="`is-${state(node)}`">{{ label(node) }}</td>
                  <td>
                    <button type="button" class="sp-text-button" @click="emit('open-node', node)">
                      批次明细
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </article>
    </div>
    <footer class="sp-bottom">
      <span>实际转出计交货，签收另记；库房只展示备料与转出。</span>
      <div class="sp-legend">
        <span><i class="sp-legend-done" />已交完</span
        ><span><i class="sp-legend-current" />物料在此</span><span><i />待交货 / 待签收</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.schedule-progress {
  --sp-green: var(--primary);
  --sp-muted: var(--muted);
  --sp-line: var(--line);
  --sp-red: #ba5050;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  color: var(--text);
  background: var(--surface);
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
.schedule-progress select:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.sp-weekbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid var(--line);
}
.sp-weekbar strong {
  font-size: 14px;
  font-weight: 550;
}
.sp-week-caption {
  margin-left: 10px;
  font-size: 12px;
  color: var(--muted);
}
.sp-week-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sp-range {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
.sp-range select,
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
}
.sp-subtle-button:hover,
.sp-icon-button:hover {
  background: #eef6f1;
}
.sp-scroll {
  overflow: auto;
  flex: 1;
  min-height: 0;
  scrollbar-gutter: stable;
}
.sp-grid {
  display: grid;
  grid-template-columns: 144px var(--timeline-width) 154px 142px;
  gap: 14px;
  width: var(--grid-width);
}
.sp-table-head {
  position: sticky;
  top: 0;
  z-index: 3;
  border-block: 1px solid var(--line);
  background: #fafcfb;
  align-items: stretch;
  color: var(--muted);
  font-size: 12px;
  min-height: 56px;
}
.sp-table-head > span {
  display: flex;
  align-items: center;
  background: #fafcfb;
}
.sp-head-task {
  padding-left: 9px;
}
.sp-days {
  display: grid;
  grid-template-columns: repeat(var(--day-count), minmax(0, 1fr));
  min-height: 56px;
}
.sp-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}
.sp-day b {
  font-size: 12px;
  font-weight: 500;
}
.sp-day small {
  font-size: 10px;
  color: #8b978f;
}
.sp-day.is-today {
  color: var(--primary);
  background: #eaf4ed;
}
.sp-day.is-today small {
  color: var(--primary);
}
.sp-row {
  width: var(--grid-width);
  border-bottom: 1px solid var(--line);
}
.sp-row-main {
  align-items: stretch;
  min-height: 112px;
  transition: background var(--motion-fast);
}
.sp-row-main:hover {
  background: #fcfefd;
}
.is-expanded > .sp-row-main {
  background: #f8fcf9;
}
.sp-task-button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 14px 6px 14px 9px;
  border: 0;
  text-align: left;
  overflow-wrap: anywhere;
  color: var(--text);
}
.sp-identity,
.sp-head-task {
  position: sticky;
  left: 0;
  z-index: 1;
  background: white;
  box-shadow: 1px 0 0 var(--line);
}
.sp-identity {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.sp-task-button {
  background: transparent;
}
.sp-locate {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0 9px 10px;
  background: transparent;
  color: var(--primary);
  font-size: 11px !important;
}
.sp-task-button strong {
  font-size: 16px;
  color: var(--primary);
  font-weight: 600;
  letter-spacing: -0.3px;
}
.sp-task-button > small {
  font-size: 12px;
  color: var(--muted);
}
.sp-target {
  font-size: 12px;
}
.sp-track {
  position: relative;
  min-width: 0;
  min-height: 112px;
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent calc(100% / var(--day-count) - 1px),
    #edf1ee calc(100% / var(--day-count) - 1px),
    #edf1ee calc(100% / var(--day-count))
  );
}
.sp-now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #b4d3bf;
  pointer-events: none;
}
.sp-links {
  position: absolute;
  inset: 0;
  width: 100%;
  overflow: visible;
  pointer-events: none;
}
.sp-links path {
  stroke: #d5dfd8;
  stroke-width: 1.3;
  fill: none;
}
.sp-links path.is-done {
  stroke: #7aa28a;
}
.sp-node {
  position: absolute;
  width: 56px;
  height: 78px;
  transform: translateX(-50%);
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  border-radius: 7px;
  color: #7f8b83;
}
.sp-node:hover,
.sp-node.is-selected {
  background: #eaf4edb0;
}
.sp-team {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
}
.sp-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  min-height: 14px;
  color: white;
  background: white;
  border: 1.5px solid #c7d2ca;
  border-radius: 50%;
  flex-shrink: 0;
}
.sp-mark .el-icon {
  font-size: 10px;
}
.sp-node time {
  font-size: 11px;
  color: var(--muted);
  line-height: 16px;
  white-space: nowrap;
}
.sp-node.is-done .sp-mark {
  background: #648e74;
  border-color: #648e74;
}
.sp-node.is-done .sp-team {
  color: #587762;
}
.sp-node.is-current .sp-mark {
  border: 3px solid white;
  background: var(--primary);
  box-shadow:
    0 0 0 2px #2c6a50,
    0 0 0 7px #e5f0e8;
}
.sp-node.is-current .sp-team {
  font-weight: 600;
  color: var(--primary);
}
.sp-node.is-current time {
  color: var(--primary);
}
.sp-node.is-late .sp-mark,
.sp-node.is-hold .sp-mark {
  border: 3px solid white;
  background: var(--sp-red);
  box-shadow:
    0 0 0 2px #bd6763,
    0 0 0 7px #f9ecea;
}
.sp-node.is-late .sp-team,
.sp-node.is-late time,
.sp-node.is-hold .sp-team,
.sp-node.is-hold time {
  color: var(--sp-red);
}
.sp-node.is-cancelled {
  opacity: 0.45;
}
.sp-node.is-transit .sp-mark {
  border-color: #a56c20;
}
.sp-outside {
  position: absolute;
  bottom: 5px;
  left: 6px;
  right: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--muted);
}
.sp-outside button,
.sp-text-button {
  border: 0;
  padding: 3px 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font: inherit;
}
.sp-outside button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.sp-where {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 9px;
  padding: 12px 8px 12px 10px;
}
.sp-where,
.sp-head-where {
  position: sticky;
  right: 156px;
  z-index: 1;
  background: white;
  padding-left: 10px;
}
.sp-location {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.sp-location b {
  font-weight: 550;
  white-space: nowrap;
}
.sp-location span {
  color: var(--muted);
  white-space: nowrap;
  text-align: right;
}
.sp-location small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}
.sp-location.is-transit b {
  color: #986619;
}
.sp-where > small {
  font-size: 10px;
  line-height: 1.5;
  color: var(--muted);
}
.sp-due {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 12px 8px 12px 10px;
}
.sp-due,
.sp-table-head > span:last-child {
  position: sticky;
  right: 0;
  z-index: 1;
  background: white;
  box-shadow: -1px 0 0 var(--line);
  padding-left: 10px;
}
.sp-table-head > span {
  background: #fafcfb;
}
.sp-due > strong {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.sp-due > small {
  font-size: 11px;
  color: var(--muted);
}
.sp-risk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  font-size: 12px;
  color: var(--primary);
  line-height: 1.6;
}
.sp-risk.is-watch {
  color: #a56c20;
}
.sp-risk.is-hold {
  color: var(--sp-red);
}
.sp-risk.is-muted {
  color: var(--muted);
}
.sp-mobile-where {
  display: none;
}
.sp-detail {
  position: sticky;
  left: 0;
  width: calc(var(--viewport-width) - 16px);
  margin: 0 8px 16px;
  padding: 20px 20px 17px;
  border: 1px solid #dde9e1;
  border-radius: 13px;
  background: linear-gradient(140deg, #fff 74%, #f3f9f5);
  box-shadow:
    0 5px 22px #204e3510,
    inset 0 1px 0 white;
}
.sp-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}
.sp-detail-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.sp-detail-head p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.sp-detail-actions {
  display: flex;
  gap: 6px;
}
.sp-detail-reason {
  font-size: 13px;
  line-height: 1.7;
  padding: 0 0 12px;
  color: #496454;
}
.sp-detail-scroll {
  overflow-x: auto;
}
.sp-detail table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}
.sp-detail th {
  font-weight: 500;
  color: var(--muted);
  padding: 9px 8px;
  background: #f5f8f6;
  white-space: nowrap;
}
.sp-detail td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.sp-detail td strong {
  font-weight: 500;
}
.sp-detail td small {
  display: block;
  color: var(--muted);
  line-height: 1.7;
  margin-top: 3px;
}
.sp-detail tr.sp-selected td {
  background: #edf6ef;
}
.sp-cell-status {
  color: var(--muted);
}
.sp-cell-status.is-current {
  color: var(--primary);
}
.sp-cell-status.is-late,
.sp-cell-status.is-hold {
  color: var(--sp-red);
}
.sp-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 0 0;
  font-size: 11px;
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
.sp-legend i {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid #bdcbbf;
}
.sp-legend-done {
  background: #648e74;
  border-color: #648e74;
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
    grid-template-columns: 138px var(--timeline-width) 134px;
    gap: 10px;
  }
  .sp-where,
  .sp-table-head > .sp-head-where {
    display: none;
  }
  .sp-mobile-where {
    display: block;
    font-size: 11px;
    color: #496a55;
  }
}
@media (prefers-reduced-motion: reduce) {
  .schedule-progress * {
    transition: none !important;
  }
}
</style>

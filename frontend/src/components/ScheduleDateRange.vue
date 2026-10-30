<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { ArrowDown, ArrowLeft, ArrowRight, Calendar } from '@element-plus/icons-vue'
import { ElButton, ElCalendar, ElIcon, ElPopover, type CalendarInstance } from 'element-plus'
import { formatDateTime } from '@/utils/format'
import { progressWeek, SCHEDULE_WEEK } from '@/utils/scheduleProgress'

const props = defineProps<{ modelValue: [string, string] }>()
const emit = defineEmits<{ 'update:modelValue': [value: [string, string]] }>()
dayjs.locale('zh-cn')
const visible = ref(false)
const trigger = ref<{ ref: HTMLButtonElement }>()
const calendar = ref<CalendarInstance>()
const month = ref(new Date())
const today = ref(Date.now())
const draft = ref<[string, string]>(['', ''])
const edge = ref<0 | 1>(0)
const hovered = ref('')
const dateText = (time: number) => formatDateTime(new Date(time).toISOString()).slice(0, 10)
const todayText = computed(() => dateText(today.value))
const display = computed(() =>
  props.modelValue.map((date) => date.replaceAll('-', '/')).join(' — '),
)
const dayCount = computed(() =>
  draft.value[0] && draft.value[1]
    ? Math.round((Date.parse(draft.value[1]) - Date.parse(draft.value[0])) / (SCHEDULE_WEEK / 7)) +
      1
    : 0,
)
const preview = computed(() => {
  const [from, to] = draft.value
  return from && (to || hovered.value) ? [from, to || hovered.value].sort() : []
})
const presets = [
  { label: '本周', days: 7, offset: 0 },
  { label: '下周', days: 7, offset: SCHEDULE_WEEK },
  { label: '本月' },
  { label: '4 周', days: 28, offset: 0 },
  { label: '12 周', days: 84, offset: 0 },
]
function presetRange(preset: (typeof presets)[number]): [string, string] {
  if (!preset.days) {
    const date = dayjs(todayText.value)
    return [date.startOf('month').format('YYYY-MM-DD'), date.endOf('month').format('YYYY-MM-DD')]
  }
  const week = progressWeek(today.value + preset.offset!, today.value, preset.days)
  return [dateText(week.start), dateText(week.end - 1)]
}
function presetSelected(preset: (typeof presets)[number]) {
  return presetRange(preset).every((date, index) => date === draft.value[index])
}
function choosePreset(preset: (typeof presets)[number]) {
  draft.value = presetRange(preset)
  month.value = new Date(`${draft.value[0]}T12:00:00`)
  edge.value = 0
  hovered.value = ''
}
function open() {
  today.value = Date.now()
  draft.value = [...props.modelValue]
  month.value = new Date(`${draft.value[0]}T12:00:00`)
  edge.value = 0
  hovered.value = ''
}
function selectEdge(value: 0 | 1) {
  edge.value = value
  const date = draft.value[value] || draft.value[0]
  if (date) month.value = new Date(`${date}T12:00:00`)
  hovered.value = ''
}
function pick(date: string) {
  if (edge.value === 0) {
    draft.value = [date, '']
    edge.value = 1
  } else {
    draft.value = [draft.value[0] || date, date].sort() as [string, string]
    edge.value = 0
  }
  if (!date.startsWith(dayjs(month.value).format('YYYY-MM')))
    month.value = new Date(`${date}T12:00:00`)
  hovered.value = ''
}
function apply() {
  if (!dayCount.value) return
  emit('update:modelValue', [...draft.value])
  close()
}
function close() {
  visible.value = false
  void nextTick(() => trigger.value?.ref?.focus())
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}
watch(visible, (value) => {
  if (value) {
    open()
    document.addEventListener('keydown', escape, true)
  } else document.removeEventListener('keydown', escape, true)
})
onBeforeUnmount(() => document.removeEventListener('keydown', escape, true))
</script>

<template>
  <ElPopover
    v-model:visible="visible"
    role="dialog"
    trigger="click"
    placement="bottom-start"
    :width="336"
    :popper-options="{
      modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }],
    }"
    popper-class="schedule-date-popover"
  >
    <template #reference>
      <ElButton
        ref="trigger"
        class="schedule-date-trigger"
        :aria-label="`排期时间范围：${display}`"
        :aria-expanded="visible"
        aria-haspopup="dialog"
      >
        <ElIcon class="schedule-date-icon"><Calendar /></ElIcon>
        <span>{{ display }}</span>
        <ElIcon class="schedule-date-chevron" :class="{ 'is-open': visible }"><ArrowDown /></ElIcon>
      </ElButton>
    </template>
    <div class="date-range-panel">
      <header class="date-range-heading"><strong>时间范围</strong></header>
      <div class="date-range-presets" aria-label="快捷时间范围">
        <button
          v-for="preset in presets"
          :key="preset.label"
          type="button"
          :aria-pressed="presetSelected(preset)"
          @click="choosePreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>
      <div class="date-range-edges">
        <button
          v-for="(label, index) in ['开始日期', '结束日期']"
          :key="label"
          type="button"
          :aria-label="label"
          :aria-pressed="edge === index"
          @click="selectEdge(index as 0 | 1)"
        >
          <small>{{ label }}</small>
          <span>{{ draft[index]?.replaceAll('-', '/') || '选择日期' }}</span>
        </button>
      </div>
      <ElCalendar ref="calendar" v-model="month" class="schedule-range-calendar">
        <template #header="{ date }">
          <button
            type="button"
            class="date-month-nav"
            aria-label="上个月"
            @click="calendar?.selectDate('prev-month')"
          >
            <ElIcon><ArrowLeft /></ElIcon>
          </button>
          <strong>{{ date }}</strong>
          <button
            type="button"
            class="date-month-nav"
            aria-label="下个月"
            @click="calendar?.selectDate('next-month')"
          >
            <ElIcon><ArrowRight /></ElIcon>
          </button>
        </template>
        <template #date-cell="{ data }">
          <button
            type="button"
            class="range-day"
            :class="{
              'is-between': preview.length && data.day >= preview[0]! && data.day <= preview[1]!,
              'is-start': data.day === preview[0],
              'is-end': data.day === preview[1],
              'is-selected': data.day === draft[0] || data.day === draft[1],
              'is-muted': data.type !== 'current-month',
              'is-today': data.day === todayText,
            }"
            :aria-label="data.day"
            :aria-pressed="data.day === draft[0] || data.day === draft[1]"
            @click.stop="pick(data.day)"
            @mouseenter="hovered = edge === 1 ? data.day : ''"
            @mouseleave="hovered = ''"
          >
            <span>{{ Number(data.day.slice(-2)) }}</span>
          </button>
        </template>
      </ElCalendar>
      <footer class="date-range-footer">
        <span>{{ dayCount ? `共 ${dayCount} 天` : '选择结束日期' }}</span>
        <ElButton size="small" @click="close">取消</ElButton>
        <ElButton size="small" type="primary" :disabled="!dayCount" @click="apply">应用</ElButton>
      </footer>
    </div>
  </ElPopover>
</template>

<style scoped>
:global(.schedule-date-popover.el-popper) {
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: 16px;
  border-radius: 14px;
}
.schedule-date-trigger.el-button {
  height: 34px;
  padding: 0 12px;
  margin: 0;
  border-radius: 9px;
  border-color: var(--line);
  background: linear-gradient(135deg, #fff, #f1f7f3);
  box-shadow:
    inset 0 1px 0 #fff,
    0 1px 3px #204e3508;
  color: var(--text);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.schedule-date-trigger :deep(> span) {
  gap: 9px;
}
.schedule-date-icon {
  color: var(--primary);
  font-size: 14px;
}
.schedule-date-chevron {
  color: var(--muted);
  transition: transform var(--motion-fast);
}
.schedule-date-chevron.is-open {
  transform: rotate(180deg);
}
.date-range-panel {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.date-range-heading {
  margin-bottom: 12px;
}
.date-range-heading strong {
  font-size: 14px;
  font-weight: 600;
}
.date-range-presets {
  display: flex;
  gap: 5px;
  padding-bottom: 14px;
}
.date-range-presets button {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #f8faf9;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.date-range-presets button[aria-pressed='true'] {
  border-color: #a4c3b0;
  background: #e8f2ec;
  color: var(--primary);
}
.date-range-edges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.date-range-edges button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.date-range-edges button[aria-pressed='true'] {
  border-color: #77a38b;
  box-shadow: 0 0 0 2px #eaf3ee;
}
.date-range-edges small {
  color: var(--muted);
  font-size: 11px;
}
.date-range-edges span {
  font-size: 13px;
}
.schedule-range-calendar {
  margin-top: 14px;
  background: transparent;
}
.schedule-range-calendar :deep(.el-calendar__header) {
  padding: 0 0 8px;
  border: 0;
  align-items: center;
}
.schedule-range-calendar :deep(.el-calendar__header strong) {
  font-size: 13px;
  font-weight: 600;
}
.date-month-nav {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.date-month-nav:hover {
  background: #edf4ef;
  color: var(--primary);
}
.schedule-range-calendar :deep(.el-calendar__body) {
  padding: 0;
}
.schedule-range-calendar :deep(.el-calendar-table td) {
  border: 0;
  background: transparent;
}
.schedule-range-calendar :deep(.el-calendar-day) {
  height: 34px;
  padding: 1px 0;
}
.schedule-range-calendar :deep(.el-calendar-table th) {
  padding: 0 0 6px;
  color: var(--muted);
  font-size: 11px;
}
.range-day {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.range-day > span {
  display: grid;
  place-items: center;
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 7px;
}
.range-day:hover > span {
  background: #e8f2ec;
}
.range-day.is-between {
  background: #edf4ef;
}
.range-day.is-start {
  background: linear-gradient(90deg, transparent 50%, #edf4ef 50%);
}
.range-day.is-end {
  background: linear-gradient(90deg, #edf4ef 50%, transparent 50%);
}
.range-day.is-start.is-end {
  background: transparent;
}
.range-day.is-muted {
  color: var(--subtle);
}
.range-day.is-selected > span {
  background: var(--primary);
  color: #fff;
  box-shadow:
    inset 0 1px 0 #ffffff24,
    0 1px 3px #22523b22;
}
.range-day.is-today > span::after {
  content: '';
  position: absolute;
  bottom: 3px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--primary);
}
.range-day.is-selected.is-today > span::after {
  background: #fff;
}
.date-range-panel button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
.date-range-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.date-range-footer > span {
  flex: 1;
  color: var(--muted);
  font-size: 12px;
}
.date-range-footer .el-button {
  margin: 0;
}
@media (prefers-reduced-motion: reduce) {
  .schedule-date-chevron {
    transition: none;
  }
}
</style>

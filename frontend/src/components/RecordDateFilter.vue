<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { Calendar, ArrowDown, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { ElButton, ElCalendar, ElIcon, ElPopover, ElRadioButton, ElRadioGroup, type CalendarInstance } from 'element-plus'
import type { CalendarRange } from '@/types/recordFilters'
const props = withDefaults(defineProps<{ modelValue: CalendarRange; label?: string }>(), { label: '登记日期' })
const emit = defineEmits<{ 'update:modelValue': [value: CalendarRange] }>()
dayjs.locale('zh-cn')
const trigger = ref<{ ref: HTMLButtonElement }>()
const visible = ref(false), mode = ref('day'), draft = ref<CalendarRange>({ from: '', to: '' })
const calendar = ref<CalendarInstance>(), month = ref(new Date())
const active = computed(() => Boolean(props.modelValue.from || props.modelValue.to))
const display = computed(() => {
  const { from, to } = props.modelValue
  return !from && !to ? '不限' : from === to ? from : `${from || '起始'} 至 ${to || '至今'}`
})
function today(offset = 0) {
  // Factory dates are UTC+8, independent of the viewer's operating-system zone.
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const date = new Date(`${parts}T12:00:00`); date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function open() {
  draft.value = { ...props.modelValue }
  mode.value = draft.value.from && draft.value.to && draft.value.from !== draft.value.to ? 'range' : 'day'
  month.value = new Date(`${draft.value.from || today()}T12:00:00`)
}
function shortcut(value: string) { draft.value = { from: value, to: value }; if (value) month.value = new Date(`${value}T12:00:00`) }
function pick(day: string) {
  if (mode.value === 'day') draft.value = { from: day, to: day }
  else if (!draft.value.from || draft.value.to) draft.value = { from: day, to: '' }
  else draft.value = { from: day < draft.value.from ? day : draft.value.from, to: day > draft.value.from ? day : draft.value.from }
}
function apply() { emit('update:modelValue', { ...draft.value, to: draft.value.to || draft.value.from }); visible.value = false }
function selected(day: string) { return day === draft.value.from || day === draft.value.to }
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault(); visible.value = false
  void nextTick(() => trigger.value?.ref?.focus())
}
watch(visible, value => { if (value) document.addEventListener('keydown', escape); else document.removeEventListener('keydown', escape) })
onBeforeUnmount(() => document.removeEventListener('keydown', escape))
</script>
<template>
  <ElPopover v-model:visible="visible" role="dialog" trigger="click" placement="bottom-start" :width="316" popper-class="record-date-popover" @show="open">
    <template #reference><ElButton ref="trigger" class="record-date-trigger" :class="{ 'is-filtered': active }" :icon="Calendar" :aria-label="`${label}：${display}`" :title="`${label}：${display}`" :aria-expanded="visible">{{ label }} · {{ display }}<ElIcon class="date-chevron"><ArrowDown /></ElIcon></ElButton></template>
    <div class="date-shortcuts"><ElButton size="small" @click="shortcut('')">不限</ElButton><ElButton size="small" :type="draft.from === today() && draft.to === today() ? 'primary' : 'default'" plain @click="shortcut(today())">今天</ElButton><ElButton size="small" @click="shortcut(today(-1))">昨天</ElButton></div>
    <ElRadioGroup v-model="mode" size="small" aria-label="日期选择方式" @change="draft = { from: '', to: '' }"><ElRadioButton value="day">某一天</ElRadioButton><ElRadioButton value="range">日期范围</ElRadioButton></ElRadioGroup>
    <ElCalendar ref="calendar" v-model="month" class="record-calendar">
      <template #header="{ date }"><ElButton text :icon="ArrowLeft" aria-label="上个月" @click="calendar?.selectDate('prev-month')" /><strong>{{ date }}</strong><ElButton text :icon="ArrowRight" aria-label="下个月" @click="calendar?.selectDate('next-month')" /></template>
      <template #date-cell="{ data }"><button type="button" class="calendar-day" :class="{ selected: selected(data.day), between: draft.from && draft.to && data.day > draft.from && data.day < draft.to, muted: data.type !== 'current-month' }" :aria-label="data.day" :aria-pressed="selected(data.day)" @click.stop="pick(data.day)">{{ Number(data.day.slice(-2)) }}</button></template>
    </ElCalendar>
    <footer class="date-footer"><span>{{ mode === 'range' ? draft.from && !draft.to ? '请选择结束日期' : '按日期范围查询' : '选择某一天' }}</span><ElButton text size="small" @click="shortcut(''); apply()">清空</ElButton><ElButton type="primary" size="small" @click="apply">确定</ElButton></footer>
  </ElPopover>
</template>
<style scoped>
.record-date-trigger { white-space: nowrap; margin-left: 0 !important; font-size: 13px; }
.record-date-trigger.is-filtered { color: var(--primary); border-color: var(--primary); background: var(--el-color-primary-light-9); }
.date-chevron { margin-left: 10px; }
.date-shortcuts { display: flex; gap: 8px; margin-bottom: 12px; }.date-shortcuts .el-button { flex: 1; margin: 0; }
.record-calendar { --el-calendar-cell-width: 34px; margin-top: 8px; }
.record-calendar :deep(.el-calendar__header) { padding: 0 0 8px; align-items: center; border: 0; font-size: 14px; }
.record-calendar :deep(.el-calendar__body) { padding: 0; }
.record-calendar :deep(.el-calendar-table td) { border: 0; background: transparent; }
.record-calendar :deep(.el-calendar-day) { height: 34px; padding: 1px; }
.record-calendar :deep(.el-calendar-table th) { padding: 4px 0; font-size: 12px; color: var(--muted); }
.calendar-day { width: 100%; height: 100%; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
.calendar-day:hover, .calendar-day.between { background: var(--el-color-primary-light-9); color: var(--primary); }
.calendar-day.muted { color: var(--subtle); opacity: .6; }.calendar-day.selected { background: var(--primary); color: #fff; opacity: 1; }
.calendar-day:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.date-footer { display: flex; align-items: center; gap: 8px; padding-top: 12px; margin-top: 10px; border-top: 1px solid var(--line); }.date-footer span { flex: 1; font-size: 12px; color: var(--muted); }.date-footer .el-button { margin: 0; }
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Close, RefreshLeft, Search, TrendCharts } from '@element-plus/icons-vue'
import FactoryShipmentChart from './FactoryShipmentChart.vue'
import { factoryDashboardApi as api } from '@/services/factoryDashboardApi'
import type { SerialChoice, Shipments } from '@/types/factoryDashboard'
import {
  dashboardNumber as number,
  offsetDate,
  shipmentColor,
  shipmentColors,
} from '@/utils/factoryDashboard'
const props = defineProps<{ initialSelection: SerialChoice[]; today: string }>()
const emit = defineEmits<{ close: [] }>()
const chosen = ref<SerialChoice[]>([...props.initialSelection]),
  search = ref(''),
  rows = ref<SerialChoice[]>([])
const totalRows = ref(0),
  page = ref(1),
  listLoading = ref(false),
  listError = ref('')
const from = ref(offsetDate(props.today, -6)),
  to = ref(props.today)
const data = ref<Shipments>({ dates: [], series: [] }),
  loading = ref(false),
  error = ref('')
const closeEl = ref<HTMLButtonElement>(),
  container = ref<HTMLElement>()
let listVersion = 0,
  chartVersion = 0,
  debounce: ReturnType<typeof setTimeout> | undefined
const lineColors = computed(() => shipmentColors(chosen.value.map((row) => row.serial_no)))
const previousOverflow = document.body.style.overflow
const selected = computed(() => chosen.value)
const available = computed(() => rows.value)
const dateError = computed(() =>
  !from.value || !to.value || from.value > to.value
    ? '请选择有效日期范围'
    : (Date.parse(to.value) - Date.parse(from.value)) / 86400000 > 365
      ? '日期范围最多366天'
      : '',
)
const totals = computed(() =>
  data.value.dates.map((_, i) =>
    data.value.series.reduce((sum, row) => sum + (row.values[i] ?? 0), 0),
  ),
)
const total = computed(() => totals.value.reduce((a, b) => a + b, 0)),
  peak = computed(() => Math.max(0, ...totals.value))
const average = computed(() => (totals.value.length ? total.value / totals.value.length : 0))
const peakDate = computed(() =>
  peak.value ? data.value.dates[totals.value.indexOf(peak.value)]?.slice(5) : '—',
)
function has(serial: string) {
  return chosen.value.some((row) => row.serial_no === serial)
}
function toggle(row: SerialChoice) {
  chosen.value = has(row.serial_no)
    ? chosen.value.filter((r) => r.serial_no !== row.serial_no)
    : [...chosen.value, row]
}
function allFiltered() {
  chosen.value = [...chosen.value, ...available.value.filter((row) => !has(row.serial_no))].slice(
    0,
    100,
  )
}
async function latest() {
  try {
    const result = await api.serials('', 1, 5)
    chosen.value = result.items
  } catch {
    error.value = '读取最新流水号失败，请重试'
  }
}
function range(days: number) {
  to.value = props.today
  from.value = offsetDate(props.today, 1 - days)
}
async function loadList(append = false) {
  const version = ++listVersion
  listLoading.value = true
  listError.value = ''
  try {
    const result = await api.serials(search.value, append ? page.value + 1 : 1)
    if (version !== listVersion) return
    rows.value = append ? [...rows.value, ...result.items] : result.items
    totalRows.value = result.total
    page.value = result.page
  } catch {
    if (version === listVersion) listError.value = '流水号读取失败，请重试'
  } finally {
    if (version === listVersion) listLoading.value = false
  }
}
async function loadChart() {
  const version = ++chartVersion
  error.value = ''
  if (dateError.value || !chosen.value.length) {
    data.value = { dates: [], series: [] }
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await api.shipments(
      chosen.value.map((r) => r.serial_no),
      from.value,
      to.value,
    )
    if (version === chartVersion) data.value = result
  } catch {
    if (version === chartVersion) {
      error.value = '发货数据读取失败，请重试'
      data.value = { dates: [], series: [] }
    }
  } finally {
    if (version === chartVersion) loading.value = false
  }
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !container.value) return
  const elements = [
    ...container.value.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]'),
  ].filter((e) => !e.hasAttribute('disabled') && e.offsetParent !== null)
  if (event.shiftKey && document.activeElement === elements[0]) {
    event.preventDefault()
    elements.at(-1)?.focus()
  } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
    event.preventDefault()
    elements[0]?.focus()
  }
}
watch(search, () => {
  clearTimeout(debounce)
  ++listVersion
  debounce = setTimeout(() => loadList(), 250)
})
watch([chosen, from, to], loadChart)
onMounted(() => {
  document.body.style.overflow = 'hidden'
  loadList()
  loadChart()
  nextTick(() => closeEl.value?.focus())
})
onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  ++listVersion
  ++chartVersion
  clearTimeout(debounce)
})
</script>
<template>
  <Teleport to="body">
    <div class="analysis-overlay" @keydown.esc.stop="emit('close')">
      <section
        ref="container"
        class="analysis-canvas"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-title"
        @keydown="trapFocus"
      >
        <header class="analysis-header">
          <div>
            <span class="analysis-mark"><TrendCharts /></span>
            <h2 id="analysis-title">发货速率分析</h2>
          </div>
          <button
            ref="closeEl"
            class="analysis-close"
            aria-label="关闭分析画布"
            @click="emit('close')"
          >
            <Close />
          </button>
        </header>
        <div class="analysis-body">
          <aside class="analysis-sidebar">
            <div class="analysis-sidebar-title">
              <h3>流水号</h3>
              <span>已选 {{ chosen.length }} 条</span>
            </div>
            <div class="analysis-search">
              <Search /><input
                v-model="search"
                type="search"
                aria-label="搜索分析流水号"
                placeholder="搜索流水号"
              />
            </div>
            <div class="analysis-selection-actions">
              <button @click="allFiltered">选中当前结果</button
              ><button @click="chosen = []">清空</button>
            </div>
            <div class="analysis-serial-list">
              <label
                v-for="row in available"
                :key="row.serial_no"
                :class="{ checked: has(row.serial_no) }"
                :style="{
                  '--serial-color': lineColors[row.serial_no] || shipmentColor(row.serial_no),
                }"
                ><input
                  type="checkbox"
                  :checked="has(row.serial_no)"
                  :disabled="chosen.length >= 100 && !has(row.serial_no)"
                  :aria-label="'分析 ' + row.serial_no"
                  @change="toggle(row)"
                />
                <div>
                  <strong>{{ row.serial_no }}</strong
                  ><small>{{ row.created_at.slice(5) }}</small>
                </div></label
              >
              <p v-if="listError" role="alert" class="analysis-error">
                {{ listError }}<button @click="loadList()">重试</button>
              </p>
              <p v-else-if="!available.length" class="analysis-empty-search">
                {{ listLoading ? '正在读取…' : '没有匹配的流水号' }}
              </p>
              <button
                v-if="rows.length < totalRows"
                class="load-more"
                :disabled="listLoading"
                @click="loadList(true)"
              >
                {{ listLoading ? '正在读取…' : '加载更多流水号' }}
              </button>
            </div>
            <button class="analysis-latest" @click="latest"><RefreshLeft />恢复最新 5 条</button>
          </aside>
          <div class="analysis-main">
            <div class="analysis-toolbar">
              <div class="analysis-date-range">
                <input v-model="from" type="date" aria-label="分析开始日期" /><span>至</span
                ><input v-model="to" type="date" aria-label="分析结束日期" />
              </div>
              <div class="segmented">
                <button
                  v-for="days in [7, 14, 30]"
                  :key="days"
                  :class="{ selected: from === offsetDate(today, 1 - days) && to === today }"
                  @click="range(days)"
                >
                  近 {{ days }} 天
                </button>
              </div>
            </div>
            <p v-if="dateError || error" class="analysis-error" role="alert">
              {{ dateError || error }}<button v-if="error" @click="loadChart">重试</button>
            </p>
            <div class="analysis-metrics">
              <div>
                <span>区间发货</span
                ><b>{{ number(loading || error || dateError ? null : total) }}<small>件</small></b>
              </div>
              <div>
                <span>日均发货</span
                ><b
                  >{{ number(loading || error || dateError ? null : average)
                  }}<small>件 / 天</small></b
                >
              </div>
              <div>
                <span>单日最高</span
                ><b>{{ number(loading || error || dateError ? null : peak) }}<small>件</small></b
                ><em>{{ peakDate }}</em>
              </div>
            </div>
            <div class="analysis-chart-region" :aria-busy="loading">
              <div class="analysis-legend">
                <span v-for="row in selected" :key="row.serial_no"
                  ><i
                    :style="{
                      background: lineColors[row.serial_no] || shipmentColor(row.serial_no),
                    }"
                  ></i
                  >{{ row.serial_no }}</span
                >
              </div>
              <div class="analysis-chart"><FactoryShipmentChart :data="data" expanded /></div>
              <div
                v-if="loading || !chosen.length || dateError || error"
                class="analysis-chart-empty"
              >
                {{
                  loading
                    ? '正在读取发货数据…'
                    : error || dateError || '从左侧选择流水号，开始比较发货速度'
                }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.analysis-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(34, 52, 42, 0.3);
  backdrop-filter: blur(5px);
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: analysis-fade 160ms ease-out both;
}
.analysis-canvas {
  width: 1400px;
  max-width: 100%;
  height: min(920px, calc(100dvh - 48px));
  background: #f5f8f5;
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  overflow: hidden;
  box-shadow:
    0 24px 90px #17291f29,
    0 3px 12px #17291f0b;
  display: flex;
  flex-direction: column;
  animation: analysis-enter 240ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.analysis-header {
  height: 72px;
  flex-shrink: 0;
  padding: 0 26px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border-bottom: 1px solid #e7ede8;
}
.analysis-header > div {
  display: flex;
  align-items: center;
  gap: 13px;
}
.analysis-header h2 {
  font-size: 21px;
  font-weight: 550;
  letter-spacing: -0.55px;
}
.analysis-mark {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  border-radius: 10px;
  background: #eef5ef;
  color: #497c59;
}
.analysis-mark svg {
  width: 20px;
  height: 20px;
}
.analysis-header .draft-label {
  font-size: 10px;
  color: #8b998f;
  background: #f4f7f4;
  padding: 3px 7px;
}
.analysis-close {
  width: 32px;
  height: 32px;
  border: 0;
  background: #f4f7f4;
  border-radius: 9px;
  color: #7b8b80;
  transition:
    background 150ms,
    color 150ms;
}
.analysis-close:hover {
  background: #e9f0eb;
  color: #304d39;
}
.analysis-body {
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.analysis-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 23px 18px 18px;
  background: #fbfcfa;
  border-right: 1px solid #e7ede8;
}
.analysis-sidebar-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 0 2px;
}
.analysis-sidebar-title h3 {
  font-size: 14px;
  font-weight: 550;
  margin: 0;
}
.analysis-sidebar-title > span {
  font-size: 11px;
  color: #869589;
}
.analysis-search {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #e0e8e1;
  background: #fff;
  padding: 9px 10px;
  border-radius: 8px;
  margin-bottom: 9px;
  transition:
    border-color 160ms,
    box-shadow 160ms;
}
.analysis-search:focus-within {
  border-color: #8eaf98;
  box-shadow: 0 0 0 3px #eaf2ec;
}
.analysis-search svg {
  width: 15px;
  height: 15px;
  color: #9caaa0;
}
.analysis-search input {
  border: 0;
  outline: 0;
  min-width: 0;
  width: 100%;
  font: inherit;
  font-size: 12px;
  background: transparent;
  color: #37533f;
}
.analysis-search input::placeholder {
  color: #9aa99e;
}
.analysis-selection-actions {
  display: flex;
  justify-content: space-between;
  margin: 15px 0 10px;
  padding: 0 3px;
}
.analysis-selection-actions button {
  font-size: 11px;
  color: #7d9183;
  padding: 0;
  transition: color 150ms;
}
.analysis-selection-actions button:hover {
  color: #337d4d;
}
.analysis-serial-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 -4px;
  padding: 0 2px;
}
.analysis-serial-list label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 10px;
  margin-bottom: 5px;
  border: 1px solid transparent;
  border-left: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background 160ms,
    border-color 160ms,
    box-shadow 160ms;
}
.analysis-serial-list label:hover {
  background: #f1f6f1;
}
.analysis-serial-list .checked {
  background: #f0f5ef;
  border-color: #e3ebe1;
  border-left-color: var(--serial-color);
  box-shadow: 0 1px 2px #203b2904;
}
.analysis-serial-list input {
  accent-color: #528060;
  width: 13px;
  height: 13px;
  margin: 0;
  flex-shrink: 0;
}
.analysis-serial-list label > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.analysis-serial-list strong {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
  font-size: 12px;
  letter-spacing: -0.18px;
  color: #334e3d;
}
.analysis-serial-list strong i {
  display: none;
}
.analysis-serial-list small {
  font-size: 10px;
  color: #9ca99f;
  flex-shrink: 0;
}
.analysis-latest {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #60846b;
  font-size: 12px;
  border: 1px solid #dfe8e1;
  border-radius: 8px;
  background: #fff;
  padding: 9px;
  margin-top: 14px;
  flex-shrink: 0;
  transition: background 150ms;
}
.analysis-latest:hover {
  background: #eff5ef;
}
.analysis-latest svg {
  width: 14px;
  height: 14px;
}
.analysis-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 23px 26px 24px;
  gap: 17px;
  overflow: auto;
}
.analysis-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}
.analysis-date-range {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid #e0e8e2;
  border-radius: 8px;
  background: #fff;
  padding: 3px 7px;
  color: #a0ada3;
  font-size: 11px;
  box-shadow: 0 1px 2px #203b2903;
}
.analysis-date-range:focus-within {
  border-color: #8eaf98;
}
.analysis-date-range input {
  border: 0;
  border-radius: 5px;
  background: transparent;
  padding: 6px 5px;
  color: #4a6251;
  font: inherit;
  font-size: 12px;
  width: 128px;
  outline: none;
}
.analysis-toolbar .segmented {
  background: #ebf1eb;
  padding: 3px;
  border: 1px solid #e3eae3;
  border-radius: 8px;
  gap: 2px;
}
.analysis-toolbar .segmented button {
  font-size: 11px;
  padding: 6px 11px;
  color: #809083;
  transition:
    background 160ms,
    color 160ms;
}
.analysis-toolbar .segmented .selected {
  color: #3f734e;
  background: #fff;
  box-shadow: 0 1px 4px #233d2b10;
}
.analysis-metrics {
  display: flex;
  align-items: stretch;
  gap: 0;
  flex-shrink: 0;
  padding: 3px 0 4px;
}
.analysis-metrics > div {
  position: relative;
  display: flex;
  align-items: baseline;
  flex-direction: column;
  gap: 5px;
  min-width: 180px;
  padding: 0 34px;
}
.analysis-metrics > div:first-child {
  padding-left: 2px;
}
.analysis-metrics > div + div {
  border-left: 1px solid #e2eae3;
}
.analysis-metrics > div > span {
  font-size: 11px;
  color: #7d9083;
  letter-spacing: 0.15px;
}
.analysis-metrics b {
  font-size: 31px;
  font-weight: 500;
  letter-spacing: -1px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: #2c4936;
}
.analysis-metrics small {
  font-size: 11px;
  color: #91a093;
  margin-left: 7px;
  font-weight: 400;
  letter-spacing: 0;
}
.analysis-metrics em {
  position: absolute;
  right: 0;
  top: 2px;
  font-size: 10px;
  font-style: normal;
  color: #a0ada3;
}
.analysis-chart-region {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 240px;
  background: #fff;
  border: 1px solid #e1e9e2;
  border-radius: 13px;
  padding: 0 12px 8px;
  box-shadow: 0 2px 5px #223c2a03;
  overflow: hidden;
}
.analysis-chart {
  width: 100%;
  flex: 1;
  min-height: 170px;
}
.analysis-chart-empty {
  position: absolute;
  inset: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fffffff2;
  font-size: 13px;
  color: #728477;
  border-radius: 12px;
}
.analysis-legend {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px 22px;
  flex-shrink: 0;
  max-height: 77px;
  overflow: auto;
  padding: 16px 15px 13px;
  margin: 0 3px;
  border-bottom: 1px solid #f0f4f0;
}
.analysis-legend > span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  line-height: 17px;
  color: #607966;
  white-space: nowrap;
}
.analysis-legend i {
  width: 16px;
  height: 3px;
  border-radius: 3px;
}
.analysis-empty-search {
  font-size: 12px;
  color: var(--muted);
  padding: 20px 8px;
}
.analysis-error {
  font-size: 12px;
  color: #af6040;
  margin: 0;
}
.analysis-main::-webkit-scrollbar,
.analysis-serial-list::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.analysis-main::-webkit-scrollbar-thumb,
.analysis-serial-list::-webkit-scrollbar-thumb {
  background: #d5dfd6;
  border-radius: 4px;
}
@keyframes analysis-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes analysis-enter {
  from {
    opacity: 0;
    transform: translateY(7px) scale(0.995);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (max-height: 800px) {
  .analysis-overlay {
    padding: 16px;
  }
  .analysis-canvas {
    height: calc(100dvh - 32px);
  }
  .analysis-header {
    height: 60px;
  }
  .analysis-sidebar {
    padding-top: 17px;
  }
  .analysis-main {
    padding: 17px 21px;
    gap: 13px;
  }
  .analysis-metrics b {
    font-size: 28px;
  }
  .analysis-metrics > div {
    gap: 3px;
  }
  .analysis-chart-region {
    min-height: 210px;
  }
  .analysis-chart {
    min-height: 150px;
  }
  .analysis-legend {
    padding-top: 12px;
    padding-bottom: 10px;
  }
}
@media (max-width: 1100px) {
  .analysis-body {
    grid-template-columns: 214px minmax(0, 1fr);
  }
  .analysis-sidebar {
    padding-inline: 14px;
  }
  .analysis-main {
    padding-inline: 20px;
  }
  .analysis-metrics > div {
    min-width: 150px;
    padding-inline: 24px;
  }
  .analysis-metrics b {
    font-size: 28px;
  }
  .analysis-metrics em {
    display: none;
  }
  .analysis-toolbar {
    flex-wrap: wrap;
    gap: 10px;
  }
  .analysis-date-range input {
    width: 125px;
  }
  .analysis-legend {
    gap: 7px 16px;
  }
}
@media (max-width: 650px) {
  .analysis-overlay {
    padding: 0;
  }
  .analysis-canvas {
    height: 100dvh;
    border-radius: 0;
    border: 0;
    animation: none;
  }
  .analysis-header {
    height: 62px;
    padding: 0 14px;
  }
  .analysis-header h2 {
    font-size: 18px;
  }
  .analysis-header > div {
    gap: 9px;
  }
  .analysis-mark {
    width: 29px;
    height: 29px;
    border-radius: 8px;
  }
  .analysis-mark svg {
    width: 17px;
    height: 17px;
  }
  .analysis-body {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
  .analysis-sidebar {
    flex: 0 0 auto;
    padding: 14px;
    border-right: 0;
    border-bottom: 1px solid #e7ede8;
  }
  .analysis-sidebar-title {
    margin-bottom: 10px;
  }
  .analysis-search {
    margin-bottom: 8px;
  }
  .analysis-selection-actions {
    margin-block: 11px 6px;
  }
  .analysis-serial-list {
    height: 119px;
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    overflow: auto;
  }
  .analysis-serial-list label {
    padding: 7px 6px;
    gap: 7px;
    margin-bottom: 1px;
  }
  .analysis-serial-list strong {
    font-size: 11px;
  }
  .analysis-latest {
    padding: 7px;
    margin-top: 9px;
  }
  .analysis-main {
    flex: none;
    overflow: visible;
    min-height: 0;
    padding: 17px 14px;
    gap: 15px;
  }
  .analysis-metrics {
    justify-content: space-between;
  }
  .analysis-metrics > div {
    min-width: 0;
    padding: 0 15px;
    gap: 5px;
  }
  .analysis-metrics > div:last-child {
    padding-right: 0;
  }
  .analysis-metrics b {
    font-size: 24px;
  }
  .analysis-metrics small {
    font-size: 9px;
    margin-left: 3px;
  }
  .analysis-metrics > div > span {
    font-size: 10px;
  }
  .analysis-chart-region {
    height: 345px;
    flex: none;
    padding-inline: 4px;
  }
  .analysis-header .draft-label {
    font-size: 9px;
  }
  .analysis-legend {
    max-height: 92px;
    gap: 6px 10px;
    padding: 12px 10px;
  }
  .analysis-legend > span {
    font-size: 9px;
    gap: 5px;
  }
  .analysis-legend i {
    width: 12px;
  }
  .analysis-close {
    width: 29px;
    height: 29px;
    flex-shrink: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .analysis-overlay,
  .analysis-canvas {
    animation: none;
  }
  .analysis-close,
  .analysis-search,
  .analysis-serial-list label,
  .analysis-latest,
  .analysis-toolbar .segmented button {
    transition: none;
  }
}
.analysis-overlay {
  font-size: 14px;
  color: #24312a;
  --muted: #64726a;
}
.analysis-overlay button {
  font: inherit;
  cursor: pointer;
  border: 0;
  background: none;
  color: inherit;
}
.analysis-overlay svg {
  width: 18px;
  height: 18px;
}
.analysis-header h2 {
  margin: 0;
}
.analysis-overlay .analysis-close {
  display: grid;
  place-items: center;
  background: #f4f7f4;
}
.analysis-overlay .analysis-latest {
  border: 1px solid #dfe8e1;
  background: #fff;
  color: #60846b;
  font-size: 12px;
}
.analysis-overlay .analysis-selection-actions button {
  font-size: 11px;
  color: #7d9183;
}
.analysis-overlay .segmented {
  display: flex;
}
.analysis-overlay .segmented button {
  font-size: 11px;
  padding: 6px 11px;
  border-radius: 5px;
  color: #809083;
}
.analysis-overlay .segmented .selected {
  background: #fff;
  color: #3f734e;
}
.analysis-overlay .load-more {
  font-size: 11px;
  color: #337d4d;
  width: 100%;
  padding: 8px;
}
.analysis-overlay button:focus-visible {
  outline: 2px solid #337d4d;
  outline-offset: 2px;
}
.analysis-serial-list input:disabled {
  opacity: 0.4;
}
.analysis-chart {
  display: flex;
}
.analysis-chart-empty {
  pointer-events: none;
}
.analysis-chart-region[aria-busy='true'] .analysis-chart {
  opacity: 0.4;
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElAlert, ElButton, ElInput } from 'element-plus'
import { Search, Connection } from '@element-plus/icons-vue'
import TableExportButton from './TableExportButton.vue'
import FilterDialog from './FilterDialog.vue'
import { serialHistoryExportSource } from '@/utils/traceTableExport'
import TeamFlowTimeline from './TeamFlowTimeline.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { historyNumber as num } from '@/utils/serialHistoryChart'
import type { SerialHistory } from '@/types/teamBusiness'
import type { CalendarRange } from '@/types/recordFilters'

const props = defineProps<{ teamId: number }>()
const route = useRoute()
const query = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
const serial = ref(query('serial_no'))
const dates = ref<CalendarRange>({ from: query('date_from'), to: query('date_to') })
const historyRoot = ref<HTMLElement>()
const filtersOpen = ref(false)
const applied = ref({ serial_no: '', date_from: '', date_to: '' })
const loading = ref(false), error = ref(''), result = ref<SerialHistory | null>(null)
const batchOpen = ref(false), batchNo = ref('')
const totals = computed(() => (result.value?.groups || []).reduce((sum, group) => ({ quantity: sum.quantity + (group.owned_quantity ?? group.on_hand_quantity), weight: sum.weight + (group.owned_weight ?? group.on_hand_weight) }), { quantity: 0, weight: 0 }))
let epoch = 0
const live = useLiveRefresh(() => load(true), { teamId: () => props.teamId, enabled: () => Boolean(applied.value.serial_no), busy: () => loading.value || batchOpen.value })
async function load(background = false) {
  if (!applied.value.serial_no) return
  const current = ++epoch
  if (!background) loading.value = true
  error.value = ''
  try {
    const data = await teamMaterialApi.serialHistory(props.teamId, { ...applied.value })
    if (current === epoch) result.value = data
  } catch (e) { if (current === epoch) { if (background) throw e; error.value = e instanceof Error ? e.message : '收发历史读取失败' } }
  finally { if (current === epoch) loading.value = false }
}
function search() {
  if (!serial.value.trim()) { error.value = '请输入完整流水号'; return }
  result.value = null; batchOpen.value = false
  applied.value = { serial_no: serial.value.trim(), date_from: dates.value.from, date_to: dates.value.to }
  void load()
}
function exportSource() { return result.value ? serialHistoryExportSource(result.value) : null }
function showBatch(code: string) { batchNo.value = code; batchOpen.value = true }
watch(() => props.teamId, () => { ++epoch; loading.value = false; error.value = ''; result.value = null; applied.value.serial_no = ''; batchOpen.value = false })
watch(() => [route.query.serial_no, route.query.date_from, route.query.date_to], () => {
  serial.value = query('serial_no'); dates.value = { from: query('date_from'), to: query('date_to') }
  if (serial.value) search()
  else { ++epoch; result.value = null; loading.value = false; error.value = ''; applied.value.serial_no = ''; batchOpen.value = false }
})
onBeforeUnmount(() => { ++epoch })
if (serial.value) search()
</script>

<template>
  <section ref="historyRoot" class="serial-history" aria-label="本班组流水号收发历史">
    <header class="history-header">
      <h2>本班组收发</h2>
      <slot name="actions" />
    </header>
    <div class="history-query-bar">
      <form class="history-search" @submit.prevent="search"><ElInput v-model="serial" :prefix-icon="Search" aria-label="历史流水号" placeholder="输入完整流水号" maxlength="80" clearable /><FilterDialog v-model="filtersOpen" :append-to="historyRoot" title="收发历史筛选" :count="applied.date_from || applied.date_to ? 1 : 0" @open="dates = { from: applied.date_from, to: applied.date_to }" @cancel="dates = { from: applied.date_from, to: applied.date_to }" @apply="filtersOpen = false; search()" @reset="dates = { from: '', to: '' }"><label>收发日期<RecordDateFilter :append-to="historyRoot" v-model="dates" label="收发日期" /></label></FilterDialog><ElButton native-type="submit" type="primary" :loading="loading">查询</ElButton><TableExportButton :append-to="historyRoot" :source="exportSource" :disabled="loading || !!error || !result?.found" :context="[teamId, applied.serial_no, applied.date_from, applied.date_to].join('|')" /></form>
      <div v-if="result?.found" class="history-total"><span>当前库存</span><strong>{{ num(totals.quantity) }} <small>件</small><i>/</i>{{ num(totals.weight) }} <small>kg</small></strong></div>
    </div>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="loading" state="loading" title="正在读取收发历史" />
    <StatePanel v-else-if="error" state="error" :description="error" @retry="search" />
    <div v-else-if="!result" class="history-prompt"><Connection /><h3>查询本班组的收发记录</h3><p>输入完整流水号，查看来源批次、分批转出和库存。</p></div>
    <template v-else>
      <ElAlert v-if="result.untracked_count" :title="result.untracked_count + ' 条历史记录未计入库存，不参与收发计算。'" type="info" :closable="false" />
      <p v-if="result.pending_incoming_count" class="history-note">另有 {{ result.pending_incoming_count }} 批待本班组接收，尚未计入库存。</p>
      <p v-if="!result.found || !result.groups.length" class="history-prompt">{{ result.found ? '暂无已登记的收发记录' : '当前班组未找到该流水号' }}</p>
      <TeamFlowTimeline v-else :history="result" @select="showBatch" />
    </template>
    <MaterialTransferDrawer v-model="batchOpen" :batch-no="batchNo" :trace-scope="{ team_id: teamId }" @changed="live.request" />
  </section>
</template>

<style scoped>
.serial-history { display: flex; flex: 1 0 auto; flex-direction: column; min-width: 0; color: #24324a; }
.serial-history:fullscreen { height: 100dvh; padding: 12px; overflow: auto; background: var(--workspace-bg); }
.serial-history:fullscreen .history-header { display: none; }
.serial-history:fullscreen .history-query-bar { position: sticky; top: 0; z-index: 20; }
.serial-history:fullscreen .team-timeline { flex: 1; height: auto; min-height: 360px; }
.serial-history > :is(.history-prompt, .state-panel) { display: flex; flex: 1 0 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; margin: 0; padding: 32px 16px; border: 1px solid var(--line); border-radius: var(--card-radius); background: var(--surface); }
.serial-history > :is(.history-header, .history-query-bar) { flex-shrink: 0; }
.history-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; min-height: 68px; padding: 16px; border: 1px solid var(--line); border-radius: var(--card-radius) var(--card-radius) 0 0; background: var(--surface); }
.history-header h2 { margin: 0; font-size: 16px; font-weight: 600; white-space: nowrap; }
.history-query-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 24px; padding: 14px 16px; margin-bottom: 14px; border: 1px solid var(--line); border-top: 0; border-radius: 0 0 var(--card-radius) var(--card-radius); background: var(--surface); }
.history-search { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.history-search > .el-input { width: 278px; }
.history-search :deep(.el-input__wrapper), .history-search :deep(.el-button) { min-height: 36px; font-size: 14px; }
.history-search :deep(.record-date-trigger) { min-width: 0; max-width: 280px; }
.history-search :deep(.record-date-trigger > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-search > .el-button { margin-left: 0; }
.history-total { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-left: auto; }
.history-total > span { color: var(--muted); font-size: 13px; }
.history-total strong { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.history-total small { font-size: 13px; font-weight: 400; }
.history-total i { margin-inline: 10px; font-weight: 300; color: var(--subtle); font-style: normal; }
.history-note { margin: 0 0 12px; color: #77849b; font-size: 13px; }.serial-history > .el-alert { margin-bottom: 12px; }
.history-prompt { padding: 90px 16px; text-align: center; color: #7c899f; font-size: 15px; }.history-prompt > svg { width: 42px; color: #9daac1; }.history-prompt h3 { color: #4c5d76; font-size: 22px; font-weight: 500; }
@media(max-width: 760px) {
  .history-header, .history-query-bar { padding: 12px; }
  .history-header :deep(.workspace-actions) { width: 100%; }
  .history-search { display: grid; grid-template-columns: minmax(0, 1fr) auto; width: 100%; }
  .history-search > .el-input { grid-column: 1 / -1; width: 100%; }
  .history-search :deep(.record-date-trigger) { width: 100%; max-width: none; }
  .history-total { margin-left: 0; }
}
</style>

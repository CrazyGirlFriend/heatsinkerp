<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElAlert, ElButton, ElInput } from 'element-plus'
import { Search, Connection } from '@element-plus/icons-vue'
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
const applied = ref({ serial_no: '', date_from: '', date_to: '' })
const loading = ref(false), error = ref(''), result = ref<SerialHistory | null>(null)
const batchOpen = ref(false), batchNo = ref('')
const totals = computed(() => (result.value?.groups || []).reduce((sum, group) => ({ quantity: sum.quantity + group.on_hand_quantity, weight: sum.weight + group.on_hand_weight }), { quantity: 0, weight: 0 }))
let epoch = 0
const live = useLiveRefresh(() => load(true), { enabled: () => Boolean(applied.value.serial_no), busy: () => loading.value || batchOpen.value })
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
  <section class="serial-history" aria-label="本班组流水号收发历史">
    <header class="history-header">
      <h2>本班组收发</h2>
      <form class="history-search" @submit.prevent="search"><ElInput v-model="serial" :prefix-icon="Search" aria-label="历史流水号" placeholder="输入完整流水号" maxlength="80" clearable /><RecordDateFilter v-model="dates" label="收发日期" /><ElButton native-type="submit" type="primary" :loading="loading">查询</ElButton></form>
      <div v-if="result?.found" class="history-total"><span>当前结存</span><strong>{{ num(totals.quantity) }} <small>件</small><i>/</i>{{ num(totals.weight) }} <small>kg</small></strong></div>
    </header>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="loading" state="loading" title="正在读取收发历史" />
    <StatePanel v-else-if="error" state="error" :description="error" @retry="search" />
    <div v-else-if="!result" class="history-prompt"><Connection /><h3>查询本班组的收发记录</h3><p>输入完整流水号，查看来源批次、分批转出和结存。</p></div>
    <template v-else>
      <ElAlert v-if="result.untracked_count" :title="result.untracked_count + ' 条历史记录未纳入库存台账，不参与收发计算。'" type="info" :closable="false" />
      <p v-if="result.pending_incoming_count" class="history-note">另有 {{ result.pending_incoming_count }} 批待本班组接收，尚未计入库存。</p>
      <p v-if="!result.found || !result.groups.length" class="history-prompt">{{ result.found ? '暂无已入账收发记录' : '当前班组未找到该流水号' }}</p>
      <TeamFlowTimeline v-else :history="result" @select="showBatch" />
    </template>
    <MaterialTransferDrawer v-model="batchOpen" :batch-no="batchNo" :trace-scope="{ team_id: teamId }" @changed="live.request" />
  </section>
</template>

<style scoped>
.serial-history { padding-top: 22px; flex: 0 0 auto; min-width: 0; color: #24324a; }
.history-header { display: flex; align-items: center; flex-wrap: wrap; gap: 14px 24px; margin-bottom: 18px; }
.history-header h2 { margin: 0; font-size: 27px; font-weight: 600; letter-spacing: -.025em; white-space: nowrap; }
.history-search { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.history-search > .el-input { width: 278px; }.history-search :deep(.el-input__wrapper), .history-search :deep(.el-button) { min-height: 42px; font-size: 15px; }
.history-total { display: flex; align-items: center; gap: 12px; margin-left: auto; white-space: nowrap; }.history-total > span { color: #63728c; font-size: 13px; }.history-total strong { font-size: 21px; font-weight: 600; font-variant-numeric: tabular-nums; }.history-total small { font-size: 14px; font-weight: 400; }.history-total i { margin-inline: 10px; font-weight: 300; color: #b2bccb; font-style: normal; }
.history-note { margin: 0 0 12px; color: #77849b; font-size: 13px; }.serial-history > .el-alert { margin-bottom: 12px; }
.history-prompt { padding: 90px 16px; text-align: center; color: #7c899f; font-size: 15px; }.history-prompt > svg { width: 42px; color: #9daac1; }.history-prompt h3 { color: #4c5d76; font-size: 22px; font-weight: 500; }
@media(max-width: 1250px) { .history-header { gap: 12px; }.history-header h2 { font-size: 24px; }.history-search > .el-input { width: 230px; }.history-total { margin-left: 0; } }
@media(max-width: 760px) { .history-search { width: 100%; }.history-search > .el-input { width: 100%; }.history-total { margin-left: auto; }.history-header h2 { font-size: 23px; } }
</style>

<script setup lang="ts">
import { Connection, Search } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElInput } from 'element-plus'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import SerialBatchGraph from '@/components/SerialBatchGraph.vue'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import SerialUrgencyBadge from '@/components/SerialUrgencyBadge.vue'
import StatePanel from '@/components/StatePanel.vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { materialTransferApi } from '@/services/materialTransferApi'
import { historyNumber as num } from '@/utils/serialHistoryChart'
import type { MaterialTrace, TraceBatch } from '@/types/materialTrace'
import type { CalendarRange } from '@/types/recordFilters'

const route = useRoute(), router = useRouter()
const serialDraft = ref(''), searchedSerial = ref(''), result = ref<MaterialTrace | null>(null)
const loading = ref(false), errorMessage = ref(''), drawerOpen = ref(false), selected = ref<TraceBatch | null>(null)
const focusTeam = ref<number | null>(null)
const dates = computed<CalendarRange>(() => ({ from: typeof route.query.date_from === 'string' ? route.query.date_from : '', to: typeof route.query.date_to === 'string' ? route.query.date_to : '' }))
const teams = computed(() => {
  const entries = new Map<string, { id: string | number; name: string }>()
  for (const batch of result.value?.items || []) {
    for (const team of [batch.source_team, batch.next_team]) if (Number(team.id) > 0) entries.set(String(team.id), team)
  }
  return [...entries.values()]
})
const metrics = [
  { key: 'on_hand', label: '当前在库' },
  { key: 'in_transit', label: '内部在途' },
  { key: 'external_pending', label: '对外待确认' },
  { key: 'lost', label: '累计丢失' },
] as const
let epoch = 0

async function load(background = false) {
  if (!searchedSerial.value) return
  const current = ++epoch
  const serialNo = searchedSerial.value
  if (!background) { loading.value = true; result.value = null; drawerOpen.value = false; focusTeam.value = null }
  errorMessage.value = ''
  try {
    const data = await materialTransferApi.trace(serialNo)
    if (current !== epoch) return
    result.value = data
    if (focusTeam.value && !data.positions.some(position => position.team_id === focusTeam.value)) focusTeam.value = null
  } catch (error) {
    if (current !== epoch) return
    if (background) throw error
    errorMessage.value = error instanceof Error ? error.message : '流水号查询失败'
  } finally { if (current === epoch) loading.value = false }
}
function search() {
  if (!serialDraft.value.trim()) { errorMessage.value = '请输入完整流水号'; return }
  searchedSerial.value = serialDraft.value.trim()
  void router.replace({ path: route.path, query: { ...route.query, serial_no: searchedSerial.value } })
  void load()
}
function openTransfer(batch: TraceBatch) { selected.value = batch; drawerOpen.value = true }
function openTeam(teamId: number | string) {
  void router.push({ path: '/team-workspaces/' + teamId, query: { tab: 'history', serial_no: searchedSerial.value } })
}
const liveRefresh = useLiveRefresh(() => load(true), {
  enabled: () => Boolean(searchedSerial.value) && route.query.team_id === undefined,
  busy: () => loading.value || drawerOpen.value,
})

// Old team-scoped links keep their scope by opening the dedicated team page.
// They must never silently become an unrestricted full-chain query.
watch(() => [route.query.serial_no, route.query.team_id, route.query.direction], () => {
  if (route.path !== '/material-trace') return
  if (route.query.team_id !== undefined) {
    ++epoch; result.value = null; loading.value = false; searchedSerial.value = ''
    const teamId = route.query.team_id
    if (typeof teamId !== 'string' || !/^\d+$/.test(teamId) || !Number.isSafeInteger(Number(teamId)) || Number(teamId) < 1) {
      errorMessage.value = '无效的班组范围，请从班组工作台重新打开收发历史'
      return
    }
    const { team_id: _teamId, ...query } = route.query
    void router.replace({ path: '/team-workspaces/' + teamId, query: { ...query, tab: 'history' } })
    return
  }
  const next = typeof route.query.serial_no === 'string' ? route.query.serial_no.trim() : ''
  if (next === searchedSerial.value) return
  ++epoch; result.value = null; loading.value = false; errorMessage.value = ''; drawerOpen.value = false
  serialDraft.value = next; searchedSerial.value = next
  if (next) void load()
}, { immediate: true })
onBeforeUnmount(() => { ++epoch })
</script>

<template>
  <section class="page workspace-page material-trace-page reading-workspace">
    <header class="trace-page-heading"><div><h1>全链路追踪</h1><p>一个流水号，查看全部批次的来源、分流与当前结存。</p></div><ElDropdown v-if="teams.length" trigger="click" @command="openTeam"><ElButton :icon="Connection">查看班组收发</ElButton><template #dropdown><ElDropdownMenu><ElDropdownItem v-for="team in teams" :key="team.id" :command="team.id">{{ team.name }}</ElDropdownItem></ElDropdownMenu></template></ElDropdown></header>
    <form class="trace-search" @submit.prevent="search"><ElInput v-model="serialDraft" :prefix-icon="Search" autocomplete="off" clearable placeholder="输入完整流水号" maxlength="80" aria-label="流水号" /><ElButton type="primary" native-type="submit" :loading="loading">查询</ElButton></form>
    <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
    <StatePanel v-if="loading" class="trace-state" state="loading" title="正在查询完整批次链路" />
    <StatePanel v-else-if="errorMessage" class="trace-state" state="error" :description="errorMessage" @retry="search" />
    <div v-else-if="!result" class="trace-welcome"><Connection /><h2>物料从哪里来，现在在哪里</h2><p>输入完整流水号，展开真实的批次流向。</p></div>
    <StatePanel v-else-if="!result.items.length" class="trace-state" state="empty" title="未找到该流水号" description="请核对完整编号，前导零需要保留。" />
    <div v-else class="trace-result">
      <header class="trace-identity"><div><span>流水号</span><h2>{{ result.serial_no }}</h2><SerialUrgencyBadge :urgency="result.items[0]?.urgency" /></div><span>{{ result.items.length }} 个批次 · 全部班组</span></header>
      <div class="trace-metrics" aria-label="该流水号全厂实时数量"><div v-for="metric in metrics" :key="metric.key"><span>{{ metric.label }}</span><strong>{{ num(result.totals[metric.key].quantity) }} <small>件</small><i>/</i>{{ num(result.totals[metric.key].weight) }} <small>kg</small></strong></div></div>
      <ElAlert v-if="result.untracked_count" :title="result.untracked_count + ' 个历史接收批次未纳入库存台账，仍保留链路，不计入当前在库。'" type="info" :closable="false" />
      <div class="trace-locations"><span>在库分布</span><button v-for="position in result.positions" :key="position.team_id" :aria-pressed="focusTeam === position.team_id" @click="focusTeam = focusTeam === position.team_id ? null : position.team_id"><b>{{ position.team_name }}</b>{{ num(position.quantity) }} 件 / {{ num(position.weight) }} kg</button><span v-if="!result.positions.length">暂无在库余量</span><button v-if="focusTeam" class="clear-focus" @click="focusTeam = null">取消高亮</button></div>
      <header class="chain-heading"><div><h3>批次流向</h3><span>按真实来源连接，不按固定工序排列</span></div><RecordDateFilter :model-value="dates" label="高亮日期" @update:model-value="router.replace({ path: route.path, query: { ...route.query, date_from: $event.from || undefined, date_to: $event.to || undefined } })" /></header>
      <SerialBatchGraph class="trace-chain" :items="result.items" :dates="dates" :focus-team="focusTeam" @select="openTransfer" />
      <footer class="trace-footnote"><span>当前在库不含已转出待确认物料；日期仅高亮批次，不截断来源。</span><span>累计对外出库 {{ num(result.totals.dispatched.quantity) }} 件 / {{ num(result.totals.dispatched.weight) }} kg</span></footer>
    </div>
    <MaterialTransferDrawer v-model="drawerOpen" :batch-no="selected?.batch_no" @changed="liveRefresh.request" />
  </section>
</template>

<style scoped>
.material-trace-page { background: #fff; }
.trace-page-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 18px; margin-bottom: 28px; }.trace-page-heading h1 { margin: 0 0 10px; color: #24324a; font-size: 28px; font-weight: 600; }.trace-page-heading p { margin: 0; color: #7b879a; font-size: 14px; }
.trace-search { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 28px; }.trace-search > .el-input { max-width: 420px; }.trace-search :deep(.el-input__wrapper), .trace-search :deep(.el-button) { min-height: 42px; font-size: 16px; }
.trace-welcome { text-align: center; padding: 100px 20px; color: #8491a5; }.trace-welcome svg { width: 50px; color: #a6b4cc; }.trace-welcome h2 { color: #4d5f7a; font-weight: 500; font-size: 24px; }.trace-welcome p { font-size: 15px; }.trace-state { min-height: 300px; }.trace-result { min-width: 0; }
.trace-identity { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 22px; color: #8490a2; font-size: 14px; }.trace-identity > div { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }.trace-identity h2 { margin: 0; color: #24324a; font-size: 24px; font-weight: 600; overflow-wrap: anywhere; }
.trace-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 22px 0; border-block: 1px solid #e8edf4; margin-bottom: 20px; }.trace-metrics > div { display: grid; gap: 12px; padding: 0 26px; border-left: 1px solid #e8edf4; }.trace-metrics > div:first-child { padding-left: 0; border-left: 0; }.trace-metrics span { color: #78879c; font-size: 14px; }.trace-metrics strong { color: #2c3d58; font-size: 25px; font-weight: 600; font-variant-numeric: tabular-nums; }.trace-metrics small { color: #8b96a8; font-size: 13px; font-weight: 400; }.trace-metrics i { margin-inline: 8px; font-style: normal; font-weight: 300; color: #c6cdda; }
.trace-locations { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 20px 0 30px; font-size: 14px; }.trace-locations > span { color: #7c899d; margin-right: 8px; }.trace-locations button { display: flex; gap: 9px; border: 1px solid #e5eaf2; border-radius: 6px; background: #fff; color: #718099; padding: 9px 13px; font: inherit; cursor: pointer; }.trace-locations b { font-weight: 500; color: #3c4f6c; }.trace-locations button[aria-pressed=true] { border-color: #8f9ebd; background: #f3f6fb; }.trace-locations .clear-focus { border-color: transparent; }
.chain-heading, .chain-heading > div { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }.chain-heading { justify-content: space-between; gap: 18px; margin-bottom: 16px; }.chain-heading h3 { font-size: 20px; font-weight: 600; color: #334761; margin: 0; }.chain-heading span { font-size: 13px; color: #8995a7; }.trace-footnote { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; margin-top: 18px; font-size: 13px; color: #7a889d; line-height: 1.8; }
@media(max-width: 1250px) { .trace-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 0; }.trace-metrics > div:nth-child(3) { border-left: 0; padding-left: 0; } }
@media(max-width: 600px) { .trace-identity { align-items: flex-start; flex-direction: column; }.trace-metrics > div { padding-inline: 12px; }.trace-metrics strong { font-size: 20px; }.trace-metrics i { margin-inline: 5px; } }
</style>

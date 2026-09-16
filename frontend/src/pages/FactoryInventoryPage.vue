<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ElAlert, ElButton, ElIcon, ElTag } from 'element-plus'
import { ArrowRight, Flag, Refresh, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import StatePanel from '@/components/StatePanel.vue'
import SpotlightCard from '@/components/motion/SpotlightCard.vue'
import StarBorder from '@/components/motion/StarBorder.vue'
import InventoryAmbient from '@/components/motion/InventoryAmbient.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import type { FactoryOverview, FactoryTeam } from '@/types/factoryOverview'

const report = ref<FactoryOverview | null>(null), loading = ref(false), error = ref('')
const connection = ref<InventoryConnection>('connecting')
const connectionLabel = computed(() => ({ connecting: '正在连接实时数据', live: '实时同步', reconnecting: '连接中断，正在重连', expired: '登录或访问凭证已失效' })[connection.value])
const hidden = ref(document.hidden), reduced = ref(false), paused = ref(false)
const changedTeams = ref<string[]>([])
const motion = computed(() => !hidden.value && !reduced.value && !paused.value && !error.value)
const summaryItems = [{ key: 'on_hand', label: '全厂在库', image: 'stock-v2' }, { key: 'in_transit', label: '内部在途', image: 'transit' }] as const
const teamImages: Record<string, string> = {
  'FACTORY-WAREHOUSE': 'warehouse', 'FACTORY-ROLL': 'rolling', 'FACTORY-ANNEAL': 'annealing', 'FACTORY-GRIND': 'grinding',
  'FACTORY-WIRE': 'wire', 'FACTORY-ENGRAVE': 'engraving', 'FACTORY-PLATE': 'plating', 'FACTORY-QC': 'inspection',
}
const updatedAt = computed(() => report.value ? new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, timeZone: 'Asia/Shanghai',
}).format(new Date(report.value.as_of)).replaceAll('/', '-') : '—')
let version = 0, unsubscribe: (() => void) | undefined, changeTimer: ReturnType<typeof setTimeout> | undefined
let media: MediaQueryList | undefined
const warning = computed(() => {
  if (!report.value) return ''
  const missing = report.value.teams.filter(team => !team.id).map(team => team.name)
  const inactive = report.value.teams.filter(team => team.id && !team.active).map(team => team.name)
  return [missing.length ? `未配置：${missing.join('、')}，汇总范围不完整` : '', inactive.length ? `停用班组仍保留库存：${inactive.join('、')}` : '', report.value.legacy_received_count ? `${report.value.legacy_received_count} 条历史接收未纳入库存` : ''].filter(Boolean).join('；')
})
function fingerprint(team: FactoryTeam) {
  return JSON.stringify([team.balance?.on_hand_quantity, team.balance?.on_hand_weight, team.serial_count, team.urgent_serial_count,
    team.pending_incoming?.batches, team.pending_incoming?.quantity, team.pending_incoming?.weight])
}
function clearChanges() { if (changeTimer) clearTimeout(changeTimer); changedTeams.value = [] }
function acceptReport(next: FactoryOverview) {
  clearChanges()
  if (report.value && motion.value) {
    const previous = new Map(report.value.teams.map(team => [team.code, fingerprint(team)]))
    changedTeams.value = next.teams.filter(team => previous.has(team.code) && previous.get(team.code) !== fingerprint(team)).map(team => team.code)
    if (changedTeams.value.length) changeTimer = setTimeout(clearChanges, 1400)
  }
  report.value = next; error.value = ''; loading.value = false
}
function load() {
  const current = ++version
  unsubscribe?.()
  unsubscribe = factoryOverviewApi.subscribe({
    onData(next) { if (current === version) acceptReport(next) },
    onState(state) {
      if (current !== version) return
      connection.value = state
      loading.value = state === 'connecting'
      if (state === 'live') error.value = ''
      if (state === 'reconnecting' || state === 'expired') {
        clearChanges()
        error.value = report.value ? '实时连接中断，当前显示上次成功读取的数据。' : '库存数据连接失败，正在自动重连。'
        if (state === 'expired') error.value = '登录或访问凭证已失效，请重新验证。'
      }
    },
  })
}
function syncMotion() { reduced.value = Boolean(media?.matches); if (reduced.value) clearChanges() }
function syncVisibility() {
  hidden.value = document.hidden
  if (hidden.value) { ++version; unsubscribe?.(); unsubscribe = undefined; clearChanges() }
  else load()
}
function teamLink(team: FactoryTeam, tab = 'stock') { return { path: `/team-workspaces/${team.id}`, query: { tab } } }
onMounted(() => {
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)'); syncMotion()
  media?.addEventListener('change', syncMotion)
  document.addEventListener('visibilitychange', syncVisibility)
  if (!document.hidden) load()
})
onBeforeUnmount(() => {
  ++version; unsubscribe?.(); clearChanges()
  media?.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility)
})
</script>
<template>
  <section class="page factory-inventory" :class="{ 'factory-inventory--still': !motion }" aria-label="全厂库存总览">
    <InventoryAmbient :animate="motion" />
    <div class="inventory-content">
    <header class="inventory-heading">
      <h1>全厂库存总览</h1>
      <div class="inventory-actions">
        <ElButton :icon="Refresh" :loading="loading" @click="load">刷新</ElButton>
        <ElButton class="motion-toggle" :icon="paused ? VideoPlay : VideoPause" :disabled="reduced" :aria-pressed="paused" :aria-label="reduced ? '系统已减少动画' : paused ? '开启动效' : '暂停动效'" @click="paused = !paused">{{ paused ? '播放' : '暂停' }}</ElButton>
      </div>
    </header>
    <ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon />
    <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
    <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!report" state="loading" title="正在读取库存" />
    <template v-else>
      <section class="inventory-summary" aria-label="全厂库存汇总">
        <div v-for="item in summaryItems" :key="item.key" class="summary-group">
          <img class="summary-icon" :src="`/assets/factory-inventory/${item.image}.png`" alt="" width="106" height="106" />
          <div class="summary-copy"><h2>{{ item.label }}</h2>
          <div class="summary-amount"><span class="summary-quantity"><strong class="inventory-number"><AnimatedMetric :value="report.totals[`${item.key}_quantity`]" :animate="motion" :precision="0" /></strong><span>件</span></span><span class="summary-weight"><span class="summary-divider">/</span><b class="inventory-number"><AnimatedMetric :value="report.totals[`${item.key}_weight`]" :animate="motion" :precision="3" /></b><span>kg</span></span></div></div>
        </div>
      </section>
      <section class="inventory-teams" aria-labelledby="inventory-teams-title">
        <header class="inventory-section-heading"><h2 id="inventory-teams-title">班组库存</h2><span>共 {{ report.teams.length }} 个班组</span></header>
        <div class="inventory-grid">
          <div v-for="(team, index) in report.teams" :key="team.code" class="inventory-card-arrival" :style="{ '--arrival-delay': `${index * 45}ms` }">
            <SpotlightCard :enabled="motion && Boolean(team.id)" class="inventory-card" :class="{ 'inventory-card--changed': changedTeams.includes(team.code) }" :aria-label="`${team.name}库存`" :data-team-code="team.code">
              <header class="inventory-card-heading">
                <div class="team-identity"><img class="team-symbol" :src="`/assets/factory-inventory/${teamImages[team.code]}-v2.png`" alt="" width="82" height="82" /><h3>{{ team.name }}</h3></div>
                <ElTag v-if="!team.id || !team.active" type="info" effect="plain">{{ team.id ? '已停用' : '未配置' }}</ElTag>
                <StarBorder v-else-if="team.urgent_serial_count" :paused="!motion" :title="`${team.urgent_serial_count} 个在库加急流水号`"><ElIcon aria-hidden="true"><Flag /></ElIcon>加急 <AnimatedMetric :value="team.urgent_serial_count" :animate="motion" :precision="0" /></StarBorder>
              </header>
              <div class="inventory-card-stock">
                <span class="stock-label">当前库存</span>
                <div class="stock-quantity"><strong class="inventory-number"><AnimatedMetric :value="team.balance?.on_hand_quantity ?? null" :animate="motion" :precision="0" /></strong><span>件</span></div>
                <div class="stock-weight"><span class="inventory-number"><AnimatedMetric :value="team.balance?.on_hand_weight ?? null" :animate="motion" :precision="3" /></span><span>kg</span></div>
              </div>
              <div class="inventory-card-pending">
                <div class="pending-heading"><span>待接收</span><RouterLink v-if="team.id && team.active && team.pending_incoming?.batches" :to="teamLink(team, 'pending')" :aria-label="`查看${team.name}待接收`"><AnimatedMetric :value="team.pending_incoming.batches" :animate="motion" :precision="0" /> 批</RouterLink><span v-else class="pending-zero"><AnimatedMetric :value="team.pending_incoming?.batches ?? null" :animate="motion" :precision="0" /> 批</span></div>
                <div class="pending-amount"><AnimatedMetric :value="team.pending_incoming?.quantity ?? null" :animate="motion" :precision="0" /> 件<span>/</span><AnimatedMetric :value="team.pending_incoming?.weight ?? null" :animate="motion" :precision="3" /> kg</div>
              </div>
              <footer class="inventory-card-footer"><span><AnimatedMetric :value="team.serial_count ?? null" :animate="motion" :precision="0" /> 个在库流水号</span><RouterLink v-if="team.id && team.active" :to="teamLink(team)" :aria-label="`查看${team.name}库存明细`">查看明细<ElIcon><ArrowRight /></ElIcon></RouterLink><span v-else>暂不可进入</span></footer>
            </SpotlightCard>
          </div>
        </div>
      </section>
      <footer class="inventory-footer"><span>当前库存不含在途物料</span><div><span role="status">{{ connectionLabel }}</span><time :datetime="report.as_of">更新于 {{ updatedAt }}</time><RouterLink to="/factory-analysis">数据分析<ElIcon><ArrowRight /></ElIcon></RouterLink></div></footer>
    </template>
    </div>
  </section>
</template>
<style scoped>
.factory-inventory {
  --inventory-ink: #211a32;
  --inventory-muted: #70647f;
  position: relative; isolation: isolate; container-type: inline-size;
  padding: 24px 26px 28px; background: #fcfbfe; color: var(--inventory-ink);
  font-family: 'HeatSink Han', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px; font-synthesis: none;
}
.inventory-content { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; max-width: 1920px; margin-inline: auto; }
.inventory-heading, .inventory-section-heading, .inventory-card-heading, .inventory-card-footer, .inventory-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.inventory-heading { min-height: 44px; }
.inventory-heading h1 { margin: 0; font-size: 36px; line-height: 44px; font-weight: 700; letter-spacing: .01em; }
.inventory-actions { display: flex; gap: 12px; }
.inventory-actions .el-button { margin: 0; height: 46px; padding-inline: 18px; font: inherit; font-weight: 500; border-radius: 9px; color: #574171; border-color: #e0d5ee; background: rgb(255 255 255 / 90%); box-shadow: inset 0 1px 1px #fff, 0 3px 10px rgb(102 70 146 / 9%); }
.inventory-actions .motion-toggle { color: #fff; border-color: #9673ff; background: #7950ff; box-shadow: inset 0 3px 9px rgb(255 255 255 / 36%), 0 4px 12px rgb(116 74 225 / 22%); }
.inventory-actions .el-button:hover { border-color: #835aff; }
.inventory-actions .motion-toggle:hover { background: #6d41ee; }
.inventory-actions .motion-toggle.is-disabled { opacity: .55; }
.inventory-number { font-family: 'HeatSink Inter', 'HeatSink Han', sans-serif; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; letter-spacing: -.035em; }
.inventory-summary { display: grid; grid-template-columns: minmax(0, 47fr) minmax(0, 53fr); min-height: 130px; padding: 11px 28px; border: 1px solid rgb(255 255 255 / 96%); border-radius: 16px; background: linear-gradient(112deg, rgb(243 235 253 / 30.8%), rgb(255 255 255 / 80.4%) 48%, rgb(237 225 251 / 22.4%)); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: inset 0 2px 2px #fff, inset 0 -1px 1px rgb(255 255 255 / 85%), 0 7px 18px rgb(103 75 141 / 12%); }
.summary-group { display: flex; align-items: center; gap: 20px; min-width: 0; padding-inline: 0 20px; }
.summary-group + .summary-group { border-left: 1px solid #dacbe9; padding-inline: 58px 0; }
.summary-icon { flex: 0 0 106px; width: 106px; height: 106px; object-fit: contain; }
.summary-copy { min-width: 0; }
.summary-group h2 { font-size: 20px; font-weight: 500; line-height: 28px; margin: 0 0 2px; color: var(--inventory-ink); }
.summary-amount { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; row-gap: 2px; }
.summary-quantity, .summary-weight { display: inline-flex; align-items: baseline; gap: 8px; white-space: nowrap; }
.summary-amount strong { color: #692ad6; font-size: 46px; font-weight: 700; line-height: 1.16; }
.summary-group + .summary-group .summary-amount strong { color: #8650c5; }
.summary-amount b { font-size: 23px; font-weight: 600; white-space: nowrap; }
.summary-amount > span { font-size: 20px; }
.summary-divider { color: #8b7b9c; padding-inline: 2px; }
.inventory-teams { min-width: 0; }
.inventory-section-heading { margin-bottom: 14px; }
.inventory-section-heading h2 { margin: 0; font-size: 24px; line-height: 30px; font-weight: 650; }
.inventory-section-heading > span { color: var(--inventory-muted); font-size: 16px; }
.inventory-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px 18px; }
.inventory-card-arrival { min-width: 0; animation: inventory-arrive 420ms cubic-bezier(.2,.7,.3,1) var(--arrival-delay) both; }
.inventory-card {
  --glass-rim: inset 0 2px 2px rgb(255 255 255 / 98%), inset 2px 0 3px rgb(255 255 255 / 75%), inset 0 -2px 3px rgb(255 255 255 / 70%), inset -1px 0 1px #fff;
  height: 100%; min-height: 328px; padding: 12px 20px 16px;
  border: 1px solid rgb(255 255 255 / 96%); border-radius: 16px;
  background: linear-gradient(132deg, rgb(255 255 255 / 88%), rgb(240 231 250 / 16.8%) 52%, rgb(255 255 255 / 76%));
  -webkit-backdrop-filter: blur(14px) saturate(115%); backdrop-filter: blur(14px) saturate(115%);
  box-shadow: var(--glass-rim), 0 6px 18px rgb(104 78 139 / 11%);
  transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
}
.inventory-card:hover { border-color: #fff; }
.inventory-card:focus-within { border-color: #9573ff; }
.inventory-card-heading { position: relative; min-height: 76px; margin-bottom: 4px; gap: 4px; }
.team-identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.inventory-card-heading h3 { margin: 0; font-size: 22px; line-height: 30px; font-weight: 650; white-space: nowrap; }
.team-symbol { flex: 0 0 82px; width: 82px; height: 76px; object-fit: contain; margin-left: -4px; }
.inventory-card[data-team-code="FACTORY-ANNEAL"] .team-symbol { transform: scale(1.12); }
.inventory-card[data-team-code="FACTORY-ENGRAVE"] .team-symbol { transform: scale(1.24); }
.inventory-card-heading > :not(.team-identity) { position: absolute; top: 0; right: -8px; font-size: 12px; }
.inventory-card-stock { display: flex; flex-direction: column; gap: 0; }
.stock-label { color: var(--inventory-muted); font-size: 18px; line-height: 24px; }
.stock-quantity { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; }
.stock-quantity strong { font-size: 44px; line-height: 50px; font-weight: 700; overflow-wrap: anywhere; }
.stock-quantity > span { font-size: 20px; font-weight: 500; }
.stock-weight { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; color: var(--inventory-muted); font-size: 22px; line-height: 26px; font-weight: 450; }
.stock-weight > span:last-child { font-size: 18px; }
.inventory-card-pending { margin-top: 10px; padding: 8px 14px; background: rgb(255 247 235 / 65%); border: 1px solid rgb(255 255 255 / 96%); border-radius: 10px; box-shadow: inset 0 1px 0 #fff; }
.pending-heading { display: flex; align-items: baseline; gap: 10px; color: var(--inventory-muted); font-size: 18px; line-height: 26px; }
.pending-heading a { color: #b95208; font-size: 19px; font-weight: 600; }
.pending-zero { color: var(--inventory-muted); font-size: 19px; }
.pending-amount { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; color: var(--inventory-muted); font-size: 17px; line-height: 24px; font-variant-numeric: tabular-nums; }
.inventory-card-footer { flex-wrap: wrap; margin-top: 14px; min-height: 24px; gap: 4px 8px; color: var(--inventory-muted); font-size: 14px; line-height: 24px; }
.inventory-card-footer a, .inventory-footer a { display: inline-flex; align-items: center; gap: 6px; color: #692ad6; white-space: nowrap; }
.factory-inventory a { text-decoration: none; }
.factory-inventory a:hover { text-decoration: underline; text-underline-offset: 4px; }
.factory-inventory a:focus-visible { outline: 2px solid #7651de; outline-offset: 4px; border-radius: 2px; }
.inventory-footer { margin-top: 8px; flex-wrap: wrap; color: var(--inventory-muted); font-size: 14px; line-height: 24px; }
.inventory-footer > div { display: flex; align-items: center; flex-wrap: wrap; gap: 18px; }
.inventory-card--changed { animation: inventory-updated 1400ms ease-out; }
@keyframes inventory-arrive { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes inventory-updated { 0%, 20% { border-color: #b5a8e4; box-shadow: var(--glass-rim), 0 0 0 3px rgb(101 80 237 / 12%), 0 12px 26px rgb(104 78 139 / 10%); } }
@media (hover: hover) and (prefers-reduced-motion: no-preference) { .factory-inventory:not(.factory-inventory--still) .inventory-card:hover { transform: translateY(-2px); box-shadow: var(--glass-rim), 0 12px 24px rgb(104 78 139 / 16%); } }
.factory-inventory--still .inventory-card-arrival { animation: none; }
.factory-inventory--still .inventory-card { animation: none; transition: none; }
@container (max-width: 1080px) {
  .inventory-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary-group { gap: 12px; padding-inline: 0 16px; }
  .summary-group + .summary-group { padding-left: 20px; }
  .summary-icon { width: 82px; height: 82px; flex-basis: 82px; }
  .summary-amount strong { font-size: 38px; }
}
@container (max-width: 680px) {
  .inventory-summary { grid-template-columns: 1fr; gap: 16px; padding: 20px; }
  .summary-group + .summary-group { border-left: none; border-top: 1px solid #dacbe9; padding: 16px 0 0; }
  .summary-group { padding: 0; }
  .summary-weight { flex-basis: 100%; }
  .summary-divider { display: none; }
  .inventory-heading { align-items: flex-start; flex-wrap: wrap; }
  .inventory-footer > div { gap: 8px 14px; }
}
@container (max-width: 559px) {
  .inventory-grid { grid-template-columns: minmax(0, 1fr); }
  .inventory-card { padding-inline: 22px; }
}
@media (max-width: 640px) {
  .factory-inventory { padding: 20px 18px 28px; }
  .inventory-content { gap: 20px; }
  .inventory-heading h1 { font-size: 28px; line-height: 38px; }
  .inventory-actions .el-button { height: 42px; padding-inline: 14px; font-size: 15px; }
}
@media (prefers-reduced-motion: reduce) { .inventory-card-arrival, .inventory-card { animation: none; transition: none; } }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .inventory-card, .inventory-summary { background: #fcfaff; } }
</style>

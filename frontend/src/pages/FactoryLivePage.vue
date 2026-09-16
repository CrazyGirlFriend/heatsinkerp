<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert, ElButton, ElIcon, ElProgress, ElSwitch, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { FullScreen, Close, Refresh, VideoPause, VideoPlay, ArrowLeft, ArrowRight, DataAnalysis, Box, SoldOut, CircleCheck, Bell, Goods } from '@element-plus/icons-vue'
import FactoryRobot from '@/components/FactoryRobot.vue'
import LiveTeamCard from '@/components/LiveTeamCard.vue'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import { liveBatchStatus, liveParties, liveMaterial, liveWaiting, liveLook, liveWindow } from '@/utils/factoryLive'
import { formatDateTime } from '@/utils/format'
import { showToast } from '@/stores/toast'
import { factoryScreenLayout } from '@/utils/factoryScreen'
import type { FactoryLive, LiveBatch, LiveTeam } from '@/types/factoryLive'

const router = useRouter(), root = ref<HTMLElement>()
const layout = ref(factoryScreenLayout(1672, 940)), deviceRatio = ref(window.devicePixelRatio || 1)
const narrow = computed(() => layout.value.narrow)
let resize: ResizeObserver | undefined
const boardStyle = computed(() => narrow.value ? {} : {
  width: layout.value.width + 'px', height: layout.value.height + 'px', transform: 'scale(' + layout.value.scale + ')',
})
function fitBoard() {
  if (!root.value) return
  layout.value = factoryScreenLayout(root.value.clientWidth, root.value.clientHeight)
  deviceRatio.value = window.devicePixelRatio || 1
}
const report = ref<FactoryLive | null>(null), loading = ref(false), error = ref(''), fullscreen = ref(false)
const connection = ref<InventoryConnection>('connecting')
const connectionLabel = computed(() => ({ connecting: '正在连接', live: '实时同步', reconnecting: '连接中断，正在重连', expired: '登录或访问凭证已失效' })[connection.value])
let unsubscribe: (() => void) | undefined, streamVersion = 0
const playing = ref(true), hidden = ref(document.hidden), reduced = ref(false)
const hovered = ref(false), focused = ref(false), cursor = ref(0), elapsed = ref(0), now = ref(Date.now())
const changed = ref(new Set<string>())
let version = 0, timer: ReturnType<typeof setInterval> | undefined, media: MediaQueryList | undefined
let highlightTimer: ReturnType<typeof setTimeout> | undefined
const deferred = ref<FactoryLive | null>(null), rows = ref<LiveBatch[]>([])
const reading = computed(() => hovered.value || focused.value)
const moving = computed(() => playing.value && !hidden.value && !reduced.value && !error.value && !reading.value && Boolean(rows.value.length))
const visibleBatches = computed(() => liveWindow(rows.value, cursor.value, 8))
// One source of truth: robot, team highlights and broadcast always follow row one.
const selected = computed(() => visibleBatches.value[0])
const activityKey = computed(() => selected.value && selected.value.status !== 'voided' ? [selected.value.batch_no, selected.value.status, selected.value.updated_at].join(':') : '')
const parties = computed(() => selected.value ? liveParties(selected.value) : null)
const look = computed(() => liveLook(selected.value?.target_id ?? null, report.value?.teams || []))
const groups = computed(() => [report.value?.teams.slice(0, 4) || [], report.value?.teams.slice(4, 8) || []])
const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const asBatch = (row: unknown) => row as LiveBatch
const statusType = (row: LiveBatch) => row.status === 'voided' ? 'info' : row.status === 'pending' || row.status === 'partial' ? 'warning' : 'success'
const warning = computed(() => {
  if (!report.value) return ''
  const missing = report.value.teams.filter(team => !team.id).map(team => team.name)
  const inactive = report.value.teams.filter(team => team.id && !team.active).map(team => team.name)
  return [missing.length ? '未配置：' + missing.join('、') : '', inactive.length ? '已停用：' + inactive.join('、') + '，既有库存仍计入' : '', report.value.legacy_received_count ? report.value.legacy_received_count + ' 条历史接收未纳入库存' : ''].filter(Boolean).join('；')
})
const playbackLabel = computed(() => reduced.value ? '减少动态效果' : error.value ? '更新失败 · 已暂停' : !playing.value ? '轮播已暂停' : reading.value ? '阅读中 · 已暂停' : '每8秒切换 · 首条联动')
const metrics = computed(() => report.value ? [
  { label: '当前在库', hint: `在途 ${number(report.value.totals.in_transit_weight)} kg`, value: report.value.totals.on_hand_weight, unit: 'kg', icon: Goods, tone: '' },
  { label: '今日转出', value: report.value.today.outgoing_quantity, unit: '件', icon: SoldOut, tone: '' },
  { label: '待交接', value: report.value.pending.batches, unit: '批', icon: Box, tone: 'pending' },
  { label: '今日已接收', value: report.value.today.received_batches, unit: '批', icon: CircleCheck, tone: 'received' },
] : [])
function applyReport(value: FactoryLive) {
  const previous = new Map(rows.value.map(row => [row.batch_no, row]))
  const code = selected.value?.batch_no
  const newestChanged = rows.value[0]?.batch_no !== value.recent_batches[0]?.batch_no
  changed.value = previous.size ? new Set(value.recent_batches.filter(row => {
    const old = previous.get(row.batch_no)
    return !old || old.updated_at !== row.updated_at || old.status !== row.status
  }).map(row => row.batch_no)) : new Set()
  report.value = value
  rows.value = value.recent_batches
  cursor.value = newestChanged ? 0 : Math.max(0, rows.value.findIndex(row => row.batch_no === code))
  if (newestChanged) elapsed.value = 0
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => { changed.value = new Set() }, 2500)
}
async function load(manual = false) {
  const current = ++version; loading.value = true
  try {
    const value = await factoryLiveApi.get()
    if (current !== version) return
    error.value = ''
    // Do not move a row under someone's pointer or keyboard on automatic refresh.
    if (report.value && !manual && (reading.value || !playing.value)) { report.value = value; deferred.value = value }
    else { deferred.value = null; applyReport(value) }
  } catch { if (current === version) error.value = report.value ? '更新失败，保留上次成功数据。' : '物料状态加载失败，请重试。' }
  finally { if (current === version) loading.value = false }
}
function connect() {
  const current = ++streamVersion
  unsubscribe?.()
  unsubscribe = factoryLiveApi.subscribe({
    onData(value) {
      if (current !== streamVersion) return
      ++version // A late manual read must not overwrite a newer pushed snapshot.
      loading.value = false; error.value = ''
      if (report.value && (reading.value || !playing.value)) { report.value = value; deferred.value = value }
      else { deferred.value = null; applyReport(value) }
    },
    onState(state) {
      if (current !== streamVersion) return
      connection.value = state
      if (state === 'reconnecting' || state === 'expired') {
        error.value = state === 'expired' ? '登录或访问凭证已失效，请重新验证。' : report.value ? '连接中断，保留上次成功数据，正在重连。' : '物料状态加载失败，正在重连。'
      }
    },
  })
}
watch([playing, reading], () => { if (playing.value && !reading.value && deferred.value) { const value = deferred.value; deferred.value = null; applyReport(value) } })
function next(direction = 1, manual = true) {
  if (!rows.value.length) return
  cursor.value = (cursor.value + direction + rows.value.length) % rows.value.length; elapsed.value = 0
  if (manual) playing.value = false
}
function toggleMotion() { playing.value = !playing.value; elapsed.value = 0 }
function syncVisibility() {
  hidden.value = document.hidden
  if (hidden.value) { ++streamVersion; unsubscribe?.(); unsubscribe = undefined }
  else connect()
}
function syncMotion() { reduced.value = Boolean(media?.matches) }
function syncFullscreen() { fullscreen.value = document.fullscreenElement === root.value || document.fullscreenElement === document.documentElement }
async function toggleFullscreen() {
  try { if (fullscreen.value) await document.exitFullscreen(); else await root.value?.requestFullscreen() }
  catch { showToast('未能进入全屏，请使用 Chrome 或 Edge 后重试。', 'error') }
}
async function navigate(path: string) { playing.value = false; if (fullscreen.value) await document.exitFullscreen(); await router.push(path) }
function openTeam(team: LiveTeam) { if (team.id && team.active) void navigate('/team-workspaces/' + team.id + '?tab=stock') }
function openBatch(row: LiveBatch) { void navigate('/transfer-batches/scan?batch_no=' + encodeURIComponent(row.batch_no)) }
function focusOut(event: FocusEvent) { focused.value = Boolean(event.relatedTarget && (event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) }
function rowClass({ row, rowIndex }: { row: LiveBatch; rowIndex: number }) { return [rowIndex === 0 ? 'is-current' : '', changed.value.has(row.batch_no) ? 'is-updated' : ''].join(' ') }
onMounted(() => {
  syncFullscreen()
  fitBoard(); resize = new ResizeObserver(fitBoard); if (root.value) resize.observe(root.value)
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)'); syncMotion(); media?.addEventListener('change', syncMotion)
  document.addEventListener('visibilitychange', syncVisibility); document.addEventListener('fullscreenchange', syncFullscreen)
  window.addEventListener('resize', fitBoard)
  timer = setInterval(() => {
    now.value = Date.now()
    if (moving.value && ++elapsed.value >= 8) next(1, false)
  }, 1000)
  if (!hidden.value) connect()
})
onBeforeUnmount(() => { ++streamVersion; unsubscribe?.(); if (fullscreen.value && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); resize?.disconnect(); ++version; if (timer) clearInterval(timer); if (highlightTimer) clearTimeout(highlightTimer); media?.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility); document.removeEventListener('fullscreenchange', syncFullscreen); window.removeEventListener('resize', fitBoard) })
</script>
<template>
  <section ref="root" class="page factory-live" :class="{ 'factory-live--fullscreen': fullscreen, 'factory-live--paused': !moving, 'factory-live--narrow': narrow }">
    <div class="live-board" :style="boardStyle">
      <header class="live-heading">
        <ElButton class="live-brand" link :icon="DataAnalysis" aria-label="返回系统总览" title="返回系统总览" @click="navigate('/')">热沉物料流转管理</ElButton>
        <h1>物料流转大屏</h1>
        <div class="live-tools"><time>{{ report ? formatDateTime(report.as_of) : '读取状态' }}</time><ElButton circle :icon="Refresh" :loading="loading" aria-label="刷新物料状态" @click="load(true)" /><ElButton round :icon="playing ? VideoPause : VideoPlay" :disabled="reduced" @click="toggleMotion">{{ playing ? '暂停轮播' : '播放轮播' }}</ElButton><ElButton circle :icon="fullscreen ? Close : FullScreen" :aria-label="fullscreen ? '退出全屏' : '全屏展示'" @click="toggleFullscreen" /></div>
      </header>
      <StatePanel v-if="!report" class="live-initial" :state="error ? 'error' : 'loading'" :description="error" title="读取八班组物料状态" @retry="load(true)" />
      <template v-else>
        <section class="live-metrics" aria-label="全厂物料关键数据">
          <article v-for="item in metrics" :key="item.label" :class="item.tone"><ElIcon><component :is="item.icon" /></ElIcon><div><span>{{ item.label }}<small v-if="item.hint" class="transit-hint"> · {{ item.hint }}</small></span><p><strong><AnimatedMetric :value="item.value" :animate="moving" :precision="item.unit === 'kg' ? 3 : 0" /></strong><small>{{ item.unit }}</small></p></div></article>
        </section>
        <section class="flow-layout" aria-label="八班组状态与物料流转">
          <div v-for="(teams, side) in groups" :key="side" class="team-rail" :class="side ? 'team-rail--right' : 'team-rail--left'">
            <LiveTeamCard v-for="(team, index) in teams" :key="team.code" :team="team" :index="index + side * 4" :source="Boolean(team.id && selected?.status !== 'voided' && team.id === selected?.source_id)" :target="Boolean(team.id && selected?.status !== 'voided' && team.id === selected?.target_id)" @open="openTeam" />
          </div>
          <div class="flow-center">
            <div class="robot-stage"><FactoryRobot :paused="!moving" :look="look" :activity-key="activityKey" :display-scale="layout.scale" :device-ratio="deviceRatio" /></div>
            <div class="current-flow" @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focused = true" @focusout="focusOut">
              <template v-if="selected"><div class="current-flow__route"><span :title="parties?.source">{{ parties?.source }}</span><ElIcon><ArrowRight /></ElIcon><span :title="parties?.target">{{ parties?.target }}</span><ElTag round :type="statusType(selected)">{{ liveBatchStatus(selected) }}</ElTag></div><p class="current-flow__amount" :title="liveMaterial(selected)">{{ liveMaterial(selected) }} · {{ number(selected.quantity) }}件 · {{ number(selected.weight) }}kg</p><ElButton link class="current-flow__code" @click="openBatch(selected)">{{ selected.batch_no }}<ElIcon><ArrowRight /></ElIcon></ElButton></template>
              <p v-else>暂无流转记录</p>
            </div>
          </div>
        </section>
        <section class="live-broadcast" aria-label="最近转料播报"><ElIcon><Bell /></ElIcon><strong>最近转料</strong><div class="broadcast-window"><Transition name="broadcast" mode="out-in"><p v-if="selected" :key="activityKey || selected.batch_no">{{ parties?.source }} → {{ parties?.target }}：{{ liveMaterial(selected) }}，{{ number(selected.quantity) }}件 / {{ number(selected.weight) }}kg，{{ liveBatchStatus(selected) }}</p><p v-else>暂无转料记录</p></Transition></div><ElProgress :percentage="elapsed / 8 * 100" :show-text="false" :stroke-width="3" /><span>{{ rows.length ? cursor + 1 : 0 }} / {{ rows.length }}</span></section>
        <section class="live-feed" aria-label="转料动态" @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focused = true" @focusout="focusOut">
          <header><h2>转料动态</h2><span>{{ playbackLabel }}</span><ElSwitch v-model="playing" :disabled="reduced" active-text="自动轮播" aria-label="自动轮播" @change="elapsed = 0" /></header>
          <ElTable :key="selected?.batch_no" :data="visibleBatches" row-key="batch_no" class="live-table" :class="{ 'is-animated': moving }" :row-class-name="rowClass" size="small" height="100%" empty-text="暂无转料记录" @row-click="openBatch">
            <ElTableColumn prop="batch_no" label="批次号" min-width="240" show-overflow-tooltip><template #default="{ row }"><ElButton link class="batch-link" @click.stop="openBatch(asBatch(row))">{{ row.batch_no }}</ElButton><ElTag v-if="row.urgent_serial_count" type="danger" size="small" effect="dark">含加急 {{ row.urgent_serial_count }}</ElTag></template></ElTableColumn>
            <ElTableColumn label="上序 → 下序" min-width="210" show-overflow-tooltip><template #default="{ row }">{{ liveParties(asBatch(row)).source }} → {{ liveParties(asBatch(row)).target }}</template></ElTableColumn>
            <ElTableColumn label="材质" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ liveMaterial(asBatch(row)) }}</template></ElTableColumn>
            <ElTableColumn prop="serial_count" label="流水号数" min-width="90" align="center" />
            <ElTableColumn label="件数" min-width="90" align="right"><template #default="{ row }">{{ number(row.quantity) }}</template></ElTableColumn>
            <ElTableColumn label="重量 / kg" min-width="115" align="right"><template #default="{ row }">{{ number(row.weight) }}</template></ElTableColumn>
            <ElTableColumn label="状态" min-width="130" align="center"><template #default="{ row }"><span class="batch-status" :class="'batch-status--' + statusType(asBatch(row))">{{ liveBatchStatus(asBatch(row)) }}</span></template></ElTableColumn>
            <ElTableColumn label="待接收时长" min-width="130" align="right"><template #default="{ row }">{{ liveWaiting(asBatch(row), now) }}</template></ElTableColumn>
          </ElTable>
        </section>
        <footer class="live-footer"><span>最近{{ rows.length }}条 · 当前第{{ rows.length ? cursor + 1 : 0 }}条</span><div><ElButton link :icon="ArrowLeft" :disabled="rows.length < 2" aria-label="上一条转料" @click="next(-1)" /><ElButton link :icon="ArrowRight" :disabled="rows.length < 2" aria-label="下一条转料" @click="next(1)" /></div><span>悬停暂停 · 点击查看明细</span><span role="status">{{ connectionLabel }}{{ deferred ? ' · 播报待恢复' : '' }} · 机器人为流转示意</span></footer>
      </template>
      <div v-if="error && report || warning" class="live-notices"><ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon /><ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon /></div>
    </div>
  </section>
</template>
<style scoped>
.factory-live { --el-color-primary: #56daee; --el-bg-color: #031b2a; --el-bg-color-overlay: #052439; --el-fill-color-blank: #042338; --el-fill-color-light: #0a3549; --el-text-color-primary: #e6f5ff; --el-text-color-regular: #a6d8ef; --el-border-color: #20546b; position: relative; display: grid; place-items: center; padding: 0; overflow: hidden; color: #e6f5ff; background: #00111d; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.factory-live--fullscreen { width: 100vw; height: 100dvh; }
.factory-live { width: 100%; height: 100dvh; }
.transit-hint { font-size: .85em; color: #f3bd75; }
.live-board { position: absolute; transform-origin: center; box-sizing: border-box; padding: 10px 18px; display: grid; grid-template-rows: 44px 72px minmax(0, 1fr) 34px 246px 20px; gap: 10px; overflow: hidden; background: #001521; }
.live-heading { display: flex; align-items: center; justify-content: space-between; position: relative; border-bottom: 1px solid #164258; padding-bottom: 8px; }
.live-brand { color: #d9f3ff; font-size: 18px; font-weight: 600; }.live-brand :deep(.el-icon) { font-size: 25px; margin-right: 8px; }
.live-heading h1 { position: absolute; left: 50%; transform: translateX(-50%); margin: 0; font-size: 30px; line-height: 40px; font-weight: 650; letter-spacing: 4px; white-space: nowrap; }
.live-tools { display: flex; align-items: center; gap: 12px; }.live-tools time { font-size: 12px; color: #a6cadb; }
.live-tools .el-button { margin: 0; height: 30px; color: #c3eefa; border-color: #286580; background: transparent; font-size: 12px; }
.live-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #164258; padding-bottom: 8px; }
.live-metrics article { display: flex; align-items: center; justify-content: center; gap: 22px; min-width: 0; }.live-metrics article + article { border-left: 1px solid #205168; }
.live-metrics .el-icon { font-size: 36px; color: #69d8f1; }.live-metrics article > div > span { font-size: 14px; color: #a6d5e8; }
.live-metrics p { display: flex; align-items: baseline; gap: 9px; margin: 0; }.live-metrics strong { font-size: 34px; line-height: 40px; font-weight: 650; font-variant-numeric: tabular-nums; }.live-metrics small { font-size: 17px; color: #a6d5e8; }
.live-metrics .pending :is(.el-icon, strong) { color: #ffbc56; }.live-metrics .received :is(.el-icon, strong) { color: #5be5d5; }
.flow-layout { position: relative; min-height: 0; display: grid; grid-template-columns: minmax(0, 28%) minmax(0, 1fr) minmax(0, 28%); grid-template-rows: minmax(0, 1fr); column-gap: 20px; }
.flow-layout { background: linear-gradient(180deg, rgb(0 21 33 / 25%), transparent 35%, rgb(0 21 33 / 12%)), url('/assets/factory-live/factory-background.png') center 58% / cover no-repeat; }
.team-rail { display: grid; grid-template-rows: repeat(4, minmax(0, 1fr)); gap: 9px; min-width: 0; min-height: 0; }.team-rail--left { grid-column: 1; grid-row: 1; }.team-rail--right { grid-column: 3; grid-row: 1; }
.flow-center { position: relative; grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; }
.robot-stage { position: absolute; left: 50%; transform: translateX(-50%); width: min(510px, 100%); top: -24px; bottom: 74px; pointer-events: none; }
.current-flow { position: absolute; bottom: 0; left: 0; right: 0; min-width: 0; text-align: center; }
.current-flow { padding: 5px 0 0; border-radius: 6px; background: rgb(0 17 29 / 84%); }
.current-flow__route { display: flex; justify-content: center; align-items: center; gap: 16px; font-size: 24px; font-weight: 600; }.current-flow__route > span { max-width: 32%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.current-flow__route > .el-icon { font-size: 23px; color: #66e6ec; }
.current-flow :deep(.el-tag) { font-size: 13px; font-weight: 400; height: 24px; --el-tag-text-color: #ffd080; --el-tag-bg-color: #392b17; --el-tag-border-color: #87602b; }
.current-flow :deep(.el-tag--success) { --el-tag-text-color: #5df1d6; --el-tag-bg-color: #073a37; --el-tag-border-color: #167d75; }.current-flow :deep(.el-tag--info) { --el-tag-text-color: #bbccd5; --el-tag-bg-color: #19313e; --el-tag-border-color: #476778; }
.current-flow__amount { margin: 3px 0; font-size: 18px; line-height: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.current-flow__code { max-width: 100%; padding: 0; height: 18px; color: #90bacf; font-size: 11px; }
.live-broadcast { display: flex; align-items: center; min-width: 0; gap: 15px; padding: 0 16px; border: 1px solid #17475e; border-radius: 5px; background: #032031; font-size: 13px; }.live-broadcast > .el-icon { color: #80deef; font-size: 18px; }.live-broadcast > strong { white-space: nowrap; }.broadcast-window { flex: 1; min-width: 0; overflow: hidden; }.broadcast-window p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.live-broadcast > span { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; }.live-broadcast .el-progress { width: 145px; }.live-broadcast :deep(.el-progress-bar__outer) { background: #15445a; }.live-broadcast :deep(.el-progress-bar__inner) { transition: width 1s linear; }
.broadcast-enter-active, .broadcast-leave-active { transition: transform .25s ease, opacity .25s ease; }.broadcast-enter-from { transform: translateY(12px); opacity: 0; }.broadcast-leave-to { transform: translateY(-12px); opacity: 0; }
.live-feed { min-height: 0; min-width: 0; display: grid; grid-template-rows: 32px minmax(0, 1fr); border: 1px solid #18495f; border-radius: 6px; overflow: hidden; background: #031e2e; }
.live-feed > header { display: flex; align-items: center; gap: 15px; padding: 0 16px; border-bottom: 1px solid #164158; }.live-feed h2 { font-size: 19px; font-weight: 600; margin: 0; }.live-feed header > span { font-size: 11px; color: #8fb5c9; }.live-feed .el-switch { margin-left: auto; --el-switch-on-color: #166377; }.live-feed :deep(.el-switch__label) { color: #b7d9e8; }
.live-table { --el-table-bg-color: transparent; --el-table-tr-bg-color: #041d2c; --el-table-header-bg-color: #0b2c40; --el-table-header-text-color: #aacfe1; --el-table-text-color: #dceef7; --el-table-border-color: #10344a; --el-table-row-hover-bg-color: #0e3b50; --el-table-current-row-bg-color: #104051; font-size: 13px; font-variant-numeric: tabular-nums; }
.live-table :deep(.el-table__cell) { padding: 1px 0; height: 23px; }.live-table :deep(th.el-table__cell) { height: 27px; font-weight: 500; }.live-table :deep(.cell) { line-height: 20px; padding: 0 15px; white-space: nowrap; }.live-table :deep(.el-table__row) { cursor: pointer; }.live-table :deep(.el-table__row:nth-child(even)) { background: #072437; }.live-table :deep(.is-current > td) { background: #104052; box-shadow: inset 0 1px #287287, inset 0 -1px #287287; }.live-table.is-animated :deep(.el-table__body) { animation: rows-arrive .45s ease both; }.live-table.is-animated :deep(.is-updated > td) { animation: row-update 2.5s ease both; }
.batch-link { max-width: 100%; padding: 0; min-height: 18px; height: 18px; color: #cbe9f5; font-size: 12px; font-variant-numeric: tabular-nums; }.batch-link :deep(span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.batch-status--warning { color: #ffc160; }.batch-status--success { color: #5de7cc; }.batch-status--info { color: #a7bdca; }
.live-footer { display: flex; align-items: center; gap: 20px; font-size: 11px; color: #8fb5c9; }.live-footer > div { display: flex; gap: 6px; margin-right: auto; }.live-footer .el-button { color: #8ed7e8; margin: 0; padding: 0 5px; height: 20px; }.live-initial { grid-row: 2 / -1; align-self: center; }
.live-notices { position: absolute; z-index: 5; left: 30%; right: 30%; top: 150px; }.live-notices :deep(.el-alert) { background: #493119; color: #ffe0ac; }.factory-live :deep(button:focus-visible) { outline: 2px solid #a5f5ff; outline-offset: 2px; }
.factory-live--paused :deep(*) { animation-play-state: paused !important; }.factory-live--paused .broadcast-enter-active, .factory-live--paused .broadcast-leave-active { transition: none; }.factory-live--paused :deep(.el-progress-bar__inner) { transition: none; }
@keyframes rows-arrive { from { transform: translateY(8px); opacity: .4; } to { transform: translateY(0); opacity: 1; } } @keyframes row-update { from { background: #1b5b67; } }
.factory-live--narrow { display: block; overflow: auto; }.factory-live--narrow .live-board { position: relative; width: 100%; min-height: 100%; padding: 14px; grid-template-rows: auto auto auto auto 320px auto; gap: 16px; overflow: visible; }
.factory-live--narrow .live-heading { flex-wrap: wrap; gap: 12px; }.factory-live--narrow .live-heading h1 { position: static; transform: none; order: -1; width: 100%; font-size: 25px; }.factory-live--narrow .live-brand { font-size: 14px; }.factory-live--narrow .live-tools { flex-wrap: wrap; gap: 8px; }.factory-live--narrow .live-tools time { display: none; }
.factory-live--narrow .live-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 8px; padding: 8px 0 16px; }.factory-live--narrow .live-metrics article { justify-content: flex-start; gap: 10px; border: none; }.factory-live--narrow .live-metrics strong { font-size: 25px; }.factory-live--narrow .live-metrics .el-icon { font-size: 24px; }.factory-live--narrow .live-metrics small { font-size: 13px; }
.factory-live--narrow .flow-layout { display: flex; flex-direction: column; gap: 12px; }.factory-live--narrow .flow-center { order: -1; height: 410px; }.factory-live--narrow .team-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, 118px); }.factory-live--narrow .current-flow__route { font-size: 20px; gap: 10px; }.factory-live--narrow .current-flow__amount { font-size: 15px; }.factory-live--narrow .live-broadcast { min-height: 46px; padding: 7px 10px; gap: 8px; }.factory-live--narrow .live-broadcast .el-progress, .factory-live--narrow .live-broadcast > span { display: none; }.factory-live--narrow .broadcast-window p { white-space: normal; }.factory-live--narrow .live-feed { grid-template-rows: 40px minmax(0, 1fr); }.factory-live--narrow .live-feed header > span { display: none; }.factory-live--narrow .live-table :deep(.el-table__cell) { height: 30px; }.factory-live--narrow .live-footer { flex-wrap: wrap; gap: 8px 16px; }.factory-live--narrow .live-notices { position: static; }
.factory-live--narrow .flow-layout { background: none; }.factory-live--narrow .flow-center { background: url('/assets/factory-live/factory-background.png') center / cover no-repeat; }
@media (max-width: 650px) { .factory-live--narrow .team-rail { grid-template-columns: 1fr; grid-template-rows: repeat(4, 116px); } }
@media (prefers-reduced-motion: reduce) { .factory-live :deep(*) { animation: none !important; transition: none !important; } }
</style>

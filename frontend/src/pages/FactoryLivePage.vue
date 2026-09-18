<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert, ElButton, ElIcon } from 'element-plus'
import { FullScreen, Close, Refresh, VideoPause, VideoPlay, DataAnalysis, ArrowLeft, ArrowRight, Goods } from '@element-plus/icons-vue'
import FactoryRobot from '@/components/FactoryRobot.vue'
import LiveTeamCard from '@/components/LiveTeamCard.vue'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import { liveLook } from '@/utils/factoryLive'
import { formatDateTime } from '@/utils/format'
import { showToast } from '@/stores/toast'
import { factoryScreenLayout } from '@/utils/factoryScreen'
import type { FactoryLive, LiveTransfer, LiveTeam } from '@/types/factoryLive'

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
const selectedTeamCode = ref('')
const materialPage = ref(0)
const materialPages = computed(() => Math.max(1, Math.ceil((report.value?.material_stock?.length || 0) / 3)))
const visibleMaterials = computed(() => report.value?.material_stock?.slice(materialPage.value * 3, materialPage.value * 3 + 3) || [])
let version = 0, media: MediaQueryList | undefined
// Match the 32px rows in LiveTeamCard: three seconds of continuous travel per row.
const rowHeight = 32, rowDuration = 3000
let frame = 0, lastFrame = 0, scrollElapsed = 0, materialElapsed = 0
const displayTeams = ref<LiveTeam[]>([]), offsets = ref<Record<string, number>>({})
const rotationTeams = computed(() => displayTeams.value.filter(team => team.id && team.pending_transfers.length))
const selectedTeam = computed(() => displayTeams.value.find(team => team.code === selectedTeamCode.value))
function visibleTransfers(team: LiveTeam) {
  const rows = team.pending_transfers
  const offset = rows.length > 3 ? (offsets.value[team.code] || 0) % rows.length : 0
  // The fourth row enters from below while the first leaves the three-row viewport.
  return [...rows.slice(offset), ...rows.slice(0, offset)].slice(0, rows.length > 3 ? 4 : 3)
}
// The robot follows the first visible pending serial of the highlighted team.
const selected = computed(() => selectedTeam.value ? visibleTransfers(selectedTeam.value)[0] : undefined)
const canRotate = computed(() => playing.value && !hidden.value && !reduced.value && !error.value && (rotationTeams.value.length > 0 || materialPages.value > 1))
const moving = computed(() => !hidden.value && !reduced.value && !error.value && Boolean(selected.value))
const activityKey = computed(() => selected.value ? [selected.value.batch_no, selected.value.serial_no, selected.value.updated_at].join(':') : '')
const look = computed(() => liveLook(selected.value?.target_id ?? null, report.value?.teams || []))
const groups = computed(() => [displayTeams.value.slice(0, 4), displayTeams.value.slice(4, 8)])
const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const warning = computed(() => {
  if (!report.value) return ''
  const missing = report.value.teams.filter(team => !team.id).map(team => team.name)
  const inactive = report.value.teams.filter(team => team.id && !team.active).map(team => team.name)
  return [missing.length ? '未配置：' + missing.join('、') : '', inactive.length ? '已停用：' + inactive.join('、') + '，既有库存仍计入' : '', report.value.legacy_received_count ? report.value.legacy_received_count + ' 条历史接收未纳入库存' : ''].filter(Boolean).join('；')
})
function applyReport(value: FactoryLive) {
  for (const team of value.teams) {
    const previous = displayTeams.value.find(item => item.code === team.code)
    const keys = (rows: LiveTransfer[]) => JSON.stringify(rows.map(row => [row.batch_no, row.serial_no]))
    if (!previous || keys(previous.pending_transfers) !== keys(team.pending_transfers)) offsets.value[team.code] = 0
  }
  report.value = value
  materialPage.value = Math.min(materialPage.value, materialPages.value - 1)
  displayTeams.value = value.teams
  if (!rotationTeams.value.some(team => team.code === selectedTeamCode.value)) {
    selectedTeamCode.value = rotationTeams.value[0]?.code || ''
  }
}
async function load() {
  const current = ++version; loading.value = true
  try {
    const value = await factoryLiveApi.get()
    if (current !== version) return
    error.value = ''
    applyReport(value)
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
      applyReport(value)
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
function next() {
  for (const team of displayTeams.value) {
    if (team.pending_transfers.length > 3) offsets.value[team.code] = ((offsets.value[team.code] || 0) + 1) % team.pending_transfers.length
  }
  if (!rotationTeams.value.length) return
  const index = rotationTeams.value.findIndex(team => team.code === selectedTeamCode.value)
  selectedTeamCode.value = rotationTeams.value[(index + 1) % rotationTeams.value.length]!.code
}
function scroll(now: number) {
  if (!canRotate.value) return
  const delta = Math.min(now - lastFrame, 100)
  scrollElapsed += delta
  materialElapsed += delta
  lastFrame = now
  if (scrollElapsed >= rowDuration) {
    scrollElapsed %= rowDuration
    next()
  }
  if (materialElapsed >= 2000) {
    materialElapsed %= 2000
    materialPage.value = (materialPage.value + 1) % materialPages.value
  }
  // One shared transform clock keeps all eight lists aligned without rendering Vue each frame.
  root.value?.style.setProperty('--transfer-offset', `${-rowHeight * scrollElapsed / rowDuration}px`)
  frame = requestAnimationFrame(scroll)
}
function syncScroll() {
  cancelAnimationFrame(frame)
  frame = 0
  lastFrame = performance.now()
  if (canRotate.value) frame = requestAnimationFrame(scroll)
}
watch(canRotate, syncScroll)
function changeMaterialPage(direction: number) {
  materialPage.value = (materialPage.value + direction + materialPages.value) % materialPages.value
  materialElapsed = 0
}
function selectTeam(team: LiveTeam) {
  if (!team.id) return
  selectedTeamCode.value = team.code
}
function toggleMotion() { playing.value = !playing.value }
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
function openBatch(row: LiveTransfer) { void navigate('/transfer-batches/scan?batch_no=' + encodeURIComponent(row.batch_no)) }
onMounted(() => {
  syncFullscreen()
  fitBoard(); resize = new ResizeObserver(fitBoard); if (root.value) resize.observe(root.value)
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)'); syncMotion(); media?.addEventListener('change', syncMotion)
  document.addEventListener('visibilitychange', syncVisibility); document.addEventListener('fullscreenchange', syncFullscreen)
  window.addEventListener('resize', fitBoard)
  syncScroll()
  if (!hidden.value) connect()
})
onBeforeUnmount(() => { ++streamVersion; unsubscribe?.(); if (fullscreen.value && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); resize?.disconnect(); ++version; cancelAnimationFrame(frame); media?.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility); document.removeEventListener('fullscreenchange', syncFullscreen); window.removeEventListener('resize', fitBoard) })
</script>
<template>
  <section ref="root" class="page factory-live" :class="{ 'factory-live--fullscreen': fullscreen, 'factory-live--paused': !moving, 'factory-live--narrow': narrow }">
    <div class="live-board" :style="boardStyle">
      <header class="live-heading">
        <ElButton class="live-brand" link :icon="DataAnalysis" aria-label="返回系统总览" title="返回系统总览" @click="navigate('/')">热沉物料流转管理</ElButton>
        <h1>物料流转大屏</h1>
        <div class="live-tools"><span class="live-connection" role="status">{{ connectionLabel }}</span><time>{{ report ? formatDateTime(report.as_of) : '读取状态' }}</time><ElButton circle :icon="Refresh" :loading="loading" aria-label="刷新物料状态" @click="load()" /><ElButton round :icon="playing ? VideoPause : VideoPlay" :disabled="reduced" @click="toggleMotion">{{ playing ? '暂停轮播' : '播放轮播' }}</ElButton><ElButton circle :icon="fullscreen ? Close : FullScreen" :aria-label="fullscreen ? '退出全屏' : '全屏展示'" @click="toggleFullscreen" /></div>
      </header>
      <StatePanel v-if="!report" class="live-initial" :state="error ? 'error' : 'loading'" :description="error" title="读取八班组物料状态" @retry="load()" />
      <template v-else>
        <section class="live-metrics" aria-label="全厂材质库存件数与重量">
          <article class="live-stock-total" title="各班组当前库存合计，含废料；内部转料、对外出库及发货均提交即扣减">
            <ElIcon><Goods /></ElIcon>
            <div>
              <span>全厂在库<small class="transit-hint"> · 在途 {{ number(report.totals.in_transit_quantity) }} 件 / {{ number(report.totals.in_transit_weight) }} kg</small></span>
              <p><span class="metric-quantity"><strong><AnimatedMetric :value="report.totals.on_hand_quantity" :animate="!hidden && !reduced" :precision="0" /></strong><small>件</small></span><i aria-hidden="true">/</i><span class="metric-weight"><strong><AnimatedMetric :value="report.totals.on_hand_weight" :animate="!hidden && !reduced" :precision="3" /></strong><small>kg</small></span></p>
            </div>
          </article>
          <div class="live-materials">
            <Transition name="material-page" mode="out-in">
              <div v-if="visibleMaterials.length" :key="materialPage" class="live-material-items">
                <article v-for="material in visibleMaterials" :key="material.key" class="live-material" :aria-label="material.key + '在库件数与重量'">
                  <div>
                    <span class="material-name" :title="material.key">{{ material.key }}</span>
                    <p><span class="metric-quantity"><strong><AnimatedMetric :value="material.quantity" :animate="!hidden && !reduced" :precision="0" /></strong><small>件</small></span><i aria-hidden="true">/</i><span class="metric-weight"><strong><AnimatedMetric :value="material.weight" :animate="!hidden && !reduced" :precision="3" /></strong><small>kg</small></span></p>
                  </div>
                </article>
              </div>
              <p v-else class="material-empty">暂无在库材质</p>
            </Transition>
            <nav v-if="materialPages > 1" class="material-pager" aria-label="材质重量翻页">
              <div><ElButton link :icon="ArrowLeft" aria-label="上一组材质" @click="changeMaterialPage(-1)" /><ElButton link :icon="ArrowRight" aria-label="下一组材质" @click="changeMaterialPage(1)" /></div>
              <span>{{ materialPage + 1 }} / {{ materialPages }}</span>
            </nav>
          </div>
        </section>
        <section class="flow-layout" aria-label="八班组状态与物料流转">
          <div v-for="(teams, side) in groups" :key="side" class="team-rail" :class="side ? 'team-rail--right' : 'team-rail--left'">
            <LiveTeamCard v-for="(team, index) in teams" :key="team.code" :team="team" :index="index + side * 4" :rows="visibleTransfers(team)" :selected="team.code === selectedTeamCode" @select="selectTeam" @open="openBatch" />
          </div>
          <div class="flow-center">
            <div class="robot-stage"><FactoryRobot :paused="!moving" :look="look" :activity-key="activityKey" :display-scale="layout.scale" :device-ratio="deviceRatio" /></div>
          </div>
        </section>
      </template>
      <div v-if="error && report || warning" class="live-notices"><ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon /><ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon /></div>
    </div>
  </section>
</template>
<style scoped>
.factory-live { --el-color-primary: #56daee; --el-bg-color: #031b2a; --el-bg-color-overlay: #052439; --el-fill-color-blank: #042338; --el-fill-color-light: #0a3549; --el-text-color-primary: #e6f5ff; --el-text-color-regular: #a6d8ef; --el-border-color: #20546b; position: relative; display: grid; place-items: center; padding: 0; overflow: hidden; width: 100%; height: 100dvh; color: #e6f5ff; background: #00111d; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.factory-live--fullscreen { width: 100vw; }
.live-board { position: absolute; transform-origin: center; box-sizing: border-box; padding: 10px 20px; display: grid; grid-template-rows: 44px 72px minmax(0, 1fr); gap: 10px; overflow: hidden; background: #001521; }
.live-heading { display: flex; align-items: center; justify-content: space-between; position: relative; border-bottom: 1px solid #164258; padding-bottom: 8px; }
.live-brand { color: #d9f3ff; font-size: 18px; font-weight: 600; }.live-brand :deep(.el-icon) { font-size: 25px; margin-right: 8px; }
.live-heading h1 { position: absolute; left: 50%; transform: translateX(-50%); margin: 0; font-size: 30px; line-height: 40px; font-weight: 650; letter-spacing: 4px; white-space: nowrap; }
.live-tools { display: flex; align-items: center; gap: 12px; }.live-tools time { font-size: 12px; color: #a6cadb; }
.live-tools .el-button { margin: 0; height: 30px; color: #c3eefa; border-color: #286580; background: transparent; font-size: 12px; }
.live-connection { font-size: 11px; color: #8eb8ca; white-space: nowrap; }
.live-metrics { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 3fr); border-bottom: 1px solid #164258; padding-bottom: 8px; }
.live-metrics article { display: flex; align-items: center; justify-content: center; gap: 22px; min-width: 0; }.live-metrics article + article { border-left: 1px solid #205168; }
.live-metrics .el-icon { font-size: 36px; color: #69d8f1; }.live-metrics article > div > span { font-size: 14px; color: #a6d5e8; }
.live-metrics p { display: flex; align-items: baseline; gap: 9px; margin: 0; }.live-metrics strong { font-size: 30px; line-height: 40px; font-weight: 650; font-variant-numeric: tabular-nums; }.live-metrics small { font-size: 14px; color: #a6d5e8; }
.live-metrics p > span { display: inline-flex; align-items: baseline; gap: 5px; white-space: nowrap; }.live-metrics p > i { font-size: 16px; font-style: normal; color: #6796ab; }.live-metrics .metric-weight strong { font-size: 24px; }
.live-metrics .transit-hint { font-size: 12px; }
.live-stock-total { padding-right: 18px; }
.live-materials { display: flex; min-width: 0; border-left: 1px solid #205168; }
.live-material-items { flex: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; }
.live-material { padding-inline: 20px; }.live-material > div { min-width: 0; }
.material-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-material strong { color: #76dcef; }
.material-pager { width: 56px; flex: 0 0 56px; margin-left: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 11px; color: #9bbfce; }
.material-pager .el-button { width: 24px; height: 24px; margin: 0; color: #a9ecf6; padding: 2px; }
.material-empty { flex: 1; align-self: center; text-align: center; margin: 0; font-size: 14px; color: #9bbfce; }
.material-page-enter-active, .material-page-leave-active { transition: opacity .18s ease, transform .18s ease; }.material-page-enter-from { opacity: 0; transform: translateY(10px); }.material-page-leave-to { opacity: 0; transform: translateY(-10px); }
.live-materials { overflow: hidden; }
.flow-layout { position: relative; min-height: 0; display: grid; grid-template-columns: minmax(0, 31.2%) minmax(0, 1fr) minmax(0, 31.2%); grid-template-rows: minmax(0, 1fr); column-gap: 0; background: url('/assets/factory-live/factory-background.png') center 58% / cover no-repeat; }
.team-rail { z-index: 1; display: grid; grid-template-rows: repeat(4, minmax(0, 1fr)); padding: 0 14px; min-width: 0; min-height: 0; background: rgb(0 25 41 / 91%); border: 1px solid #2882a5; border-radius: 7px; box-shadow: inset 0 0 16px rgb(43 168 220 / 13%), 0 0 8px rgb(54 177 223 / 18%); }
.team-rail--left { grid-column: 1; grid-row: 1; }.team-rail--right { grid-column: 3; grid-row: 1; }
.flow-center { position: relative; grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; }
.robot-stage { position: absolute; left: 50%; transform: translateX(-50%); width: 540px; height: 500px; top: 50%; margin-top: -290px; pointer-events: none; }
.live-initial { grid-row: 2 / -1; align-self: center; }
.live-notices { position: absolute; z-index: 5; left: 33%; right: 33%; top: 150px; }.live-notices :deep(.el-alert) { background: #493119; color: #ffe0ac; font-size: 12px; }
.factory-live :deep(button:focus-visible) { outline: 2px solid #a5f5ff; outline-offset: -2px; }
.factory-live--narrow { display: block; overflow: auto; }.factory-live--narrow .live-board { position: relative; width: 100%; min-height: 100%; padding: 14px; grid-template-rows: auto auto auto; gap: 16px; overflow: visible; }
.factory-live--narrow .live-heading { flex-wrap: wrap; gap: 12px; }.factory-live--narrow .live-heading h1 { position: static; transform: none; order: -1; width: 100%; font-size: 25px; }.factory-live--narrow .live-brand { font-size: 14px; }.factory-live--narrow .live-tools { flex-wrap: wrap; gap: 8px; }.factory-live--narrow .live-tools time { display: none; }
.factory-live--narrow .live-metrics { grid-template-columns: 1fr; gap: 18px; padding: 8px 0 16px; }.factory-live--narrow .live-metrics article { justify-content: flex-start; gap: 10px; border: none; }.factory-live--narrow .live-metrics strong { font-size: 25px; }.factory-live--narrow .live-metrics .el-icon { font-size: 24px; }.factory-live--narrow .live-metrics small { font-size: 13px; }
.factory-live--narrow .live-materials { border-left: 0; min-height: 132px; }.factory-live--narrow .live-material-items { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 60px; gap: 12px; }.factory-live--narrow .live-material { padding: 0; }.factory-live--narrow .material-name { font-size: 13px; }.factory-live--narrow .live-material strong { font-size: 22px; }
.factory-live--narrow .live-material p { flex-wrap: wrap; gap: 0 6px; line-height: 20px; }.factory-live--narrow .live-material strong { line-height: 20px; }.factory-live--narrow .live-material .metric-weight strong { font-size: 16px; }.factory-live--narrow .live-material p > i { display: none; }
.factory-live--narrow .flow-layout { display: flex; flex-direction: column; gap: 12px; background: none; }.factory-live--narrow .flow-center { order: -1; height: 440px; overflow: hidden; background: url('/assets/factory-live/factory-background.png') center / cover no-repeat; }.factory-live--narrow .robot-stage { width: 430px; height: 480px; margin-top: -240px; }
.factory-live--narrow .team-rail { grid-template-rows: repeat(4, 200px); }.factory-live--narrow .live-notices { position: static; }
@media (prefers-reduced-motion: reduce) { .factory-live :deep(*) { animation: none !important; transition: none !important; } }
</style>

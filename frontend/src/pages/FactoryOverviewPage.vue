<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSwitch } from 'element-plus'
import { FullScreen, Refresh, Close, ArrowLeft, ArrowRight, VideoPause, VideoPlay, Lock, Unlock } from '@element-plus/icons-vue'
import FactoryOverviewCharts from '@/components/FactoryOverviewCharts.vue'
import FactoryRecentBatches from '@/components/FactoryRecentBatches.vue'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { showToast } from '@/stores/toast'
import { formatDateTime } from '@/utils/format'
import type { Metric } from '@/types/materialAnalytics'
import type { FactoryOverview, FactoryTeam, FactoryScene, FactoryRecentBatch } from '@/types/factoryOverview'

const route = useRoute(), router = useRouter()
const days = computed<7 | 30>(() => route.query.days === '7' ? 7 : 30)
const metric = computed<Metric>(() => route.query.metric === 'quantity' ? 'quantity' : 'weight')
const root = ref<HTMLElement>(), fullscreen = ref(false), autoRefresh = ref(true)
const report = ref<FactoryOverview | null>(null), loading = ref(false), error = ref('')
let version = 0, timer: ReturnType<typeof setInterval> | undefined
let playbackTimer: ReturnType<typeof setInterval> | undefined, media: MediaQueryList | undefined
const scenes: { key: FactoryScene; label: string }[] = [{ key: 'overview', label: '全厂态势' }, { key: 'stock', label: '库存分析' }, { key: 'handoff', label: '交接与异常' }]
const sceneIndex = ref(0), sceneSeconds = ref(0), focusIndex = ref(0), recentGroup = ref(0)
const playing = ref(false), locked = ref(false), hovering = ref(false), focused = ref(false), hidden = ref(document.hidden), reduced = ref(false)
let rotationTicks = 0
const scene = computed(() => scenes[sceneIndex.value]!)
const suspended = computed(() => hovering.value || focused.value || hidden.value || Boolean(error.value) || !report.value)
const advancing = computed(() => playing.value && !suspended.value && !reduced.value)
const motion = computed(() => !reduced.value && !hidden.value && !error.value && (!playing.value || !suspended.value))
const playbackLabel = computed(() => reduced.value ? '减少动画 · 手动切页' : error.value ? '数据未更新 · 轮播暂停' : !playing.value ? '轮播已暂停' : suspended.value ? '阅读中 · 轮播暂停' : locked.value ? '当前屏已锁定 · 图表轮显中' : `${20 - sceneSeconds.value} 秒后切换`)
function resetRotation() { sceneSeconds.value = 0; focusIndex.value = 0; rotationTicks = 0 }
function selectScene(index: number) { playing.value = false; sceneIndex.value = (index + scenes.length) % scenes.length; resetRotation() }
function togglePlayback() { playing.value = !playing.value; sceneSeconds.value = 0 }
function toggleLock() { locked.value = !locked.value; sceneSeconds.value = 0 }
function syncVisibility() { hidden.value = document.hidden }
function syncMotion() { reduced.value = Boolean(media?.matches); if (reduced.value) playing.value = false }
function focusOut(event: FocusEvent) { focused.value = Boolean(event.relatedTarget && (event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) }
function advance() {
  if (!advancing.value) return
  rotationTicks++
  if (rotationTicks % 4 === 0) focusIndex.value++
  if (rotationTicks % 8 === 0) recentGroup.value++
  if (!locked.value && ++sceneSeconds.value >= 20) {
    sceneIndex.value = (sceneIndex.value + 1) % scenes.length
    sceneSeconds.value = 0; focusIndex.value = 0
  }
}
const unit = computed(() => metric.value === 'weight' ? 'kg' : '件')
const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const warning = computed(() => {
  if (!report.value) return ''
  const missing = report.value.teams.filter(team => !team.id).map(team => team.name)
  const inactive = report.value.teams.filter(team => team.id && !team.active).map(team => team.name)
  return [missing.length ? `未配置：${missing.join('、')}，汇总范围不完整` : '', inactive.length ? `停用班组仍保留库存：${inactive.join('、')}` : '', report.value.legacy_received_count ? `${report.value.legacy_received_count} 条历史接收未纳入库存` : ''].filter(Boolean).join('；')
})
const metrics = computed(() => {
  const d = report.value
  if (!d) return []
  return [
    { key: 'stock', label: '全厂在库物料', value: d.totals[`on_hand_${metric.value}`], detail: `另有内部在途 ${number(d.totals[`in_transit_${metric.value}`])} ${unit.value}`, accent: true },
    { key: 'pending', label: '待交接物料', value: d.pending[metric.value], detail: `${d.pending.batches} 个待确认批次 · 含对外出库` },
    { key: 'inbound', label: `近${d.days}天入库`, value: d.period_totals.inbound[metric.value], detail: '库房已登记入库' },
    { key: 'outbound', label: `近${d.days}天对外出库`, value: d.period_totals.outbound[metric.value] + d.period_totals.shipment[metric.value], detail: `检验发货 ${number(d.period_totals.shipment[metric.value])} ${unit.value}` },
  ]
})
function preference(values: Record<string, string>) { void router.replace({ path: route.path, query: { ...route.query, ...values } }) }
async function load() {
  const current = ++version; loading.value = true
  try { const result = await factoryOverviewApi.get(days.value); if (current === version) { report.value = result; error.value = '' } }
  catch { if (current === version) error.value = report.value ? '更新失败，当前显示上次成功读取的数据。' : '全厂数据加载失败，请重试。' }
  finally { if (current === version) loading.value = false }
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === root.value) await document.exitFullscreen()
    else if (root.value?.requestFullscreen) await root.value.requestFullscreen()
    else showToast('当前浏览器不支持全屏，请使用 Chrome 或 Edge。', 'error')
  } catch { showToast('未能进入全屏，请检查浏览器设置后重试。', 'error') }
}
function syncFullscreen() {
  fullscreen.value = Boolean(root.value && document.fullscreenElement === root.value)
  playing.value = fullscreen.value && !reduced.value
  sceneSeconds.value = 0
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented && root.value && document.fullscreenElement === root.value) void toggleFullscreen()
}
async function navigate(path: string) {
  playing.value = false
  if (root.value && document.fullscreenElement === root.value) await document.exitFullscreen()
  await router.push(path)
}
function openTeam(team: FactoryTeam) { if (team.id && team.active) void navigate(`/team-workspaces/${team.id}?tab=stock`) }
function openBatch(row: FactoryRecentBatch) { void navigate(`/transfer-batches/scan?batch_no=${encodeURIComponent(row.batch_no)}`) }
watch(days, load, { immediate: true })
onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreen)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', syncVisibility)
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)'); syncMotion()
  media?.addEventListener('change', syncMotion)
  playbackTimer = setInterval(advance, 1000)
  timer = setInterval(() => { if (autoRefresh.value && !document.hidden && !loading.value) void load() }, 60000)
})
onBeforeUnmount(() => { ++version; if (timer) clearInterval(timer); if (playbackTimer) clearInterval(playbackTimer); media?.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility); document.removeEventListener('fullscreenchange', syncFullscreen); document.removeEventListener('keydown', onKeydown) })
</script>
<template>
  <section ref="root" class="page factory-overview" :class="{ 'factory-overview--screen': fullscreen }">
    <header class="factory-heading">
      <div><h1>全厂物料总览</h1><p>八班组<span v-if="report"> · 数据截至 {{ formatDateTime(report.as_of) }}</span></p></div>
      <div class="factory-controls">
        <ElRadioGroup :model-value="metric" size="small" aria-label="全厂统计单位" @update:model-value="preference({ metric: String($event) })"><ElRadioButton value="weight">重量</ElRadioButton><ElRadioButton value="quantity">件数</ElRadioButton></ElRadioGroup>
        <ElSelect :model-value="days" :teleported="false" size="small" aria-label="全厂统计周期" @update:model-value="preference({ days: String($event) })"><ElOption :value="7" label="近7天" /><ElOption :value="30" label="近30天" /></ElSelect>
        <ElSwitch v-model="autoRefresh" size="small" aria-label="每60秒自动刷新" active-text="自动刷新" />
        <ElButton :icon="Refresh" :loading="loading" size="small" @click="load">刷新</ElButton>
        <ElButton :icon="fullscreen ? Close : FullScreen" type="primary" size="small" @click="toggleFullscreen">{{ fullscreen ? '退出大屏' : '大屏模式' }}</ElButton>
      </div>
    </header>
    <ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon />
    <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
    <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!report" state="loading" title="正在读取全厂物料" />
    <template v-else>
      <section class="factory-metrics" aria-label="全厂关键数据">
        <article v-for="item in metrics" :key="item.key" class="factory-metric" :class="{ 'factory-metric--primary': item.accent }">
          <h2>{{ item.label }}</h2><div><strong><AnimatedMetric :key="`${item.key}-${metric}-${report.days}`" :value="item.value" :animate="advancing" :precision="metric === 'quantity' ? 0 : 3" /></strong><span>{{ unit }}</span></div><p>{{ item.detail }}</p>
        </article>
      </section>
      <nav class="factory-playback" aria-label="大屏轮播控制">
        <div class="scene-tabs"><ElButton v-for="(item, i) in scenes" :key="item.key" :type="sceneIndex === i ? 'primary' : 'default'" :plain="sceneIndex !== i" :aria-pressed="sceneIndex === i" @click="selectScene(i)"><small>0{{ i + 1 }}</small>{{ item.label }}</ElButton></div>
        <div class="playback-actions"><span class="playback-status">{{ playbackLabel }}</span><ElButton :icon="ArrowLeft" circle aria-label="上一屏" @click="selectScene(sceneIndex - 1)" /><ElButton :icon="playing ? VideoPause : VideoPlay" :disabled="reduced" @click="togglePlayback">{{ playing ? '暂停轮播' : '播放轮播' }}</ElButton><ElButton :icon="ArrowRight" circle aria-label="下一屏" @click="selectScene(sceneIndex + 1)" /><ElButton :icon="locked ? Lock : Unlock" :aria-pressed="locked" @click="toggleLock">{{ locked ? '解除锁定' : '锁定当前屏' }}</ElButton></div>
      </nav>
      <section class="factory-presentation" @mouseenter="hovering = true" @mouseleave="hovering = false" @focusin="focused = true" @focusout="focusOut">
        <div class="factory-stage" :aria-label="scene.label">
          <Transition name="scene-fade" mode="in-out" :css="motion">
            <FactoryOverviewCharts :key="scene.key" :data="report" :metric="metric" :dark="fullscreen" :scene="scene.key" :focus-index="fullscreen || playing ? focusIndex : undefined" :motion="motion" @team="openTeam" />
          </Transition>
        </div>
        <FactoryRecentBatches :rows="report.recent_batches || []" :group="recentGroup" :motion="motion" @open="openBatch" />
      </section>
      <footer class="factory-footer"><span>内部转出即扣库存，待接收计入在途；在库与在途合计为全厂持有物料。{{ autoRefresh ? '每60秒刷新。' : '自动刷新已暂停。' }}</span><ElButton link type="primary" @click="navigate('/transfer-batches')">查看转料记录</ElButton></footer>
    </template>
  </section>
</template>
<style scoped>
.factory-overview { --dashboard-surface: #fff; --dashboard-line: var(--line); --dashboard-muted: var(--muted); display: flex; flex-direction: column; gap: 14px; padding: 20px 24px 16px; color: var(--text); background: var(--workspace-bg); overflow-y: auto; }
.factory-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }.factory-heading h1 { margin: 0; font-size: 24px; line-height: 32px; font-weight: 550; letter-spacing: -.5px; }.factory-heading p { font-size: 12px; line-height: 18px; color: var(--dashboard-muted); margin: 5px 0 0; }
.factory-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }.factory-controls > .el-select { width: 96px; }.factory-controls .el-button + .el-button { margin-left: 0; }.factory-controls :deep(.el-switch__label) { font-size: 12px; }
.factory-metrics { display: grid; grid-template-columns: 1.25fr repeat(3, minmax(0, 1fr)); gap: 18px; flex-shrink: 0; }.factory-metric { padding: 19px 22px; border-radius: var(--card-radius); border: 1px solid var(--dashboard-line); background: var(--dashboard-surface); min-width: 0; }.factory-metric--primary { border-color: var(--line); background: var(--surface-soft); }.factory-metric h2 { font-size: 13px; line-height: 20px; color: var(--muted); font-weight: 500; margin: 0 0 10px; }.factory-metric > div { display: flex; gap: 8px; align-items: baseline; }.factory-metric strong { font-size: clamp(25px, 2.1vw, 38px); line-height: 1.2; letter-spacing: -.7px; font-variant-numeric: tabular-nums; font-weight: 600; }.factory-metric > div > span { font-size: 13px; color: var(--dashboard-muted); }.factory-metric p { color: var(--dashboard-muted); font-size: 12px; line-height: 18px; margin: 10px 0 0; }
.factory-footer { display: flex; flex-shrink: 0; justify-content: space-between; gap: 12px; align-items: center; font-size: 12px; color: var(--dashboard-muted); }
.factory-playback { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; flex-shrink: 0; }.scene-tabs, .playback-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }.factory-playback .el-button + .el-button { margin-left: 0; }.scene-tabs .el-button { height: 36px; padding-inline: 14px; }.scene-tabs small { opacity: .6; margin-right: 8px; font-size: 12px; }.playback-actions .el-button { height: 32px; font-size: 12px; }.playback-status { color: var(--dashboard-muted); font-size: 12px; margin-right: 8px; min-width: 108px; text-align: right; }
.factory-presentation { display: flex; flex-direction: column; flex: 1; min-height: 420px; gap: 14px; }.factory-stage { display: grid; flex: 1; min-height: 280px; }.factory-stage > .factory-charts { grid-area: 1 / 1; }.scene-fade-enter-active, .scene-fade-leave-active { transition: opacity 200ms ease, transform 200ms ease; }.scene-fade-enter-from { opacity: 0; transform: translateX(10px); }.scene-fade-leave-to { opacity: 0; transform: translateX(-10px); }
.factory-overview--screen { --dashboard-surface: #19273c; --dashboard-line: #2a3a53; --dashboard-muted: #a6b4cc; --el-bg-color: #19273c; --el-bg-color-overlay: #22324b; --el-text-color-primary: #e3eafb; --el-text-color-regular: #c9d5e8; --el-fill-color-blank: #19273c; --el-border-color: #3e506e; --el-color-primary: #a58eff; --el-fill-color-light: #283954; --subtle: #a6b4cc; height: 100dvh; width: 100vw; background: #111d30; color: #eaf0fb; padding: 26px 32px 18px; }.factory-overview--screen .factory-metric--primary { background: #2b2d50; border-color: #514978; }.factory-overview--screen .factory-metric h2 { color: #c9d4e7; }
.factory-overview--screen .factory-heading h1 { font-size: 30px; line-height: 38px; }.factory-overview--screen .factory-heading p, .factory-overview--screen .factory-metric p, .factory-overview--screen .factory-footer { font-size: 14px; line-height: 20px; }.factory-overview--screen .factory-metric { padding: 22px 26px; }.factory-overview--screen .factory-metric h2 { font-size: 16px; }.factory-overview--screen .factory-metric strong { font-size: clamp(36px, 2.5vw, 52px); }
.factory-overview--screen { gap: 18px; }.factory-overview--screen .playback-actions .el-button, .factory-overview--screen .playback-status { font-size: 14px; }.factory-overview--screen .scene-tabs .el-button { height: 40px; font-size: 15px; }.factory-overview--screen .factory-presentation { gap: 18px; }
.factory-overview:not(.factory-overview--screen) :is(.factory-heading p, .factory-metric h2, .factory-metric p, .factory-metric > div > span, .factory-footer, .playback-status) { color: var(--muted); font-size: 14px; line-height: 22px; }
.factory-overview:not(.factory-overview--screen) .factory-heading h1 { font-size: 22px; letter-spacing: normal; }
.factory-overview:not(.factory-overview--screen) .factory-metric--primary { background: var(--surface-soft); border-color: var(--table-header-line); }
.factory-overview:not(.factory-overview--screen) :deep(.factory-controls .el-button), .factory-overview:not(.factory-overview--screen) :deep(.factory-controls .el-select__wrapper) { min-height: 36px; font-size: 14px; }
.factory-overview:not(.factory-overview--screen) :deep(.factory-controls .el-radio-button__inner) { padding: 10px; font-size: 14px; }
@media (max-width: 1200px) { .factory-overview { padding: 22px; }.factory-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.factory-presentation { flex: none; }.factory-stage { flex: none; }.playback-status { text-align: left; } }
@media (max-width: 640px) { .factory-overview, .factory-overview--screen { padding: 18px 14px; gap: 16px; }.factory-heading h1 { font-size: 23px; }.factory-controls { gap: 8px; }.factory-metrics { gap: 12px; }.factory-metric { padding: 15px 13px; }.factory-metric strong { font-size: 26px; }.factory-footer { flex-wrap: wrap; } }
@media (prefers-reduced-motion: reduce) { .scene-fade-enter-active, .scene-fade-leave-active { transition: none; } }
</style>

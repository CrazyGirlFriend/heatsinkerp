<script setup lang="ts">
import { ArrowLeft, Close, FullScreen, InfoFilled, Pointer, Rank, RefreshRight, ScaleToOriginal, Search, VideoPause, VideoPlay, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDrawer, ElIcon, ElInput, ElOption, ElPopover, ElSelect, ElTooltip } from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FlowPreviewCanvas from '@/components/FlowPreviewCanvas.vue'
import TeamFlowTimeline from '@/components/TeamFlowTimeline.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { teamDirectory } from '@/stores/teamDirectory'
import { currentUser, isAdmin } from '@/stores/auth'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import type { MaterialTrace } from '@/types/materialTrace'
import type { SerialHistory } from '@/types/teamBusiness'
import { materialTransferStatusLabel } from '@/types/materialTransfer'
import { amountLabel, flowByBatch, teamFlowModel, teamFlowOption, traceFlowModel, traceFlowOption, traceTime, type FlowMetric, type FlowSelection, type FlowInteraction } from '@/utils/flowPreview'
import { historyNumber as num } from '@/utils/serialHistoryChart'
import { formatDateTime } from '@/utils/format'
import purposeSnapshot from '@/fixtures/flowPurposeSnapshot.json'

const route = useRoute(), router = useRouter()
const mode = computed(() => route.path === '/material-trace' || route.params.view === 'chain' ? 'chain' : 'team')
const embedded = computed(() => route.path === '/material-trace')
const example = computed(() => route.query.sample === 'purposes')
const serialDraft = ref(''), teamDraft = ref(Number(currentUser.value?.team_id) || 1)
const serial = ref(''), teamId = ref(1), history = ref<SerialHistory | null>(null), trace = ref<MaterialTrace | null>(null)
const loading = ref(false), error = ref(''), metric = ref<FlowMetric>('weight'), motion = ref(true), replay = ref(0)
const selected = ref<FlowSelection | null>(null), selectedId = ref(''), drawerOpen = ref(false), batchNo = ref('')
const chart = ref<InstanceType<typeof FlowPreviewCanvas>>()
const pageRoot = ref<HTMLElement>(), fullscreen = ref(false), zoomLevel = ref(100)
const interaction = ref<FlowInteraction>('select')
let epoch = 0
const localModel = computed(() => history.value ? teamFlowModel(history.value) : null)
const chainModel = computed(() => traceFlowModel(trace.value?.items || [], trace.value?.observed_at))
const hasData = computed(() => mode.value === 'team' ? Boolean(history.value?.groups.length) : Boolean(trace.value?.items.length))
const hasMetricData = computed(() => mode.value === 'chain' || Boolean(localModel.value?.links.some(link => link[metric.value] > 0)))
const chartOption = computed(() => mode.value === 'team' && localModel.value ? teamFlowOption(localModel.value, metric.value) : traceFlowOption(chainModel.value, metric.value, selectedId.value, motion.value, interaction.value, zoomLevel.value))
const colors = computed(() => [...(mode.value === 'team' ? localModel.value?.palette || new Map<string, string>() : chainModel.value.palette)].map(([name, color]) => ({ name, color })))
const detailOptions = computed(() => mode.value === 'team'
  ? (localModel.value?.nodes || []).map(node => ({ value: node.name, label: `${['来源', '用途', '去向'][node.depth]} · ${node.title}` }))
  : chainModel.value.nodes.map(node => ({ value: String(node.batch.id), label: `${node.batch.next_team.name} · ${node.batch.batch_no}` })))
const chartHeight = computed(() => Math.max(560, (localModel.value?.nodes.filter(node => node.depth === 2).length || 0) * 52))
const untracked = computed(() => mode.value === 'team' ? history.value?.untracked_count : trace.value?.untracked_count)
const stats = computed(() => {
  const groups = history.value?.groups || []
  return [{ key: 'incoming', label: '累计接收' }, { key: 'outgoing', label: '累计转出' }, { key: 'on_hand', label: '当前结存' }, { key: 'lost', label: '累计丢失' }].map(item => ({
    label: item.label, quantity: groups.reduce((sum, group) => sum + Number(group[`${item.key}_quantity` as keyof typeof group]), 0), weight: groups.reduce((sum, group) => sum + Number(group[`${item.key}_weight` as keyof typeof group]), 0),
  }))
})
const selectionRows = computed(() => (selected.value?.batches || []).map(code => {
  const flow = flowByBatch(history.value?.flows || [], code), batch = trace.value?.items.find(item => item.batch_no === code)
  return { code, amount: flow || batch, at: flow?.at || batch?.transferred_at || '', status: flow || batch ? materialTransferStatusLabel((flow || batch)!.status, (flow || batch)!.entry_kind) : '' }
}))
const selectedBatch = computed(() => mode.value === 'chain' ? chainModel.value.byId.get(selectedId.value)?.batch : null)
const timeIssues = computed(() => chainModel.value.nodes.filter(node => node.timingIssue).length)
const residenceIssues = computed(() => chainModel.value.nodes.filter(node => node.residenceIssue).length)
const originalPath = computed(() => ({ path: mode.value === 'team' ? `/team-workspaces/${teamId.value}` : '/transfer-batches', query: { serial_no: example.value ? undefined : serial.value || undefined, ...(mode.value === 'team' ? { tab: 'history' } : {}) } }))

async function load(background = false) {
  if (!serial.value) return
  const request = ++epoch, currentMode = mode.value
  if (!background) { loading.value = true; history.value = null; trace.value = null; selected.value = null; selectedId.value = ''; error.value = '' }
  try {
    if (example.value) {
      if (currentMode === 'team') history.value = structuredClone(purposeSnapshot.history) as SerialHistory
      else trace.value = { ...structuredClone(purposeSnapshot.trace), items: purposeSnapshot.trace.items.map(item => ({ ...normalizeMaterialTransfer(item), on_hand_quantity: item.on_hand_quantity, on_hand_weight: item.on_hand_weight })) }
      return
    }
    if (currentMode === 'team') {
      const data = await teamMaterialApi.serialHistory(teamId.value, { serial_no: serial.value })
      if (request === epoch) history.value = data
    } else {
      const data = await materialTransferApi.trace(serial.value)
      if (request === epoch) trace.value = data
    }
  } catch (reason) {
    if (request !== epoch) return
    if (background) throw reason
    error.value = reason instanceof Error ? reason.message : '查询失败，请重试'
  } finally { if (request === epoch) loading.value = false }
}
function search() {
  if (!serialDraft.value.trim()) { error.value = '请输入完整流水号'; return }
  const next = serialDraft.value.trim()
  if (next === serial.value && teamDraft.value === teamId.value) void load()
  else void router.replace({ path: route.path, query: { serial_no: next, ...(mode.value === 'team' ? { team_id: teamDraft.value } : {}) } })
}
function switchData() { void router.replace({ path: route.path, query: example.value ? {} : { sample: 'purposes' } }) }
async function chooseDetail(id: string) {
  if (mode.value === 'team') selected.value = localModel.value?.nodes.find(node => node.name === id) || null
  else {
    const batch = chainModel.value.byId.get(id)?.batch
    if (batch) { selectedId.value = id; await nextTick(); chart.value?.showBatch(id) }
  }
}
function pick(event: { dataIndex: number; dataType?: string; data: unknown }) {
  if (mode.value === 'team') selected.value = event.data as FlowSelection
  else {
    const data = event.data as { batchId?: string } | null
    const batch = (data?.batchId ? chainModel.value.byId.get(data.batchId) : chainModel.value.nodes[event.dataIndex])?.batch
    if (batch) selectedId.value = String(batch.id)
  }
}
function clearSelection() { selected.value = null; selectedId.value = '' }
function canvasShortcut(event: KeyboardEvent) {
  if (mode.value !== 'chain' || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, [contenteditable=true], [role=combobox]')) return
  const key = event.key.toLowerCase()
  if (key === 'v' || key === 'h') { event.preventDefault(); interaction.value = key === 'v' ? 'select' : 'pan' }
  if (key === 'escape') clearSelection()
}
function openBatch(code: string) { if (example.value) return; batchNo.value = code; drawerOpen.value = true }
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === pageRoot.value) await document.exitFullscreen()
    else await pageRoot.value?.requestFullscreen()
  } catch { error.value = '浏览器未能进入全屏，可使用窗口最大化查看。' }
}
function updateFullscreen() { fullscreen.value = document.fullscreenElement === pageRoot.value }
onMounted(() => document.addEventListener('fullscreenchange', updateFullscreen))
const live = useLiveRefresh(() => load(true), { teamId: () => mode.value === 'team' ? teamId.value : undefined, enabled: () => Boolean(serial.value) && !example.value, busy: () => loading.value || Boolean(selected.value) || drawerOpen.value })
watch(() => [route.path, route.params.view, route.query.serial_no, route.query.team_id, route.query.sample], () => {
  ++epoch; loading.value = false; error.value = ''; selected.value = null; selectedId.value = ''; drawerOpen.value = false
  history.value = null; trace.value = null
  serial.value = example.value ? purposeSnapshot.history.serial_no : typeof route.query.serial_no === 'string' ? route.query.serial_no.trim() : ''; serialDraft.value = serial.value
  const id = example.value ? 8 : Number(route.query.team_id || currentUser.value?.team_id || 1)
  teamId.value = teamDraft.value = Number.isSafeInteger(id) && id > 0 ? id : 1
  if (serial.value) void load()
}, { immediate: true })
onBeforeUnmount(() => { ++epoch; document.removeEventListener('fullscreenchange', updateFullscreen) })
</script>

<template>
  <div ref="pageRoot" class="flow-preview-page" :class="{ 'chain-page': mode === 'chain', 'chain-page--embedded': embedded }" @keydown="canvasShortcut">
    <header v-if="mode === 'chain'" class="chain-header">
      <div v-if="!embedded || fullscreen" class="chain-title"><RouterLink v-if="!embedded" :to="originalPath" class="back-link" aria-label="返回转料记录" title="返回转料记录"><ElIcon><ArrowLeft /></ElIcon></RouterLink><h1>全链路追踪</h1></div>
      <h1 v-else class="sr-only">全链路追踪</h1>
      <form class="chain-query" @submit.prevent="search"><ElInput v-model="serialDraft" placeholder="输入完整流水号" aria-label="流水号" clearable maxlength="80" :disabled="example"><template #prepend>流水号</template></ElInput><ElButton type="primary" native-type="submit" :loading="loading" :disabled="example">查询</ElButton></form>
      <div class="chain-actions">
        <span v-if="chainModel.closing !== null" class="chain-asof" :title="`截至 ${traceTime(chainModel.closing)}（北京时间）`">{{ traceTime(chainModel.closing).slice(0, 10) }}</span>
        <span v-if="hasData" class="batch-count">{{ trace?.items.length }} 批次</span>
        <span v-if="example" class="sample-label">演示数据 · 非实时</span>
        <ElButton v-if="route.path !== '/material-trace'" class="sample-toggle" text @click="switchData">{{ example ? '业务数据' : '演示数据' }}</ElButton>
        <ElButton v-if="serial && !example" class="header-icon" :icon="RefreshRight" :loading="loading" aria-label="刷新数据" title="刷新数据" text @click="load()" />
        <ElButton v-if="embedded" class="chain-fullscreen" :icon="FullScreen" :aria-pressed="fullscreen" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏查看' }}</ElButton>
        <ElPopover trigger="click" title="画布说明" :width="320" :append-to="pageRoot">
          <template #reference><ElButton class="header-icon" :icon="InfoFilled" aria-label="画布说明" title="画布说明" text /></template>
          <div class="canvas-help"><p>滚轮缩放 · H 平移 · V 选择 · 双击还原</p><p>浅色横条为在库停留，不代表加工耗时。悬浮查看明细，点击仅高亮关联路径。</p><p>空心点为转出，实心点为接收；虚线为未完成交接。</p><p v-if="chainModel.extent">{{ traceTime(chainModel.first) }}<br>至 {{ traceTime(chainModel.last) }}（北京时间）</p><p v-if="timeIssues">{{ timeIssues }} 个批次时间异常，仅显示有效时间点。</p><p v-if="residenceIssues">{{ residenceIssues }} 个批次历史变动与结存未核平，不推算停留条。</p><p v-if="untracked">{{ untracked }} 个历史批次未纳入库存台账。</p><p v-if="colors.some(entry => entry.name === '未分类')">未登记接收用途的历史批次标为“未分类”。</p><p v-if="example">演示快照，不影响库存。</p></div>
        </ElPopover>
      </div>
    </header>
    <header v-else class="preview-topbar">
      <RouterLink :to="originalPath" class="back-link"><ElIcon><ArrowLeft /></ElIcon>返回业务页面</RouterLink>
      <span class="scope-title">{{ mode === 'team' ? '本班组收发' : '全链路追踪 · 管理员' }}</span>
      <ElButton class="sample-toggle" text @click="switchData">{{ example ? '使用业务数据' : '多用途演示' }}</ElButton>
    </header>
    <div class="preview-main">
      <header v-if="mode === 'team'" class="preview-heading"><div><h1>班组收发流向</h1></div>
        <form @submit.prevent="search"><ElSelect v-if="mode === 'team'" v-model="teamDraft" aria-label="查询班组" :disabled="example || !isAdmin"><ElOption v-for="team in teamDirectory.items" :key="team.id" :value="Number(team.id)" :label="team.name" /></ElSelect><ElInput v-model="serialDraft" placeholder="输入完整流水号" aria-label="流水号" :prefix-icon="Search" clearable maxlength="80" :disabled="example" /><ElButton type="primary" native-type="submit" :loading="loading" :disabled="example">查询</ElButton></form>
      </header>
      <ElAlert v-if="error || live.message.value" :title="error || live.message.value" type="warning" :closable="false" />
      <section v-if="hasData && !loading && mode === 'team' && history" class="team-preview-workspace">
        <header class="identity-row"><div><span class="serial-prefix">流水号</span><strong>{{ serial }}</strong><span class="scope-label">{{ history.team_name }}</span></div><span>当前结存 {{ num(stats[2]!.quantity) }} 件 / {{ num(stats[2]!.weight) }} kg</span></header>
        <TeamFlowTimeline :history="history" :example="example" @select="code => example ? selected = { title: code, description: '演示快照，不打开业务单据', quantity: 0, weight: 0, batches: [code] } : openBatch(code)" />
      </section>
      <section v-else-if="hasData && !loading" class="flow-workspace">
        <header class="chart-toolbar"><div class="chain-legends"><div class="mark-legend" aria-label="图形说明"><span><i class="stay-mark" />在库停留</span><span><i class="departure-mark" />转出</span><span><i class="receipt-mark" />接收</span></div><div class="purpose-legend"><span class="legend-title">接收用途</span><span v-for="entry in colors" :key="entry.name"><i :style="{ background: entry.color }" />{{ entry.name }}</span></div></div><div class="chart-tools"><span v-if="timeIssues" class="data-warning">时间异常 {{ timeIssues }}</span><span v-if="residenceIssues" class="data-warning">历史不完整 {{ residenceIssues }}</span><span v-if="untracked" class="data-warning">未入账 {{ untracked }}</span><ElSelect class="detail-select" placeholder="定位批次" aria-label="选择图形明细" filterable :append-to="pageRoot" :model-value="selectedId || undefined" @change="chooseDetail"><ElOption v-for="option in detailOptions" :key="option.value" :value="option.value" :label="option.label" /></ElSelect></div></header>
        <div class="canvas-area" :style="mode === 'team' ? { height: `${chartHeight}px` } : undefined">
          <FlowPreviewCanvas v-if="hasMetricData && (mode === 'team' || chainModel.extent)" :key="mode" ref="chart" :renderer="mode === 'chain' ? 'svg' : 'canvas'" :option="chartOption" :replay="replay" :motion="motion" :interaction="mode === 'chain' ? interaction : undefined" :label="`${serial}，${mode === 'team' ? history?.team_name + '收发流向' : '全链路时间画布；滚轮缩放，H键平移，V键选择，双击还原；加减键缩放，0键还原'}，件数和重量`" @select="pick" @zoom="zoomLevel = $event" />
          <div v-else class="zero-measure">{{ mode === 'chain' ? '缺少有效时间记录，请通过上方批次查询查看明细。' : '当前记录没有件数。请切换重量查看废屑等按重量记录的物料。' }}</div>
          <template v-if="mode === 'chain' && chainModel.extent">
            <div v-if="selectedId && selectedBatch" class="selection-chip"><span>{{ selectedBatch.batch_no }}</span><button type="button" aria-label="取消路径高亮" @click="clearSelection"><ElIcon><Close /></ElIcon></button></div>
            <div class="canvas-controls" role="group" aria-label="画布工具">
              <div class="canvas-mode" :class="{ 'is-pan': interaction === 'pan' }" role="group" aria-label="操作模式">
                <ElTooltip content="选择批次 · V" :append-to="pageRoot" :show-after="350"><button type="button" aria-label="选择批次" :aria-pressed="interaction === 'select'" @click="interaction = 'select'"><ElIcon><Pointer /></ElIcon></button></ElTooltip>
                <ElTooltip content="拖动画布 · H" :append-to="pageRoot" :show-after="350"><button type="button" aria-label="平移画布" :aria-pressed="interaction === 'pan'" @click="interaction = 'pan'"><ElIcon><Rank /></ElIcon></button></ElTooltip>
              </div>
              <div class="canvas-zoom" role="group" aria-label="视图范围">
                <ElTooltip content="缩小 · −" :append-to="pageRoot" :show-after="350"><button type="button" aria-label="缩小路径" @click="chart?.zoom(-1)"><ElIcon><ZoomOut /></ElIcon></button></ElTooltip>
                <span class="zoom-level" aria-live="polite" aria-label="当前缩放">{{ zoomLevel }}%</span>
                <ElTooltip content="放大 · +" :append-to="pageRoot" :show-after="350"><button type="button" aria-label="放大路径" @click="chart?.zoom(1)"><ElIcon><ZoomIn /></ElIcon></button></ElTooltip>
                <ElTooltip content="还原完整链路 · 0" :append-to="pageRoot" :show-after="350"><button type="button" aria-label="还原完整链路" @click="chart?.zoom(0)"><ElIcon><ScaleToOriginal /></ElIcon></button></ElTooltip>
              </div>
              <div class="canvas-playback" role="group" aria-label="动画与显示">
                <ElTooltip :content="motion ? '关闭动画' : '启用动画'" :append-to="pageRoot" :show-after="350"><button type="button" :aria-label="motion ? '关闭图形动画' : '启用图形动画'" :aria-pressed="motion" @click="motion = !motion"><ElIcon><VideoPause v-if="motion" /><VideoPlay v-else /></ElIcon></button></ElTooltip>
                <ElTooltip content="重新绘制路径" :append-to="pageRoot" :show-after="350"><button type="button" aria-label="重播路径" :disabled="!motion" @click="replay++"><ElIcon><RefreshRight /></ElIcon></button></ElTooltip>
                <ElTooltip v-if="!embedded" :content="fullscreen ? '退出全屏' : '全屏画布'" :append-to="pageRoot" :show-after="350"><button type="button" :aria-label="fullscreen ? '退出全屏' : '全屏画布'" :aria-pressed="fullscreen" @click="toggleFullscreen"><ElIcon><FullScreen /></ElIcon></button></ElTooltip>
              </div>
            </div>
          </template>
        </div>
      </section>
      <div v-else class="preview-empty"><span class="empty-orbit"><ElIcon><Search /></ElIcon></span><h2>{{ mode === 'chain' ? (loading ? '加载中…' : serial ? '暂无记录' : '输入流水号查询') : (loading ? '正在读取批次记录' : serial ? '未找到可展示的记录' : '从一个流水号开始') }}</h2><p v-if="mode === 'team'">{{ loading ? '按真实收发关系组织图形…' : '输入完整流水号，保留前导零。' }}</p></div>
    </div>
    <ElDrawer v-if="mode === 'team'" :model-value="Boolean(selected)" title="流向明细" size="380px" :modal="false" :lock-scroll="false" class="flow-selection-drawer" @close="selected = null">
      <div v-if="selected">
        <h2 class="selection-title">{{ selected.title }}</h2><p class="selection-description">{{ selected.description }}</p><strong class="selection-amount">{{ amountLabel(selected) }}</strong>
        <p class="selection-label">{{ selected.batches.length }} 个关联批次{{ example ? ' · 演示快照，不打开业务单据' : '' }}</p><div class="selection-batches"><button v-for="row in selectionRows" :key="row.code" :disabled="example" @click="openBatch(row.code)"><b>{{ row.code }}</b><span v-if="row.amount">{{ amountLabel(row.amount) }}<em>{{ row.status }}</em></span><small v-if="row.at">{{ formatDateTime(row.at) }}</small><small v-else>查看原始批次</small></button></div>
      </div>
    </ElDrawer>
    <MaterialTransferDrawer v-if="mode === 'team'" v-model="drawerOpen" :batch-no="batchNo" @changed="live.request" />
  </div>
</template>

<style scoped>
.scope-title { font-size: 14px; font-weight: 500; color: #66718a; }
.team-preview-workspace { min-width: 0; }.team-preview-workspace > .identity-row { margin-bottom: 14px; padding: 0; }
.flow-preview-page { --ink: #243149; --muted: #7c879c; height: 100dvh; overflow: auto; background: #f5f6fa; color: var(--ink); font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
.preview-topbar { height: 60px; padding: 0 36px; display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e5e8ef; }
.back-link { display: flex; align-items: center; gap: 9px; color: #65718a; text-decoration: none; font-size: 14px; }.back-link:hover { color: #6655cc; }
.sample-toggle { color: #807397; font-size: 13px; }.detail-select { width: 180px; }.chart-tools { flex-wrap: wrap; }.data-origin.example { color: #a37333; }.selection-batches button:disabled { cursor: default; }.selection-facts { display: grid; grid-template-columns: 90px 1fr; gap: 16px; margin-bottom: 28px; font-size: 13px; }.selection-facts dt { color: #919bad; }.selection-facts dd { margin: 0; color: #465875; }
.preview-topbar nav { display: flex; align-self: stretch; gap: 34px; }.preview-topbar nav button { background: none; border: 0; padding: 0 8px; border-bottom: 3px solid transparent; font: inherit; font-size: 15px; color: #738097; cursor: pointer; }.preview-topbar nav button.active { color: #4d47a5; border-color: #7569cc; font-weight: 600; }
.preview-main { max-width: 1920px; margin: auto; padding: 28px 44px 40px; }.preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 24px; }.preview-heading h1 { font-size: 26px; font-weight: 600; letter-spacing: -.5px; margin: 0; }.preview-heading form { display: flex; gap: 10px; align-items: center; }.preview-heading .el-select { width: 116px; }.preview-heading .el-input { width: 268px; }.preview-heading :deep(.el-input__wrapper), .preview-heading :deep(.el-select__wrapper) { min-height: 42px; }.preview-heading .el-button { height: 42px; background: #6359b9; border-color: #6359b9; }
.flow-workspace { background: #fff; border: 1px solid #e5e9f0; border-radius: 14px; box-shadow: 0 8px 28px #29365304; overflow: hidden; }.identity-row { display: flex; justify-content: space-between; align-items: center; padding: 24px 30px 0; gap: 16px; }.identity-row > div { display: flex; align-items: center; gap: 14px; min-width: 0; flex-wrap: wrap; }.serial-prefix, .data-origin { color: var(--muted); font-size: 12px; }.identity-row strong { font-size: 18px; font-weight: 600; letter-spacing: .3px; overflow-wrap: anywhere; }.scope-label { color: #68608e; background: #f1eef9; font-size: 12px; padding: 4px 9px; border-radius: 4px; }.data-origin { white-space: nowrap; }
.metric-strip { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 0; padding: 22px 30px; }.metric-strip > div { padding-left: 28px; border-left: 1px solid #e9ecf2; }.metric-strip > div:first-child { padding-left: 0; border: 0; }.metric-strip > div > span { font-size: 12px; color: var(--muted); }.metric-strip > div > div { margin-top: 8px; display: flex; align-items: baseline; gap: 7px; font-variant-numeric: tabular-nums; }.metric-strip strong { font-size: 27px; font-weight: 500; letter-spacing: -.6px; }.metric-strip b { font-size: 18px; font-weight: 400; }.metric-strip small { font-size: 12px; color: var(--muted); }.metric-strip i { color: #cbd1df; font-size: 14px; font-style: normal; margin: 0 4px; }
.chart-toolbar { border-block: 1px solid #eef0f5; min-height: 64px; padding: 12px 30px; display: flex; align-items: center; justify-content: space-between; gap: 20px; background: #fcfcfe; }.purpose-legend { display: flex; flex-wrap: wrap; gap: 18px; font-size: 13px; color: #596981; }.purpose-legend > span { display: inline-flex; gap: 7px; align-items: center; }.purpose-legend i { width: 8px; height: 8px; border-radius: 50%; }.purpose-legend .legend-title { color: #929bad; }.chart-tools { display: flex; gap: 16px; align-items: center; }.unit-toggle { display: flex; border: 1px solid #e0e4ee; border-radius: 6px; padding: 3px; background: #fff; }.unit-toggle button { border: 0; border-radius: 3px; padding: 5px 14px; background: transparent; color: #8790a2; font-size: 12px; cursor: pointer; }.unit-toggle button[aria-pressed=true] { background: #edeaf7; color: #645592; font-weight: 600; }.chart-tools :deep(.el-switch) { --el-switch-on-color: #8271b9; }.chart-tools .el-button { background: transparent; color: #736489; border-color: #e1ddeb; }
.flow-column-labels { display: grid; grid-template-columns: repeat(3,1fr); padding: 26px 44px 2px; color: #8f98aa; font-size: 12px; letter-spacing: 1px; }.flow-column-labels > span:nth-child(2) { text-align: center; }.flow-column-labels > span:last-child { text-align: right; }.canvas-area { position: relative; min-height: 520px; background-image: radial-gradient(#e8eaf2 .6px, transparent .6px); background-size: 20px 20px; }
.preview-empty { min-height: 520px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #9ba4b6; border: 1px solid #e7e9f2; border-radius: 14px; background: #fff; margin-top: 24px; }.empty-orbit { display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid #e6e1f2; border-radius: 50%; box-shadow: 0 0 0 16px #f8f6fc; color: #9183b8; font-size: 30px; margin-bottom: 20px; }.preview-empty h2 { font-size: 22px; font-weight: 500; color: #657087; }.preview-empty p { font-size: 14px; }.zero-measure { height: 100%; display: grid; place-items: center; font-size: 15px; color: #7b879b; }
.selection-title { font-size: 20px; color: #33435b; font-weight: 600; overflow-wrap: anywhere; }.selection-description { color: #8491a5; font-size: 14px; line-height: 1.8; }.selection-amount { display: block; font-size: 24px; color: #61519b; margin: 24px 0 32px; font-weight: 500; }.selection-label { color: #98a1b0; font-size: 12px; }.selection-batches { display: grid; gap: 10px; }.selection-batches button { border: 1px solid #e9edf3; border-radius: 7px; background: #fff; padding: 15px; text-align: left; cursor: pointer; display: grid; gap: 8px; font: inherit; }.selection-batches button:hover { border-color: #bdb0d9; background: #fcfaff; }.selection-batches b { font-size: 14px; color: #786397; font-weight: 500; overflow-wrap: anywhere; }.selection-batches span { font-size: 13px; color: #4c5d76; }.selection-batches em { font-style: normal; font-size: 11px; color: #919cac; margin-left: 10px; }.selection-batches small { font-size: 12px; color: #939eb1; }
.chain-page { display: flex; flex-direction: column; background: #fff; overflow: hidden; }
.chain-header { display: flex; align-items: center; flex-shrink: 0; gap: 28px; min-height: 76px; padding: 12px 24px 12px 16px; box-sizing: border-box; border-bottom: 1px solid #e9eaf0; }
.chain-title { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }.chain-title h1 { margin: 0; color: #25253e; font-size: 28px; font-weight: 600; letter-spacing: -.4px; }.chain-title .back-link { width: 40px; height: 40px; justify-content: center; border-radius: 8px; font-size: 18px; }.chain-title .back-link:hover { background: #f4f2fa; }
.chain-query { display: flex; gap: 12px; width: 440px; min-width: 0; }.chain-query .el-input { flex: 1; min-width: 0; }.chain-query :deep(.el-input__wrapper), .chain-query .el-button { min-height: 42px; }.chain-query :deep(.el-input-group__prepend) { background: #f7f6fb; color: #555470; padding: 0 16px; box-shadow: 1px 0 0 0 #e2deed inset, 0 1px 0 0 #e2deed inset, 0 -1px 0 0 #e2deed inset; }.chain-asof { color: #65617f; font-size: 14px; }
.chain-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; white-space: nowrap; }.batch-count { color: #66718a; font-size: 14px; font-variant-numeric: tabular-nums; }.sample-label, .data-warning { color: #99631f; font-size: 12px; }.chain-actions .header-icon { width: 36px; height: 36px; padding: 0; margin-left: 0; color: #737a8d; font-size: 17px; }
.canvas-help { font-size: 13px; line-height: 1.7; color: #64718a; }.canvas-help p { margin: 8px 0; }
.chain-page .preview-main { display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; max-width: none; box-sizing: border-box; padding: 0 24px; }
.chain-page .preview-empty { flex: 1; min-height: 340px; border: 0; margin: 0; }
.chain-page .flow-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; border: 0; border-radius: 0; box-shadow: none; }
.chain-page .chart-toolbar { flex-shrink: 0; background: #fff; padding: 10px 0; min-height: 48px; border: 0; align-items: flex-start; }
.chain-legends { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; padding: 8px 0; }
.mark-legend { display: flex; gap: 24px; padding-right: 24px; border-right: 1px solid #e2deed; color: #4d4969; font-size: 14px; }
.mark-legend span { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; }
.mark-legend i { box-sizing: border-box; width: 14px; height: 14px; border: 2px solid #926de2; border-radius: 50%; }
.mark-legend .stay-mark { width: 32px; border: 0; border-radius: 8px; background: #d9d1f5; }.mark-legend .receipt-mark { background: #926de2; }
.chain-page .purpose-legend { color: #48506d; font-size: 14px; gap: 22px; }
.chain-page .purpose-legend i { width: 22px; height: 4px; border-radius: 3px; }
.chain-page .chart-tools { gap: 12px; }.chain-page .detail-select { width: 220px; }
.chain-page .canvas-area { flex: 1; min-height: 340px; background: #fff; }
.chain-page .canvas-area :deep(.flow-canvas) { min-height: 0; }
.canvas-controls { position: absolute; z-index: 6; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px; width: max-content; max-width: calc(100% - 16px); box-sizing: border-box; border: 1px solid #e6e8ec; border-radius: 18px; background: #fff; box-shadow: 0 8px 26px #1923330d, 0 2px 5px #19233306; }
.canvas-controls > div { display: flex; align-items: center; flex-shrink: 0; }
.canvas-controls > div + div { padding-left: 8px; border-left: 1px solid #e8eaee; }
.canvas-controls button, .selection-chip button { width: 44px; height: 44px; padding: 0; border: 0; border-radius: 12px; display: grid; place-items: center; flex-shrink: 0; background: transparent; color: #626a78; cursor: pointer; transition: background-color 160ms, color 160ms, transform 160ms; }
.canvas-controls button:hover, .selection-chip button:hover { background: #f1f2f5; color: #252b35; }
.canvas-controls button:active { transform: scale(.92); }
.canvas-controls button:focus-visible, .selection-chip button:focus-visible { outline: 2px solid #8072c1; outline-offset: 2px; }
.canvas-controls button:disabled { cursor: not-allowed; color: #c1c5cd; background: transparent; transform: none; }
.canvas-controls .el-icon { font-size: 21px; }
.canvas-mode { position: relative; }
.canvas-mode::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 44px; border-radius: 12px; background: #eef0f3; transition: transform 240ms cubic-bezier(.2,.8,.2,1); }
.canvas-mode.is-pan::before { transform: translateX(44px); }
.canvas-mode button { position: relative; }
.canvas-mode button[aria-pressed=true] { color: #232833; background: transparent; }
.canvas-controls .zoom-level { min-width: 56px; color: #3c4453; text-align: center; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
.selection-chip { position: absolute; z-index: 6; top: 6px; right: 12px; display: flex; align-items: center; gap: 8px; padding-left: 14px; border: 1px solid #e5e1ef; border-radius: 10px; color: #62558c; background: #fff; box-shadow: 0 3px 12px #22283a08; font-size: 13px; }
.selection-chip button { width: 36px; height: 36px; border-radius: 8px; }
@media (max-width: 1000px) { .chain-header { gap: 12px; flex-wrap: wrap; padding-inline: 12px; }.chain-query { flex: 1; min-width: 260px; }.chain-actions { gap: 8px; }.chain-page .chart-toolbar { align-items: center; gap: 8px; flex-wrap: wrap; }.chain-page .preview-main { padding-inline: 16px; }.chain-page .chart-tools { gap: 8px; } }
@media (max-width: 700px) { .chain-page { overflow: auto; }.chain-header { gap: 8px; }.chain-title h1 { font-size: 20px; }.chain-query { order: 1; flex-basis: 100%; }.chain-actions { gap: 4px; }.chain-page .preview-main { min-height: 560px; }.chain-page .canvas-area { min-height: 680px; }.chain-page .canvas-area :deep(.flow-canvas) { min-width: 0; }.chain-page .purpose-legend { gap: 12px; font-size: 13px; }.chain-page .detail-select { width: 180px; }.chain-page .chart-tools { margin-left: auto; } }
@media (max-width: 1250px) { .preview-main { padding: 28px 24px; }.preview-heading { align-items: flex-start; flex-direction: column; gap: 22px; }.preview-heading form { align-self: stretch; }.preview-heading .el-input { flex: 1; max-width: 440px; }.metric-strip { padding: 24px; }.metric-strip > div { padding-left: 20px; }.metric-strip strong { font-size: 24px; }.metric-strip b { font-size: 16px; } }
@media (max-width: 700px) { .preview-topbar { padding: 0 16px; height: 60px; gap: 12px; }.sample-toggle { font-size: 11px; padding-inline: 0; }.preview-topbar nav { gap: 8px; }.preview-topbar nav button { font-size: 13px; white-space: nowrap; }.back-link { font-size: 12px; white-space: nowrap; }.preview-main { padding: 24px 12px; }.preview-heading h1 { font-size: 24px; }.preview-heading form { flex-wrap: wrap; }.preview-heading .el-input { width: 190px; }.metric-strip { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px 0; }.metric-strip > div:nth-child(3) { border: 0; padding: 0; }.chart-toolbar { flex-wrap: wrap; padding: 16px; }.identity-row { padding: 20px 20px 0; flex-wrap: wrap; }.data-origin { display: none; }.data-origin.example { display: block; }.canvas-area { overflow-x: auto; }.canvas-area :deep(.flow-canvas) { min-width: 720px; }.flow-column-labels { padding-inline: 20px; } }
@media (max-width: 572px) { .canvas-controls { flex-wrap: wrap; justify-content: center; width: 322px; gap: 4px 8px; }.canvas-controls .canvas-playback { width: 100%; justify-content: center; padding: 2px 0 0; border-left: 0; border-top: 1px solid #eef0f3; }.canvas-controls .canvas-zoom { padding-left: 4px; }.canvas-controls .zoom-level { min-width: 48px; } }
@media (prefers-reduced-motion: reduce) { .canvas-controls button, .canvas-mode::before, .selection-chip button { transition: none; } }
.chain-page--embedded { height: calc(100dvh - var(--topbar-height)); padding: 16px 20px 20px; box-sizing: border-box; background: var(--workspace-bg); font-family: inherit; }
.chain-page--embedded .chain-header { min-height: 64px; padding: 12px 16px; gap: 16px; border: 1px solid var(--line); border-radius: 8px 8px 0 0; background: var(--surface); }
.chain-page--embedded .chain-query { width: 420px; gap: 8px; }
.chain-page--embedded .chain-query :deep(.el-input__wrapper), .chain-page--embedded .chain-query .el-button, .chain-fullscreen { min-height: 40px; height: 40px; font-size: 15px; }
.chain-page--embedded .preview-main { padding: 0 16px 12px; border: 1px solid var(--line); border-top: 0; border-radius: 0 0 8px 8px; background: var(--surface); }
.chain-page--embedded .chain-legends { gap: 12px; padding: 4px 0; }
.chain-page--embedded .mark-legend { gap: 14px; padding-right: 12px; }
.chain-page--embedded .purpose-legend { gap: 14px; }
.chain-page--embedded .chain-title h1 { font-size: 22px; }
.chain-page--embedded:fullscreen { height: 100dvh; padding: 0; background: #fff; }
.chain-page--embedded:fullscreen .chain-header, .chain-page--embedded:fullscreen .preview-main { border-radius: 0; border: 0; }
@media (max-width: 700px) { .chain-page--embedded { padding: 12px; }.chain-page--embedded .chain-header { gap: 8px; }.chain-page--embedded .chain-actions { width: 100%; justify-content: flex-end; }.chain-page--embedded .chain-query { order: 0; min-width: 0; width: 100%; }.chain-page--embedded .preview-main { padding-inline: 8px; min-height: 660px; }.chain-page--embedded .chain-asof { margin-right: auto; }.chain-page--embedded .canvas-area :deep(.flow-canvas) { min-width: 0; } }
</style>

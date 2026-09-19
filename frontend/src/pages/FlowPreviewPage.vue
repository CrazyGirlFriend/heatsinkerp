<script setup lang="ts">
import { ArrowLeft, Close, FullScreen, Pointer, Rank, RefreshRight, ScaleToOriginal, Search, VideoPause, VideoPlay, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElDrawer, ElIcon, ElInput, ElOption, ElSelect, ElTooltip } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { amountLabel, batchSelection, flowByBatch, teamFlowModel, teamFlowOption, traceFlowModel, traceFlowOption, traceTime, traceDuration, type FlowMetric, type FlowSelection, type FlowInteraction } from '@/utils/flowPreview'
import { historyNumber as num } from '@/utils/serialHistoryChart'
import { formatDateTime } from '@/utils/format'
import purposeSnapshot from '@/fixtures/flowPurposeSnapshot.json'

const route = useRoute(), router = useRouter()
const mode = computed(() => route.path === '/material-trace' || route.params.view === 'chain' ? 'chain' : 'team')
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
const chainModel = computed(() => traceFlowModel(trace.value?.items || []))
const hasData = computed(() => mode.value === 'team' ? Boolean(history.value?.groups.length) : Boolean(trace.value?.items.length))
const hasMetricData = computed(() => mode.value === 'chain' || Boolean(localModel.value?.links.some(link => link[metric.value] > 0)))
const chartOption = computed(() => mode.value === 'team' && localModel.value ? teamFlowOption(localModel.value, metric.value) : traceFlowOption(chainModel.value, metric.value, selectedId.value, motion.value, interaction.value))
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
const selectedNode = computed(() => chainModel.value.byId.get(selectedId.value))
const timeIssues = computed(() => chainModel.value.nodes.filter(node => node.timingIssue).length)
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
function chooseDetail(id: string) {
  if (mode.value === 'team') selected.value = localModel.value?.nodes.find(node => node.name === id) || null
  else {
    const batch = chainModel.value.byId.get(id)?.batch
    if (batch) { selectedId.value = id; selected.value = batchSelection(batch) }
  }
}
function pick(event: { dataIndex: number; dataType?: string; data: unknown }) {
  if (mode.value === 'team') selected.value = event.data as FlowSelection
  else {
    const batch = chainModel.value.nodes[event.dataIndex]?.batch
    if (batch) { selectedId.value = String(batch.id); selected.value = batchSelection(batch) }
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
const live = useLiveRefresh(() => load(true), { enabled: () => Boolean(serial.value) && !example.value, busy: () => loading.value || Boolean(selected.value) || drawerOpen.value })
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
  <div ref="pageRoot" class="flow-preview-page" :class="{ 'chain-page': mode === 'chain' }" @keydown="canvasShortcut">
    <header class="preview-topbar">
      <RouterLink :to="originalPath" class="back-link"><ElIcon><ArrowLeft /></ElIcon>返回业务页面</RouterLink>
      <span class="scope-title">{{ mode === 'team' ? '本班组收发' : '全链路追踪 · 管理员' }}</span>
      <ElButton class="sample-toggle" text @click="switchData">{{ example ? '使用业务数据' : '多用途演示' }}</ElButton>
    </header>
    <main class="preview-main">
      <header class="preview-heading"><div><h1>{{ mode === 'team' ? '班组收发流向' : '流水号全链路' }}</h1></div>
        <form @submit.prevent="search"><ElSelect v-if="mode === 'team'" v-model="teamDraft" aria-label="查询班组" :disabled="example || !isAdmin"><ElOption v-for="team in teamDirectory.items" :key="team.id" :value="Number(team.id)" :label="team.name" /></ElSelect><ElInput v-model="serialDraft" placeholder="输入完整流水号" aria-label="流水号" :prefix-icon="Search" clearable maxlength="80" :disabled="example" /><ElButton type="primary" native-type="submit" :loading="loading" :disabled="example">查询</ElButton></form>
      </header>
      <ElAlert v-if="error || live.message.value" :title="error || live.message.value" type="warning" :closable="false" />
      <section v-if="hasData && !loading && mode === 'team' && history" class="team-preview-workspace">
        <header class="identity-row"><div><span class="serial-prefix">流水号</span><strong>{{ serial }}</strong><span class="scope-label">{{ history.team_name }}</span></div><span>当前结存 {{ num(stats[2]!.quantity) }} 件 / {{ num(stats[2]!.weight) }} kg</span></header>
        <TeamFlowTimeline :history="history" :example="example" @select="code => example ? selected = { title: code, description: '演示快照，不打开业务单据', quantity: 0, weight: 0, batches: [code] } : openBatch(code)" />
      </section>
      <section v-else-if="hasData && !loading" class="flow-workspace">
        <header class="chart-toolbar"><div class="purpose-legend"><span class="legend-title">接收用途</span><span v-for="entry in colors" :key="entry.name"><i :style="{ background: entry.color }" />{{ entry.name }}</span></div><div class="chart-tools"><ElSelect class="detail-select" placeholder="查找批次 / 查看明细" aria-label="选择图形明细" filterable :append-to="mode === 'chain' ? pageRoot : undefined" :model-value="mode === 'chain' ? selectedId || undefined : undefined" @change="chooseDetail"><ElOption v-for="option in detailOptions" :key="option.value" :value="option.value" :label="option.label" /></ElSelect></div></header>
        <div class="chain-guide"><span class="time-window"><time>{{ traceTime(chainModel.first) }}</time><span>—</span><time>{{ traceTime(chainModel.last) }}</time><span>北京时间</span></span><span class="data-origin" :class="{ example }">{{ example ? '演示快照 · 非实时 · 不影响库存' : '业务实数 · 截至当前' }}</span></div>
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
                <ElTooltip :content="fullscreen ? '退出全屏' : '全屏画布'" :append-to="pageRoot" :show-after="350"><button type="button" :aria-label="fullscreen ? '退出全屏' : '全屏画布'" :aria-pressed="fullscreen" @click="toggleFullscreen"><ElIcon><FullScreen /></ElIcon></button></ElTooltip>
              </div>
            </div>
          </template>
        </div>
        <footer class="chart-caption"><span>{{ mode === 'team' ? '流带宽度对应所选计量值；本班组结存不含已转出物料。' : `横轴时间 · 纵轴班组　${interaction === 'pan' ? '拖动平移 · V 切换选择' : '点击查看 · H 切换平移'} · 滚轮缩放` }}</span><span>{{ mode === 'team' ? `${history?.flows.length} 条有效收发` : `${trace?.items.length} 个独立批次` }}<ElButton v-if="!example" text :icon="RefreshRight" @click="load()">同步数据</ElButton></span></footer>
        <div v-if="mode === 'chain' && timeIssues" class="data-note">{{ timeIssues }} 个批次的时间记录不完整或异常，仅绘制已有的有效时间点。</div>
        <div v-if="untracked || colors.some(entry => entry.name === '未分类') || (mode === 'team' && history?.pending_incoming_count)" class="data-note"><span v-if="colors.some(entry => entry.name === '未分类')">历史未登记用途的记录保留为“未分类”。</span><span v-if="untracked">{{ untracked }} 个历史批次未纳入库存台账。</span><span v-if="mode === 'team' && history?.pending_incoming_count">另有 {{ history.pending_incoming_count }} 个待接收批次，尚未计入本班组流入。</span></div>
      </section>
      <div v-else class="preview-empty"><span class="empty-orbit"><ElIcon><Search /></ElIcon></span><h2>{{ loading ? '正在读取批次记录' : serial ? '未找到可展示的记录' : '从一个流水号开始' }}</h2><p>{{ loading ? '按真实收发关系组织图形…' : '输入完整流水号，保留前导零。' }}</p></div>
    </main>
    <ElDrawer :model-value="Boolean(selected)" :title="mode === 'team' ? '流向明细' : '批次路径'" size="380px" :modal="false" :lock-scroll="false" class="flow-selection-drawer" @close="selected = null">
      <template v-if="selected"><h2 class="selection-title">{{ selected.title }}</h2><p class="selection-description">{{ selected.description }}</p><strong class="selection-amount">{{ amountLabel(selected) }}</strong><dl v-if="selectedBatch" class="selection-facts"><dt>接收用途</dt><dd>{{ selectedBatch.purpose_name || '未分类' }}</dd><dt>单据状态</dt><dd>{{ materialTransferStatusLabel(selectedBatch.status, selectedBatch.entry_kind) }}</dd><dt>{{ selectedNode?.intake ? '入库时间' : '转出时间' }}</dt><dd>{{ traceTime(selectedNode?.startedAt ?? null) }}</dd><template v-if="selectedNode && !selectedNode.intake"><dt>{{ selectedBatch.entry_kind === 'inspection_shipment' || selectedBatch.entry_kind === 'warehouse_outbound' ? '对外确认' : '接收时间' }}</dt><dd>{{ traceTime(selectedNode.finishedAt) }}</dd><dt>交接间隔</dt><dd>{{ traceDuration(selectedNode.startedAt, selectedNode.finishedAt) }}</dd></template><dt>当前结存</dt><dd>{{ selectedBatch.on_hand_quantity === null ? '未计入该批接收库存' : amountLabel({ quantity: selectedBatch.on_hand_quantity, weight: selectedBatch.on_hand_weight ?? 0 }) }}</dd></dl><p class="selection-label">{{ selected.batches.length }} 个关联批次{{ example ? ' · 演示快照，不打开业务单据' : '' }}</p><div class="selection-batches"><button v-for="row in selectionRows" :key="row.code" :disabled="example" @click="openBatch(row.code)"><b>{{ row.code }}</b><span v-if="row.amount">{{ amountLabel(row.amount) }}<em>{{ row.status }}</em></span><small v-if="row.at">{{ formatDateTime(row.at) }}</small><small v-else>查看原始批次</small></button></div></template>
    </ElDrawer>
    <MaterialTransferDrawer v-model="drawerOpen" :batch-no="batchNo" @changed="live.request" />
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
.flow-column-labels { display: grid; grid-template-columns: repeat(3,1fr); padding: 26px 44px 2px; color: #8f98aa; font-size: 12px; letter-spacing: 1px; }.flow-column-labels > span:nth-child(2) { text-align: center; }.flow-column-labels > span:last-child { text-align: right; }.canvas-area { position: relative; min-height: 520px; background-image: radial-gradient(#e8eaf2 .6px, transparent .6px); background-size: 20px 20px; }.chain-guide { display: flex; justify-content: space-between; padding: 24px 30px 0; gap: 20px; color: #98a1b3; font-size: 12px; }.chain-guide > span { display: flex; align-items: center; gap: 8px; }.chain-guide i:not(.pending-dot) { width: 32px; height: 1px; background: #c1c8d5; }.pending-dot { width: 6px; height: 6px; border-radius: 50%; background: #d8a453; }
.chart-caption { display: flex; justify-content: space-between; align-items: center; gap: 18px; border-top: 1px solid #edf0f5; padding: 12px 26px; color: #8792a5; font-size: 12px; line-height: 1.8; }.chart-caption > span:last-child { white-space: nowrap; }.chart-caption .el-button { font-size: 12px; color: #7d7094; margin-left: 14px; }.data-note { padding: 0 26px 16px; display: flex; flex-wrap: wrap; gap: 12px; color: #a0a8b8; font-size: 12px; }
.preview-empty { min-height: 520px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #9ba4b6; border: 1px solid #e7e9f2; border-radius: 14px; background: #fff; margin-top: 24px; }.empty-orbit { display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid #e6e1f2; border-radius: 50%; box-shadow: 0 0 0 16px #f8f6fc; color: #9183b8; font-size: 30px; margin-bottom: 20px; }.preview-empty h2 { font-size: 22px; font-weight: 500; color: #657087; }.preview-empty p { font-size: 14px; }.zero-measure { height: 100%; display: grid; place-items: center; font-size: 15px; color: #7b879b; }
.selection-title { font-size: 20px; color: #33435b; font-weight: 600; overflow-wrap: anywhere; }.selection-description { color: #8491a5; font-size: 14px; line-height: 1.8; }.selection-amount { display: block; font-size: 24px; color: #61519b; margin: 24px 0 32px; font-weight: 500; }.selection-label { color: #98a1b0; font-size: 12px; }.selection-batches { display: grid; gap: 10px; }.selection-batches button { border: 1px solid #e9edf3; border-radius: 7px; background: #fff; padding: 15px; text-align: left; cursor: pointer; display: grid; gap: 8px; font: inherit; }.selection-batches button:hover { border-color: #bdb0d9; background: #fcfaff; }.selection-batches b { font-size: 14px; color: #786397; font-weight: 500; overflow-wrap: anywhere; }.selection-batches span { font-size: 13px; color: #4c5d76; }.selection-batches em { font-style: normal; font-size: 11px; color: #919cac; margin-left: 10px; }.selection-batches small { font-size: 12px; color: #939eb1; }
.chain-page { display: flex; flex-direction: column; background: #fff; overflow: hidden; }
.chain-page .preview-topbar { height: 48px; flex-shrink: 0; padding-inline: 28px; }
.chain-page .preview-main { display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; max-width: none; box-sizing: border-box; padding: 16px 28px 0; }
.chain-page .preview-heading { flex-direction: row; align-items: center; justify-content: flex-start; gap: 28px; margin-bottom: 14px; }
.chain-page .preview-heading h1 { font-size: 28px; color: #25253e; }
.chain-page .preview-heading form { align-self: auto; }
.chain-page .flow-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; border: 0; border-radius: 0; box-shadow: none; }
.chain-page .chart-toolbar { flex-shrink: 0; background: #fff; padding: 8px 0; min-height: 44px; border-top: 0; }
.chain-page .purpose-legend { color: #48506d; font-size: 14px; gap: 22px; }
.chain-page .purpose-legend i { width: 22px; height: 4px; border-radius: 3px; }
.chain-page .chart-tools { gap: 12px; }.chain-page .detail-select { width: 244px; }
.chain-page .chain-guide { padding: 10px 0 2px; font-size: 12px; color: #78819c; }
.chain-page .time-window { flex-wrap: wrap; column-gap: 6px; row-gap: 4px; }.time-window > * { white-space: nowrap; }
.chain-page .canvas-area { flex: 1; min-height: 340px; background: #fff; }
.chain-page .canvas-area :deep(.flow-canvas) { min-height: 0; }
.canvas-controls { position: absolute; z-index: 6; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px; width: max-content; max-width: calc(100% - 16px); box-sizing: border-box; border: 1px solid #e6e8ec; border-radius: 18px; background: #fff; box-shadow: 0 8px 26px #1923330d, 0 2px 5px #19233306; }
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
.chain-page .chart-caption { flex-shrink: 0; padding: 8px 0; font-size: 12px; color: #758098; }
.chain-page .data-note { padding: 0 0 8px; font-size: 12px; }
.chain-page .selection-facts { grid-template-columns: 80px minmax(0,1fr); }.chain-page .selection-facts dd { overflow-wrap: anywhere; }
.chain-page:fullscreen .preview-topbar { display: none; }
@media (max-width: 1000px) { .chain-page .chart-toolbar { align-items: flex-start; gap: 8px; flex-wrap: wrap; }.chain-page .preview-main { padding-inline: 16px; }.chain-page .chain-guide { flex-wrap: wrap; gap: 4px; }.chain-page .chart-tools { gap: 8px; }.chain-page .preview-heading { gap: 16px; }.chain-page .preview-heading h1 { font-size: 23px; } }
@media (max-width: 700px) { .chain-page { overflow: auto; }.chain-page .preview-main { min-height: 880px; }.chain-page .preview-heading { align-items: flex-start; flex-direction: column; gap: 12px; }.chain-page .canvas-area :deep(.flow-canvas) { min-width: 0; }.chain-page .chain-guide > span:last-child { display: block; }.chain-page .purpose-legend { gap: 12px; font-size: 12px; }.chain-page .chart-caption { align-items: flex-start; }.chain-page .preview-topbar { padding-inline: 16px; } }
@media (max-width: 1250px) { .preview-main { padding: 28px 24px; }.preview-heading { align-items: flex-start; flex-direction: column; gap: 22px; }.preview-heading form { align-self: stretch; }.preview-heading .el-input { flex: 1; max-width: 440px; }.metric-strip { padding: 24px; }.metric-strip > div { padding-left: 20px; }.metric-strip strong { font-size: 24px; }.metric-strip b { font-size: 16px; } }
@media (max-width: 700px) { .preview-topbar { padding: 0 16px; height: 60px; gap: 12px; }.sample-toggle { font-size: 11px; padding-inline: 0; }.preview-topbar nav { gap: 8px; }.preview-topbar nav button { font-size: 13px; white-space: nowrap; }.back-link { font-size: 12px; white-space: nowrap; }.preview-main { padding: 24px 12px; }.preview-heading h1 { font-size: 24px; }.preview-heading form { flex-wrap: wrap; }.preview-heading .el-input { width: 190px; }.metric-strip { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px 0; }.metric-strip > div:nth-child(3) { border: 0; padding: 0; }.chart-toolbar { flex-wrap: wrap; padding: 16px; }.identity-row { padding: 20px 20px 0; flex-wrap: wrap; }.data-origin { display: none; }.data-origin.example { display: block; }.canvas-area { overflow-x: auto; }.canvas-area :deep(.flow-canvas) { min-width: 720px; }.chain-guide { padding-inline: 20px; }.chain-guide > span:last-child { display: none; }.chart-caption { flex-direction: column; align-items: flex-start; }.flow-column-labels { padding-inline: 20px; } }
@media (max-width: 572px) { .canvas-controls { flex-wrap: wrap; justify-content: center; width: 322px; gap: 4px 8px; }.canvas-controls .canvas-playback { width: 100%; justify-content: center; padding: 2px 0 0; border-left: 0; border-top: 1px solid #eef0f3; }.canvas-controls .canvas-zoom { padding-left: 4px; }.canvas-controls .zoom-level { min-width: 48px; } }
@media (prefers-reduced-motion: reduce) { .canvas-controls button, .canvas-mode::before, .selection-chip button { transition: none; } }
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Box, House, Files, Download, Switch, Right, Warning, Clock, VideoPause, VideoPlay, Refresh, FullScreen, Close, CircleCheck, Sunny } from '@element-plus/icons-vue'
import StatePanel from '@/components/StatePanel.vue'
import FactoryGlassScene from '@/components/FactoryGlassScene.vue'
import FactoryGlassTitle from '@/components/FactoryGlassTitle.vue'
import FactoryStockRing from '@/components/FactoryStockRing.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import type { FactoryLive, LiveBatch } from '@/types/factoryLive'
import { glassLinks, inventoryReconciles, kg, number, stockTypes, sumAmounts } from '@/utils/factoryGlass'
import { formatDateTime } from '@/utils/format'
import { showToast } from '@/stores/toast'

const router = useRouter(), root = ref<HTMLElement>(), closeMore = ref<HTMLButtonElement>(), moreButton = ref<HTMLButtonElement>()
const report = ref<FactoryLive | null>(null), loading = ref(false), error = ref('')
const connection = ref<InventoryConnection>('connecting')
const focus = ref('FACTORY-WAREHOUSE'), selectedRoute = ref('')
const autoRotate = ref(true), animate = ref(true), hidden = ref(document.hidden), reduced = ref(false), moreTypes = ref(false)
const scale = ref(1), density = ref(window.devicePixelRatio || 1), fullscreen = ref(false)
let unsubscribe: (() => void) | undefined, streamVersion = 0, readVersion = 0
let media: MediaQueryList | undefined, rotateTimer: ReturnType<typeof setTimeout> | undefined
const connectionLabel = computed(() => error.value ? (connection.value === 'expired' ? '凭证已失效' : '数据更新中断') : ({ connecting: '正在连接', live: '实时同步', reconnecting: '正在重连', expired: '凭证已失效' })[connection.value])
const teams = computed(() => report.value?.teams || [])
const team = computed(() => teams.value.find(item => item.code === focus.value))
const links = computed(() => report.value ? glassLinks(report.value) : [])
const activeLinks = computed(() => links.value.filter(link => link.pending_batches > 0))
const focusLinks = computed(() => links.value.filter(link => link.source.code === focus.value))
const route = computed(() => links.value.find(link => link.key === selectedRoute.value))
const focusPending = computed(() => focusLinks.value.reduce((total, link) => total + link.pending_batches, 0))
const focusTargets = computed(() => focusLinks.value.filter(link => link.pending_batches > 0).length)
const allTypes = computed(() => stockTypes(report.value?.material_types || []))
const otherTypes = computed(() => allTypes.value.slice(3))
const mainTypes = computed(() => [...allTypes.value.slice(0, 3), { key: 'others', label: `其余 ${otherTypes.value.length} 类`, color: '#899aa8', ...sumAmounts(otherTypes.value) }])
const teamTypes = computed(() => stockTypes(team.value?.material_types || []))
const visibleTypes = computed(() => teamTypes.value.filter(item => item.quantity !== 0 || item.weight !== 0))
const maxTeamWeight = computed(() => Math.max(0, ...teams.value.map(item => item.balance?.on_hand_weight || 0)))
const teamSum = computed(() => sumAmounts(teams.value.filter(item => item.id != null).map(item => ({ quantity: item.balance!.on_hand_quantity, weight: item.balance!.on_hand_weight }))))
const reconciled = computed(() => report.value ? inventoryReconciles(report.value) : true)
const moving = computed(() => animate.value && !hidden.value && !reduced.value && !error.value && connection.value === 'live')
const warning = computed(() => {
  if (!report.value) return ''
  const missing = teams.value.filter(item => item.id == null).map(item => item.name)
  const inactive = teams.value.filter(item => item.id != null && !item.active).map(item => item.name)
  return [!reconciled.value ? '分类库存与汇总不一致，请核对' : '', missing.length ? '未配置：' + missing.join('、') : '',
    inactive.length ? '已停用：' + inactive.join('、') + '，既有库存仍计入' : '',
    report.value.legacy_received_count ? report.value.legacy_received_count + ' 条历史接收未纳入库存' : ''].filter(Boolean).join('；')
})
const weightShare = (weight: number) => report.value?.totals.on_hand_weight ? weight / report.value.totals.on_hand_weight * 100 : 0
const metricSize = (text: string, size: number, length: number) => Math.min(size, size * length / Math.max(text.length, 1)) + 'px'
const batchStatus = (batch: LiveBatch) => ({ pending: '待接收', partial: '部分接收', received: '已接收', dispatched: '已出库', voided: '已作废' })[batch.status]
function batchLabel(batch: LiveBatch) {
  if (batch.entry_kind === 'warehouse_receipt' || batch.entry_kind === 'opening_stock') return (batch.target_name || '库房') + '入库'
  if (batch.entry_kind === 'warehouse_outbound' || batch.entry_kind === 'inspection_shipment') return (batch.source_name || '') + '发出'
  return (batch.source_name || '未填写') + ' → ' + (batch.target_name || '未填写')
}
function selectTeam(code: string, manual = true) {
  const selected = teams.value.find(item => item.code === code)
  if (selected?.id == null) return
  focus.value = code
  selectedRoute.value = focusLinks.value.find(link => link.pending_batches > 0)?.key || focusLinks.value[0]?.key || ''
  if (manual) autoRotate.value = false
}
function selectRoute(key: string) { selectedRoute.value = key; autoRotate.value = false }
function applyReport(value: FactoryLive) {
  if (!Array.isArray(value.material_types) || !value.internal_pending || !Array.isArray(value.links)
      || value.teams.some(item => !Array.isArray(item.material_types))) {
    error.value = '接口尚未提供分类库存，请更新大屏服务。'
    return
  }
  if (report.value && Date.parse(value.as_of) < Date.parse(report.value.as_of)) return
  report.value = value; error.value = ''
  if (!teams.value.some(item => item.code === focus.value && item.id != null)) {
    focus.value = teams.value.find(item => item.id != null)?.code || ''
  }
  if (!focusLinks.value.some(link => link.key === selectedRoute.value)) {
    selectedRoute.value = focusLinks.value.find(link => link.pending_batches > 0)?.key || focusLinks.value[0]?.key || ''
  }
}
async function load() {
  const version = ++readVersion; loading.value = true
  try { const value = await factoryLiveApi.get(); if (version === readVersion) applyReport(value) }
  catch { if (version === readVersion) error.value = report.value ? '更新失败，保留上次成功数据。' : '物料状态加载失败，请重试。' }
  finally { if (version === readVersion) loading.value = false }
}
function connect() {
  const current = ++streamVersion
  unsubscribe?.()
  unsubscribe = factoryLiveApi.subscribe({
    onData(value) { if (current === streamVersion) { ++readVersion; loading.value = false; applyReport(value) } },
    onState(state) {
      if (current !== streamVersion) return
      connection.value = state
      if (state === 'expired') error.value = '登录或访问凭证已失效，请重新验证。'
      else if (state === 'reconnecting') error.value = report.value ? '连接中断，显示上次成功数据，正在重连。' : '物料状态加载失败，正在重连。'
    },
  })
}
function syncVisibility() {
  hidden.value = document.hidden
  if (hidden.value) { ++streamVersion; unsubscribe?.(); unsubscribe = undefined }
  else connect()
}
function syncMotion() { reduced.value = Boolean(media?.matches); if (reduced.value) autoRotate.value = false }
function fit() { scale.value = Math.min((root.value?.clientWidth || innerWidth) / 1672, (root.value?.clientHeight || innerHeight) / 941); density.value = window.devicePixelRatio || 1 }
function syncFullscreen() { fullscreen.value = document.fullscreenElement === root.value || document.fullscreenElement === document.documentElement; fit() }
async function toggleFullscreen() {
  try { if (fullscreen.value) await document.exitFullscreen(); else await root.value?.requestFullscreen() }
  catch { showToast('未能进入全屏，请通过浏览器菜单重试。', 'error') }
}
async function navigate(path: string) {
  autoRotate.value = false
  if (fullscreen.value && document.fullscreenElement) await document.exitFullscreen()
  await router.push(path)
}
function openRoute() {
  if (!route.value) return
  const params = new URLSearchParams({ source_team_id: String(route.value.source_id), next_team_id: String(route.value.target_id) })
  if (route.value.pending_batches) params.set('status', 'pending')
  void navigate('/transfer-batches?' + params.toString())
}
function rememberMoreButton(element: unknown) { if (element instanceof HTMLButtonElement) moreButton.value = element }
async function showTypes() { moreTypes.value = true; autoRotate.value = false; await nextTick(); closeMore.value?.focus() }
function closeTypes() { moreTypes.value = false; moreButton.value?.focus() }
watch([autoRotate, focus, hidden, reduced, error, moreTypes, () => teams.value.map(item => item.id).join(',')], () => {
  clearTimeout(rotateTimer)
  if (!autoRotate.value || hidden.value || reduced.value || error.value || moreTypes.value) return
  const available = teams.value.filter(item => item.id != null)
  if (available.length < 2) return
  rotateTimer = setTimeout(() => {
    const index = available.findIndex(item => item.code === focus.value)
    selectTeam(available[(index + 1) % available.length]!.code, false)
  }, 8000)
})
onMounted(() => {
  fit(); syncFullscreen(); media = window.matchMedia?.('(prefers-reduced-motion: reduce)'); syncMotion()
  media?.addEventListener('change', syncMotion); document.addEventListener('visibilitychange', syncVisibility)
  document.addEventListener('fullscreenchange', syncFullscreen); window.addEventListener('resize', fit)
  if (!hidden.value) connect()
})
onBeforeUnmount(() => {
  ++streamVersion; ++readVersion; unsubscribe?.(); clearTimeout(rotateTimer)
  media?.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility)
  document.removeEventListener('fullscreenchange', syncFullscreen); window.removeEventListener('resize', fit)
  if (fullscreen.value && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <div ref="root" class="factory-glass">
    <main class="dashboard" :class="{ still: !moving }" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }" aria-label="全厂物料流转大屏">
      <img class="campus-background" src="/assets/factory-glass/factory-campus.png" alt="八个班组所在的厂区示意" />
      <div class="campus-tint" />
      <header class="page-header">
        <button class="brand" aria-label="返回系统总览" @click="navigate('/')"><Box /><span>物料运行中心</span></button>
        <span class="header-divider" /><h1>全厂物料流转总览</h1>
        <div class="header-meta"><time>{{ report ? formatDateTime(report.as_of) : '读取状态' }}</time><span class="connection-label" :class="{ stale: error }" role="status">{{ connectionLabel }}</span></div>
        <div class="header-actions">
          <button :class="{ enabled: autoRotate }" :title="autoRotate ? '暂停班组轮播' : '开始班组轮播'" :aria-label="autoRotate ? '暂停班组轮播' : '开始班组轮播'" :disabled="reduced" @click="autoRotate = !autoRotate"><component :is="autoRotate ? VideoPause : VideoPlay" /></button>
          <button :class="{ enabled: moving }" :title="animate ? '暂停流转动效' : '开始流转动效'" :aria-label="animate ? '暂停流转动效' : '开始流转动效'" :disabled="reduced" @click="animate = !animate"><Sunny /></button>
          <button title="刷新物料状态" aria-label="刷新物料状态" :disabled="loading" @click="load"><Refresh /></button>
          <button :title="fullscreen ? '退出全屏' : '全屏展示'" :aria-label="fullscreen ? '退出全屏' : '全屏展示'" @click="toggleFullscreen"><FullScreen /></button>
        </div>
      </header>
      <StatePanel v-if="!report" class="glass-initial glass-panel" :state="error ? 'error' : 'loading'" :description="error" title="读取全厂物料状态" @retry="load" />
      <template v-else>
        <FactoryGlassScene :teams="teams" :links="links" :focus="focus" :selected-route="selectedRoute" :motion="moving" :density="density" @select-team="selectTeam" @select-route="selectRoute" />
        <section class="glass-panel global-stock" aria-label="全厂库存">
          <FactoryGlassTitle :icon="Box">全厂库存</FactoryGlassTitle>
          <div class="global-numbers"><div><strong data-testid="total-quantity" :style="{ fontSize: metricSize(number(report.totals.on_hand_quantity), 37, 6) }">{{ number(report.totals.on_hand_quantity) }}</strong><span>件</span></div><div><strong data-testid="total-weight" :style="{ fontSize: metricSize(kg(report.totals.on_hand_weight), 34, 7) }">{{ kg(report.totals.on_hand_weight) }}</strong><span>kg</span></div></div>
          <div class="chart-caption">类型构成 · 按重量</div>
          <div class="type-segments" aria-label="全厂库存重量占比"><div v-for="item in mainTypes" :key="item.key" :style="{ width: weightShare(item.weight) + '%', background: item.color }" :title="`${item.label}：${weightShare(item.weight).toFixed(1)}%`" /></div>
          <div class="segment-percentages"><span v-for="item in mainTypes.filter(item => item.weight > 0)" :key="item.key"><i :style="{ background: item.color }" />{{ weightShare(item.weight) < 0.1 ? '<0.1' : weightShare(item.weight).toFixed(1) }}%</span></div>
          <div class="global-type-list"><div v-for="item in mainTypes" :key="item.key" class="type-row"><span class="type-dot" :style="{ background: item.color }" /><button v-if="item.key === 'others'" :ref="rememberMoreButton" class="text-button" :aria-expanded="moreTypes" @click="showTypes">{{ item.label }} <span>›</span></button><span v-else>{{ item.label }}</span><div><b>{{ number(item.quantity) }}</b> 件 / <b>{{ kg(item.weight) }}</b> kg</div></div></div>
        </section>
        <section class="glass-panel team-stock" aria-label="班组库存">
          <FactoryGlassTitle :icon="House" detail="单位：件 / kg">班组库存</FactoryGlassTitle>
          <div class="team-stock-list"><button v-for="item in teams" :key="item.code" class="team-stock-row" :class="{ active: item.code === focus }" :disabled="item.id == null" :aria-pressed="item.code === focus" :aria-label="`切换到${item.name}`" @click="selectTeam(item.code)"><span>{{ item.name }}</span><span class="team-bar-track"><span :style="{ width: (maxTeamWeight ? (item.balance?.on_hand_weight || 0) / maxTeamWeight * 100 : 0) + '%' }" /></span><span class="team-row-values">{{ item.id == null ? '未配置' : `${number(item.balance?.on_hand_quantity)} / ${kg(item.balance?.on_hand_weight)}` }}</span></button></div>
          <div class="team-sum"><span>合计</span><strong>{{ number(teamSum.quantity) }} <small>件 /</small> {{ kg(teamSum.weight) }} <small>kg</small></strong><CircleCheck v-if="reconciled" title="班组分类库存与全厂合计一致" /><Warning v-else title="分类库存与汇总不一致" /></div>
        </section>
        <section class="glass-panel team-types" :aria-label="`${team?.name || '班组'}类型构成`">
          <FactoryGlassTitle :icon="Files" :detail="`${autoRotate ? '班组轮播' : '当前班组'} ${Math.max(0, teams.findIndex(item => item.code === focus) + 1)}/8`">{{ team?.name || '班组' }} · 类型构成</FactoryGlassTitle>
          <div class="type-panel-caption"><span>按重量</span><span>件 / kg</span></div>
          <div v-if="team?.id != null" class="team-types-body"><div><FactoryStockRing :items="teamTypes" :motion="moving" /><div class="donut-quantity">{{ number(team.balance?.on_hand_quantity) }}<small> 件</small></div></div><div class="team-type-legend" :class="{ many: visibleTypes.length > 6 }"><div v-for="item in visibleTypes" :key="item.key" class="detail-type-row"><span class="type-dot" :style="{ background: item.color }" /><span :title="item.label">{{ item.label }}</span><b>{{ number(item.quantity) }} / {{ kg(item.weight) }}</b></div><p v-if="!visibleTypes.length" class="zero-types">暂无在库物料</p><p v-else-if="visibleTypes.length < teamTypes.length" class="zero-types">其余 {{ teamTypes.length - visibleTypes.length }} 类为 0</p></div></div>
          <p v-else class="panel-empty">班组尚未配置</p>
          <div v-if="autoRotate && !reduced && !hidden && !error" :key="focus" class="rotation-progress" />
        </section>
        <section class="glass-panel pending-panel" aria-label="班组间待接收">
          <FactoryGlassTitle :icon="Download">班组间待接收</FactoryGlassTitle>
          <div class="pending-big"><div><strong data-testid="pending-count" :style="{ fontSize: metricSize(number(report.internal_pending.batches), 53, 3) }">{{ number(report.internal_pending.batches) }}</strong><span>批</span></div><div><strong data-testid="pending-links">{{ activeLinks.length }}</strong><span>条线路</span></div></div>
          <div class="transit-numbers"><strong>{{ number(report.internal_pending.quantity) }}</strong><span>件 /</span><strong>{{ kg(report.internal_pending.weight) }}</strong><span>kg</span></div>
        </section>
        <section class="glass-panel focus-panel" aria-label="当前班组发出待接收">
          <FactoryGlassTitle :icon="Switch">{{ team?.name || '班组' }} · 发出待接收</FactoryGlassTitle>
          <div class="focus-numbers"><strong>{{ number(focusPending) }}<small> 批</small></strong><div><b>{{ focusTargets }}</b><span>个接收班组</span></div></div>
          <div v-if="focusLinks.length" class="focus-routes"><button v-for="link in focusLinks" :key="link.key" :class="{ chosen: link.key === selectedRoute }" :aria-pressed="link.key === selectedRoute" :aria-label="`选择${link.source.name}到${link.target.name}线路`" @click="selectRoute(link.key)"><Right /><strong>{{ link.target.name }}</strong><span>{{ link.pending_batches ? `${number(link.pending_batches)} 批` : '已接收' }}</span></button></div>
          <p v-else class="panel-empty">暂无待接收或近 24 小时接收线路</p>
        </section>
        <div class="glass-panel line-legend"><div><span class="legend-line focused" />亮线：{{ team?.name || '选中班组' }}发出</div><div><span class="legend-line" />细线：其他流转 <small>虚线已接收</small></div></div>
        <section class="glass-panel attention-panel"><FactoryGlassTitle :icon="Warning">需要关注</FactoryGlassTitle><div class="attention-content"><template v-if="team?.urgent_serial_count"><span class="urgent-dot" />{{ team.name }} · {{ team.urgent_serial_count }} 个加急流水号</template><template v-else><CircleCheck />{{ team?.id != null ? '当前班组无加急在库' : '班组尚未配置' }}</template></div></section>
        <section class="glass-panel recent-panel"><FactoryGlassTitle :icon="Clock">最近批次</FactoryGlassTitle><div class="recent-list"><button v-for="batch in report.recent_batches.slice(0, 3)" :key="batch.batch_no" class="recent-item" :title="`${batch.batch_no} · ${number(batch.quantity)} 件 / ${kg(batch.weight)} kg`" @click="navigate('/transfer-batches/scan?batch_no=' + encodeURIComponent(batch.batch_no))"><time>{{ formatDateTime(batch.updated_at).slice(5, 10) }}</time><span :title="batchLabel(batch)">{{ batchLabel(batch) }}</span><b>{{ number(batch.quantity) }} 件 <small>{{ batchStatus(batch) }}</small></b></button><p v-if="!report.recent_batches.length" class="panel-empty">暂无批次记录</p></div></section>
        <section class="route-console glass-panel" aria-label="选中线路详情"><template v-if="route"><div class="current-route"><span class="console-eyebrow">当前线路</span><strong>{{ route.source.name }}<Right />{{ route.target.name }}</strong><span class="route-status" :class="{ done: !route.pending_batches }">{{ route.pending_batches ? `待接收 ${number(route.pending_batches)} 批 · ${number(route.pending_quantity)} 件 / ${kg(route.pending_weight)} kg` : '全部接收完成 · 光点已停止' }}</span></div><button class="route-detail-button" @click="openRoute">{{ route.pending_batches ? '查看待接收' : '查看流转记录' }}<Right /></button></template><span v-else class="route-empty">{{ team?.name || '当前班组' }}暂无待接收或近 24 小时接收线路</span><p>在库库存与在途物料分开统计 · 接收状态随业务确认实时更新</p></section>
        <div class="scene-caption">班组多对多流转示意 · 按实际业务记录连线</div>
      </template>
      <div v-if="report && (error || warning)" class="live-notices" role="status"><Warning /><span>{{ [error, warning].filter(Boolean).join('；') }}</span><button v-if="error" @click="load">重试</button></div>
      <div v-if="moreTypes" class="types-backdrop" @click="closeTypes"><section class="types-dialog glass-panel" role="dialog" aria-modal="true" aria-label="其他类型库存" @click.stop @keydown.esc="closeTypes" @keydown.tab.prevent="closeMore?.focus()"><div class="dialog-heading"><h2>其他类型库存</h2><button ref="closeMore" aria-label="关闭类型明细" @click="closeTypes"><Close /></button></div><p>与原材料、半成品、成品共同计入全厂在库库存</p><div class="other-type-table"><div v-for="item in otherTypes" :key="item.key"><span class="type-dot" :style="{ background: item.color }" /><span>{{ item.label }}</span><b>{{ number(item.quantity) }} <small>件</small></b><b>{{ kg(item.weight) }} <small>kg</small></b></div></div><footer>合计 <b>{{ number(sumAmounts(otherTypes).quantity) }} 件 / {{ kg(sumAmounts(otherTypes).weight) }} kg</b></footer></section></div>
    </main>
  </div>
</template>
<style src="@/styles/factoryGlass.css"></style>

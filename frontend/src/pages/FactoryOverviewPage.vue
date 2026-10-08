<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElInputNumber, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSwitch } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import FactoryOverviewCharts from '@/components/FactoryOverviewCharts.vue'
import PageBackButton from '@/components/PageBackButton.vue'
import FactoryRecentBatches from '@/components/FactoryRecentBatches.vue'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { formatDateTime } from '@/utils/format'
import type { Metric } from '@/types/materialAnalytics'
import type { FactoryOverview, FactoryTeam, FactoryScene, FactoryRecentBatch } from '@/types/factoryOverview'

const route = useRoute(), router = useRouter()
const days = computed(() => {
  const value = typeof route.query.days === 'string' ? Number(route.query.days) : NaN
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 30
})
const periodSelect = ref<InstanceType<typeof ElSelect>>()
const customDays = ref<number | undefined>(days.value)
const validCustomDays = computed(() => Number.isInteger(customDays.value) && customDays.value! >= 1 && customDays.value! <= 365)
const periodOptions = computed(() => [...new Set([3, 7, 14, 30, days.value])].sort((a, b) => a - b))
const metric = computed<Metric>(() => route.query.metric === 'quantity' ? 'quantity' : 'weight')
const autoRefresh = ref(true)
const report = ref<FactoryOverview | null>(null), loading = ref(false), error = ref('')
let version = 0, timer: ReturnType<typeof setInterval> | undefined
let media: MediaQueryList | undefined
const scenes: { key: FactoryScene; label: string }[] = [{ key: 'overview', label: '全厂概况' }, { key: 'stock', label: '库存分析' }, { key: 'handoff', label: '交接与异常' }]
const sceneIndex = ref(0), hidden = ref(document.hidden), reduced = ref(false)
const scene = computed(() => scenes[sceneIndex.value]!)
const motion = computed(() => !reduced.value && !hidden.value && !error.value)
function syncVisibility() { hidden.value = document.hidden }
function syncMotion() { reduced.value = Boolean(media?.matches) }
const unit = computed(() => metric.value === 'weight' ? 'kg' : '件')
const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const warning = computed(() => {
  if (!report.value) return ''
  const missing = report.value.teams.filter(team => !team.id).map(team => team.name)
  const inactive = report.value.teams.filter(team => team.id && !team.active).map(team => team.name)
  const gap = report.value.totals
  return [(gap.shortage_quantity ?? 0) > 0 || (gap.shortage_weight ?? 0) > 0 ? `账面缺口 ${number(gap.shortage_quantity)} 件 / ${number(gap.shortage_weight)} kg` : '', missing.length ? `未配置：${missing.join('、')}，汇总范围不完整` : '', inactive.length ? `停用班组仍保留库存：${inactive.join('、')}` : '', report.value.legacy_received_count ? `${report.value.legacy_received_count} 条历史接收未纳入库存` : ''].filter(Boolean).join('；')
})
const metrics = computed(() => {
  const d = report.value
  if (!d) return []
  return [
    { key: 'stock', label: '全厂在库物料', value: d.totals[`on_hand_${metric.value}`], detail: `在途 ${number(d.totals[`in_transit_${metric.value}`])} ${unit.value}`, hint: '这里仅统计未转出的物料；已转出但未签收的物料单列显示。', accent: true },
    { key: 'pending', label: '待交接物料', value: d.pending[metric.value], detail: `${d.pending.batches} 批待确认`, hint: '含内部待签收及对外待确认物料。' },
    { key: 'inbound', label: `近${d.days}天入库`, value: d.period_totals.inbound[metric.value], hint: '库房已登记入库。' },
    { key: 'outbound', label: `近${d.days}天对外出库`, value: d.period_totals.outbound[metric.value] + d.period_totals.shipment[metric.value], hint: `含库房对外出库和检验发货；检验发货 ${number(d.period_totals.shipment[metric.value])} ${unit.value}。` },
  ]
})
function preference(values: Record<string, string>) { void router.replace({ path: route.path, query: { ...route.query, ...values } }) }
function applyCustomDays() {
  if (!validCustomDays.value) return
  preference({ days: String(customDays.value) })
  periodSelect.value?.blur()
}
async function load() {
  const current = ++version; loading.value = true
  try { const result = await factoryOverviewApi.get(days.value); if (current === version) { report.value = result; error.value = '' } }
  catch { if (current === version) error.value = report.value ? '更新失败，当前显示上次成功读取的数据。' : '全厂数据加载失败，请重试。' }
  finally { if (current === version) loading.value = false }
}
function openTeam(team: FactoryTeam) { if (team.id && team.active) void router.push(`/team-workspaces/${team.id}?tab=stock`) }
function openBatch(row: FactoryRecentBatch) { void router.push(`/transfer-batches?batch_no=${encodeURIComponent(row.batch_no)}`) }
watch(days, load, { immediate: true })
watch(days, value => { customDays.value = value })
onMounted(() => {
  document.addEventListener('visibilitychange', syncVisibility)
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)'); syncMotion()
  media?.addEventListener('change', syncMotion)
  timer = setInterval(() => { if (autoRefresh.value && !document.hidden && !loading.value) void load() }, 60000)
})
onBeforeUnmount(() => { ++version; if (timer) clearInterval(timer); media?.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility) })
</script>
<template>
  <section class="page factory-overview">
    <header class="factory-heading">
      <PageBackButton />
      <div class="factory-heading-title"><h1>全厂物料总览</h1><p v-if="report">{{ formatDateTime(report.as_of) }} 更新</p></div>
      <div class="factory-controls">
        <ElRadioGroup :model-value="metric" size="small" aria-label="全厂统计单位" @update:model-value="preference({ metric: String($event) })"><ElRadioButton value="weight">重量</ElRadioButton><ElRadioButton value="quantity">件数</ElRadioButton></ElRadioGroup>
        <ElSelect ref="periodSelect" :model-value="days" :teleported="false" :fit-input-width="false" size="small" aria-label="全厂统计周期" @update:model-value="preference({ days: String($event) })" @visible-change="customDays = days">
          <ElOption v-for="value in periodOptions" :key="value" :value="value" :label="`近${value}天`" />
          <template #footer><form class="factory-custom-period" @submit.prevent="applyCustomDays"><label for="factory-custom-days">自定义天数</label><div><ElInputNumber id="factory-custom-days" v-model="customDays" :min="1" :max="365" :precision="0" :controls="false" size="small" placeholder="1–365" aria-label="自定义统计天数" /><span>天</span><ElButton native-type="submit" type="primary" size="small" :disabled="!validCustomDays">确定</ElButton></div></form></template>
        </ElSelect>
        <ElSwitch v-model="autoRefresh" size="small" aria-label="每60秒自动刷新" active-text="自动刷新" />
        <ElButton :icon="Refresh" :loading="loading" size="small" @click="load">刷新</ElButton>
      </div>
    </header>
    <ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon />
    <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
    <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!report" state="loading" title="正在读取全厂物料" />
    <template v-else>
      <section class="factory-metrics" aria-label="全厂关键数据">
        <article v-for="item in metrics" :key="item.key" class="factory-metric" :class="{ 'factory-metric--primary': item.accent }">
          <h2 :title="item.hint">{{ item.label }}</h2><div><strong><AnimatedMetric :key="`${item.key}-${metric}-${report.days}`" :value="item.value" :animate="motion" :precision="metric === 'quantity' ? 0 : 3" /></strong><span>{{ unit }}</span><small v-if="item.detail">{{ item.detail }}</small></div>
        </article>
      </section>
      <nav class="factory-sections" aria-label="分析分类">
        <button v-for="(item, i) in scenes" :key="item.key" type="button" :aria-pressed="sceneIndex === i" @click="sceneIndex = i">{{ item.label }}</button>
      </nav>
      <section class="factory-presentation">
        <div class="factory-stage" :aria-label="scene.label">
          <Transition name="scene-fade" mode="in-out" :css="motion">
            <FactoryOverviewCharts :key="scene.key" :data="report" :metric="metric" :scene="scene.key" :motion="motion" @team="openTeam" />
          </Transition>
        </div>
        <FactoryRecentBatches :rows="report.recent_batches || []" :motion="motion" @open="openBatch"><template #actions><ElButton link type="primary" @click="router.push('/transfer-batches')">查看全部</ElButton></template></FactoryRecentBatches>
      </section>
    </template>
  </section>
</template>
<style scoped>
.factory-overview { --dashboard-surface: #fff; --dashboard-line: var(--line); --dashboard-muted: var(--muted); display: flex; flex-direction: column; gap: 14px; padding: 20px 24px; color: var(--text); background: var(--workspace-bg); overflow-y: auto; }
.factory-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }.factory-heading h1 { margin: 0; font-size: 22px; line-height: 30px; font-weight: 550; }.factory-heading p { font-size: 12px; line-height: 18px; color: var(--dashboard-muted); margin: 4px 0 0; }
.factory-heading-title { margin-right: auto; }
.factory-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }.factory-controls > .el-select { width: 96px; }.factory-controls :deep(.el-switch__label) { font-size: 12px; }
.factory-controls :deep(.el-button), .factory-controls :deep(.el-select__wrapper) { min-height: 34px; font-size: 13px; }.factory-controls :deep(.el-radio-button__inner) { padding: 9px 12px; font-size: 13px; }
.factory-custom-period { display: grid; gap: 8px; padding: 2px 0; }.factory-custom-period > label { font-size: 12px; color: var(--muted); }.factory-custom-period > div { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }.factory-custom-period .el-input-number { width: 96px; }
.factory-metrics { display: grid; grid-template-columns: 1.25fr repeat(3, minmax(0, 1fr)); gap: 14px; flex-shrink: 0; }.factory-metric { padding: 15px 20px; border-radius: var(--card-radius); border: 1px solid var(--dashboard-line); background: var(--dashboard-surface); min-width: 0; }.factory-metric--primary { background: var(--surface-soft); border-color: #dce8df; }.factory-metric h2 { font-size: 13px; line-height: 20px; color: var(--dashboard-muted); font-weight: 500; margin: 0 0 9px; }.factory-metric > div { display: flex; flex-wrap: wrap; gap: 3px 7px; align-items: baseline; }.factory-metric strong { font-size: clamp(26px, 2.1vw, 34px); line-height: 1.15; letter-spacing: -.7px; font-variant-numeric: tabular-nums; font-weight: 550; }.factory-metric--primary strong { color: #28643d; }.factory-metric > div > span { font-size: 12px; color: var(--dashboard-muted); }.factory-metric small { margin-left: auto; color: var(--dashboard-muted); font-size: 12px; line-height: 18px; white-space: nowrap; }
.factory-sections { display: flex; align-self: flex-start; flex-shrink: 0; gap: 4px; padding: 4px; border: 1px solid #e3eae5; border-radius: 9px; background: #eaf0ec; }.factory-sections button { padding: 6px 18px; border: 0; border-radius: 6px; color: var(--dashboard-muted); background: transparent; font-size: 13px; line-height: 20px; transition: color 180ms ease, background 180ms ease, box-shadow 180ms ease; }.factory-sections button:hover { color: var(--primary); }.factory-sections button[aria-pressed="true"] { color: var(--primary); background: #fff; box-shadow: 0 1px 3px rgb(36 49 42 / 8%); font-weight: 550; }
/* Keep every record row visible; let the charts absorb the remaining height. */
.factory-presentation { display: grid; grid-template-rows: minmax(240px, 1fr) max-content; flex: 1; min-height: 0; gap: 14px; }.factory-stage { display: grid; min-height: 0; }.factory-stage > .factory-charts { grid-area: 1 / 1; }.scene-fade-enter-active, .scene-fade-leave-active { transition: opacity 200ms ease, transform 200ms ease; }.scene-fade-enter-from { opacity: 0; transform: translateY(4px); }.scene-fade-leave-to { opacity: 0; }
@media (min-width: 1101px) and (max-height: 800px) {
  .factory-overview { padding: 12px 18px; gap: 10px; }.factory-heading > .factory-heading-title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }.factory-heading p { margin: 0; }.factory-heading h1 { font-size: 21px; line-height: 28px; }
  .factory-metrics { gap: 12px; }.factory-metric { padding: 10px 16px; }.factory-metric h2 { margin-bottom: 6px; line-height: 18px; }.factory-metric strong { font-size: 28px; }
  .factory-sections { padding: 3px; }.factory-sections button { padding-block: 4px; }.factory-presentation { grid-template-rows: minmax(210px, 1fr) max-content; gap: 10px; }
}
@media (min-width: 1101px) and (max-height: 700px) { .factory-overview { padding: 8px 16px; gap: 8px; }.factory-metric { padding-block: 8px; }.factory-sections button { padding-block: 3px; }.factory-presentation { gap: 8px; } }
@media (max-width: 1100px) { .factory-overview { padding: 18px; }.factory-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.factory-presentation { display: flex; flex-direction: column; flex: none; }.factory-stage { min-height: 0; } }
@media (max-width: 640px) { .factory-overview { padding: 18px 14px; gap: 14px; }.factory-heading { gap: 14px; }.factory-heading h1 { font-size: 21px; }.factory-controls { gap: 8px; }.factory-metrics { gap: 10px; }.factory-metric { padding: 14px 12px; }.factory-metric strong { font-size: 26px; }.factory-metric small { flex-basis: 100%; margin-top: 4px; }.factory-sections { align-self: stretch; }.factory-sections button { flex: 1; padding-inline: 6px; white-space: nowrap; } }
@media (prefers-reduced-motion: reduce) { .scene-fade-enter-active, .scene-fade-leave-active { transition: none; } }
</style>

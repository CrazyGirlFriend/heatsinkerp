<script setup lang="ts">
import { formatAmount as number } from '@/utils/format'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElOption } from 'element-plus'
import ElAlert from '@/components/AppAlert.vue'
import ElButton from '@/components/AppButton.vue'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElSelect from '@/components/AppSelect.vue'
import ElSwitch from '@/components/AppSwitch.vue'
import DashboardToolbar from '@/components/DashboardToolbar.vue'
import DashboardMetric from '@/components/DashboardMetric.vue'
import { Refresh } from '@element-plus/icons-vue'
import TableExportButton from '@/components/TableExportButton.vue'
import { tableExportSource } from '@/utils/tableExport'
import { materialTypeLabel } from '@/types/materialTransfer'
import FactoryOverviewCharts from '@/components/FactoryOverviewCharts.vue'
import FactoryOperationsOverview from '@/components/FactoryOperationsOverview.vue'
import WatermelonSegmented from '@/components/watermelon/WatermelonSegmented.vue'
import FactoryPerformancePanel from '@/components/FactoryPerformancePanel.vue'
import PageBackButton from '@/components/PageBackButton.vue'
import FactoryRecentBatches from '@/components/FactoryRecentBatches.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import type { Metric } from '@/types/materialAnalytics'
import type { FactoryOverview, FactoryTeam, FactoryRecentBatch } from '@/types/factoryOverview'

const route = useRoute(),
  router = useRouter()
const view = computed(() =>
  route.query.view === 'inventory'
    ? 'inventory'
    : route.query.view === 'quality'
      ? 'quality'
      : route.query.view === 'production'
        ? 'production'
        : 'overview',
)
const sections = [
  { key: 'overview', label: '运行概览' },
  { key: 'production', label: '生产完成' },
  { key: 'quality', label: '检验与质量' },
  { key: 'inventory', label: '库存与交接' },
] as const
type SectionKey = (typeof sections)[number]['key']
const page = ref<HTMLElement>(),
  heading = ref<HTMLElement>(),
  activeSection = ref<SectionKey>(view.value)
let anchoredSection: SectionKey | undefined = view.value === 'overview' ? undefined : view.value
let sectionObserver: ResizeObserver | undefined
function releaseAnchor() {
  anchoredSection = undefined
}
function sectionElement(key: SectionKey) {
  return page.value?.querySelector<HTMLElement>(`#factory-${key}`)
}
function scrollToSection(key: SectionKey, animate = true) {
  const root = page.value,
    section = sectionElement(key)
  if (!root || !section) return
  activeSection.value = key
  root.scrollTo?.({
    top:
      root.scrollTop +
      section.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      (heading.value?.offsetHeight || 0) -
      32,
    behavior: animate && motion.value ? 'smooth' : 'auto',
  })
}
function navigateSection(key: SectionKey) {
  anchoredSection = key
  if (view.value === key) scrollToSection(key)
  else preference({ view: key })
}
function syncSection() {
  if (!page.value || !heading.value) return
  const line = heading.value.getBoundingClientRect().bottom + 40
  activeSection.value = sections.reduce<SectionKey>(
    (current, section) =>
      (sectionElement(section.key)?.getBoundingClientRect().top ?? Infinity) <= line
        ? section.key
        : current,
    'overview',
  )
}
const days = computed(() => {
  const value = typeof route.query.days === 'string' ? Number(route.query.days) : NaN
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 7
})
const periodSelect = ref<{ blur: () => void }>()
const customDays = ref<number | undefined>(days.value)
const validCustomDays = computed(
  () => Number.isInteger(customDays.value) && customDays.value! >= 1 && customDays.value! <= 365,
)
const periodOptions = computed(() => [...new Set([3, 7, 14, 30, days.value])].sort((a, b) => a - b))
const metric = computed<Metric>(() => (route.query.metric === 'quantity' ? 'quantity' : 'weight'))
const autoRefresh = ref(true)
const report = ref<FactoryOverview | null>(null),
  loading = ref(false),
  error = ref('')
let version = 0,
  timer: ReturnType<typeof setInterval> | undefined
let media: MediaQueryList | undefined
const hidden = ref(document.hidden),
  reduced = ref(false)
const motion = computed(() => !reduced.value && !hidden.value && !error.value)
function syncVisibility() {
  hidden.value = document.hidden
}
function syncMotion() {
  reduced.value = Boolean(media?.matches)
}
const unit = computed(() => (metric.value === 'weight' ? 'kg' : '件'))

const warning = computed(() => {
  if (!report.value) return ''
  const missing = report.value.teams.filter((team) => !team.id).map((team) => team.name)
  const inactive = report.value.teams
    .filter((team) => team.id && !team.active)
    .map((team) => team.name)
  return [
    missing.length ? `未配置：${missing.join('、')}，汇总范围不完整` : '',
    inactive.length ? `停用班组仍保留库存：${inactive.join('、')}` : '',
    report.value.legacy_received_count
      ? `${report.value.legacy_received_count} 条历史接收未纳入库存`
      : '',
  ]
    .filter(Boolean)
    .join('；')
})
const metrics = computed(() => {
  const d = report.value
  if (!d) return []
  return [
    {
      key: 'stock',
      label: '全厂在库物料',
      value: d.totals[`on_hand_${metric.value}`],
      detail: `在途 ${number(d.totals[`in_transit_${metric.value}`])} ${unit.value}`,
      hint: '这里仅统计未转出的物料；已转出但未签收的物料单列显示。',
      accent: true,
    },
    {
      key: 'pending',
      label: '待交接物料',
      value: d.pending[metric.value],
      detail: `${d.pending.batches} 批待确认`,
      hint: '含内部待签收及对外待确认物料。',
    },
    {
      key: 'inbound',
      label: `近${d.days}天入库`,
      value: d.period_totals.inbound[metric.value],
      trend: d.trend.map((row) => row.inbound[metric.value]),
      hint: '库房已登记入库。',
    },
    {
      key: 'outbound',
      label: `近${d.days}天对外出库`,
      value: d.period_totals.outbound[metric.value] + d.period_totals.shipment[metric.value],
      trend: d.trend.map((row) => row.outbound[metric.value] + row.shipment[metric.value]),
      trendColor: '#9a83df',
      hint: `含库房对外出库和检验发货；检验发货 ${number(d.period_totals.shipment[metric.value])} ${unit.value}。`,
    },
  ]
})
function exportSource() {
  const data = report.value
  if (!data) return null
  const key = metric.value,
    rows: { category: string; name: string; date?: string; value: number | null }[] = []
  for (const item of metrics.value)
    rows.push({ category: '全厂合计', name: item.label || item.key, value: item.value })
  for (const team of data.teams)
    rows.push({
      category: '班组库存',
      name: team.name,
      value: team.balance?.[`on_hand_${key}`] ?? null,
    })
  for (const kind of data.material_types)
    rows.push({
      category: '物料性质',
      name: kind.label || materialTypeLabel(kind.key),
      value: kind[key],
    })
  for (const day of data.trend)
    for (const [flow, label] of [
      ['inbound', '库房入库'],
      ['outbound', '库房对外出库'],
      ['shipment', '检验发货'],
    ] as const)
      rows.push({ category: '全厂对外收发', name: label, date: day.key, value: day[flow][key] })
  for (const item of data.stock_age)
    rows.push({ category: '库存滞留', name: item.label || item.key, value: item[key] })
  for (const item of data.serial_ranking[key])
    rows.push({ category: '流水号库存', name: item.label || item.key, value: item[key] })
  for (const item of data.material_ranking[key])
    rows.push({ category: '材质库存', name: item.label || item.key, value: item[key] })
  for (const team of data.teams)
    rows.push({
      category: '待交接',
      name: team.name,
      value: team.pending_incoming?.[key] ?? null,
    })
  for (const item of data.waiting_age)
    for (const [flow, label] of [
      ['internal', '内部待交接'],
      ['external', '对外待确认'],
    ] as const)
      rows.push({ category: label, name: item.label || item.key, value: item[flow][key] })
  return tableExportSource(
    `全厂数据分析 · 库存与交接 · 近${data.days}天`,
    rows.length,
    [
      { key: 'category', label: '统计项目', value: (row: (typeof rows)[number]) => row.category },
      { key: 'name', label: '名称', value: (row) => row.name },
      { key: 'date', label: '日期', value: (row) => row.date },
      { key: 'value', label: key === 'weight' ? '重量 (kg)' : '件数', value: (row) => row.value },
    ],
    async () => rows,
  )
}
function preference(values: Record<string, string>) {
  void router.replace({ path: route.path, query: { ...route.query, ...values } })
}
function applyCustomDays() {
  if (!validCustomDays.value) return
  preference({ days: String(customDays.value) })
  periodSelect.value?.blur()
}
async function load() {
  const current = ++version
  loading.value = true
  try {
    const result = await factoryOverviewApi.get(days.value)
    if (current === version) {
      report.value = result
      error.value = ''
    }
  } catch {
    if (current === version)
      error.value = report.value
        ? '更新失败，当前显示上次成功读取的数据。'
        : '全厂数据加载失败，请重试。'
  } finally {
    if (current === version) loading.value = false
  }
}
function openTeam(team: FactoryTeam) {
  if (team.id && team.active) void router.push(`/team-workspaces/${team.id}?tab=stock`)
}
function openBatch(row: FactoryRecentBatch) {
  void router.push(`/transfer-batches?batch_no=${encodeURIComponent(row.batch_no)}`)
}
watch(
  days,
  () => {
    report.value = null
    error.value = ''
    void load()
  },
  { immediate: true },
)
watch(view, async (value) => {
  anchoredSection = value
  await nextTick()
  scrollToSection(value)
})
watch(days, (value) => {
  customDays.value = value
})
onMounted(async () => {
  document.addEventListener('visibilitychange', syncVisibility)
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  syncMotion()
  media?.addEventListener('change', syncMotion)
  timer = setInterval(() => {
    if (autoRefresh.value && !document.hidden && !loading.value) void load()
  }, 60000)
  await nextTick()
  scrollToSection(view.value, false)
  if (typeof ResizeObserver !== 'undefined') {
    sectionObserver = new ResizeObserver(() => {
      // Earlier sections grow as their reports arrive; retain the requested destination
      // until the user starts browsing or interacting with the page.
      if (anchoredSection) scrollToSection(anchoredSection, false)
    })
    page.value?.querySelectorAll('.factory-section').forEach((el) => sectionObserver!.observe(el))
    if (heading.value) sectionObserver.observe(heading.value)
  }
})
onBeforeUnmount(() => {
  ++version
  sectionObserver?.disconnect()
  if (timer) clearInterval(timer)
  media?.removeEventListener('change', syncMotion)
  document.removeEventListener('visibilitychange', syncVisibility)
})
</script>
<template>
  <section
    ref="page"
    class="page factory-overview"
    @scroll.passive="syncSection"
    @wheel.passive="releaseAnchor"
    @touchstart.passive="releaseAnchor"
    @pointerdown="releaseAnchor"
    @keydown="releaseAnchor"
  >
    <header ref="heading" class="factory-heading">
      <div class="factory-heading-start page-heading-start">
        <PageBackButton />
        <div class="factory-heading-title">
          <h1>全厂数据分析</h1>
        </div>
      </div>
      <nav class="factory-section-nav" aria-label="分析分区定位">
        <ElButton
          v-for="section in sections"
          :key="section.key"
          text
          :aria-controls="`factory-${section.key}`"
          :aria-current="activeSection === section.key ? 'location' : undefined"
          @click="navigateSection(section.key)"
          >{{ section.label }}</ElButton
        >
      </nav>
    </header>
    <section id="factory-overview" class="factory-section" aria-labelledby="factory-overview-title">
      <h2 id="factory-overview-title"><span>01</span>运行概览</h2>
      <FactoryOperationsOverview
        :days="days"
        :metric="metric"
        :motion="motion"
        @preference="preference"
      />
    </section>
    <section
      id="factory-production"
      class="factory-section"
      aria-labelledby="factory-production-title"
    >
      <h2 id="factory-production-title"><span>02</span>生产完成</h2>
      <FactoryPerformancePanel scene="production" :motion="motion" />
    </section>
    <section id="factory-quality" class="factory-section" aria-labelledby="factory-quality-title">
      <h2 id="factory-quality-title"><span>03</span>检验与质量</h2>
      <FactoryPerformancePanel scene="quality" :motion="motion" />
    </section>
    <section
      id="factory-inventory"
      class="factory-section"
      aria-labelledby="factory-inventory-title"
    >
      <h2 id="factory-inventory-title"><span>04</span>库存与交接</h2>
      <DashboardToolbar class="factory-controls" :loading="loading" :updated-at="report?.as_of">
        <WatermelonSegmented
          label="全厂统计单位"
          :model-value="metric"
          :options="[
            { value: 'weight', label: '重量' },
            { value: 'quantity', label: '件数' },
          ]"
          @update:model-value="preference({ metric: $event })"
        />
        <ElSelect
          ref="periodSelect"
          :model-value="days"
          :teleported="false"
          :fit-input-width="false"
          size="small"
          aria-label="全厂统计周期"
          @update:model-value="preference({ days: String($event) })"
          @visible-change="customDays = days"
        >
          <ElOption
            v-for="value in periodOptions"
            :key="value"
            :value="value"
            :label="`近${value}天`"
          />
          <template #footer
            ><form class="factory-custom-period" @submit.prevent="applyCustomDays">
              <label for="factory-custom-days">自定义天数</label>
              <div>
                <ElInputNumber
                  id="factory-custom-days"
                  v-model="customDays"
                  :min="1"
                  :max="365"
                  :precision="0"
                  :controls="false"
                  size="small"
                  placeholder="1–365"
                  aria-label="自定义统计天数"
                /><span>天</span
                ><ElButton
                  native-type="submit"
                  type="primary"
                  size="small"
                  :disabled="!validCustomDays"
                  >确定</ElButton
                >
              </div>
            </form></template
          >
        </ElSelect>
        <template #actions>
          <TableExportButton
            :source="exportSource"
            :disabled="loading || !report || !!error"
            :context="[days, metric].join('|')"
          />
          <ElSwitch
            v-model="autoRefresh"
            size="small"
            aria-label="每60秒自动刷新"
            active-text="自动刷新"
          />
          <ElButton :icon="Refresh" :loading="loading" size="small" @click="load">刷新</ElButton>
        </template>
      </DashboardToolbar>

      <ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon />
      <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
      <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
      <StatePanel v-else-if="!report" state="loading" title="正在读取全厂物料" />
      <template v-else>
        <section class="factory-metrics" aria-label="全厂关键数据">
          <DashboardMetric
            v-for="item in metrics"
            :key="item.key"
            class="factory-metric"
            :label="item.label"
            :value="item.value"
            :trend="item.trend"
            :trend-color="item.trendColor"
            :unit="unit"
            :detail="item.detail"
            :help="item.hint"
            :precision="metric === 'quantity' ? 0 : 3"
            :motion="motion"
            static
          />
        </section>
        <section class="factory-presentation">
          <div class="factory-stage" aria-label="库存与交接分析">
            <FactoryOverviewCharts
              :data="report"
              :metric="metric"
              scene="all"
              :motion="motion"
              @team="openTeam"
            />
          </div>
          <FactoryRecentBatches
            :rows="report.recent_batches || []"
            :motion="motion"
            @open="openBatch"
            ><template #actions
              ><ElButton link type="primary" @click="router.push('/transfer-batches')"
                >查看全部</ElButton
              ></template
            ></FactoryRecentBatches
          >
        </section>
      </template>
    </section>
  </section>
</template>
<style scoped>
.factory-overview {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 20px 24px;
  color: var(--wm-text);
  background: transparent;
  overflow-y: auto;
}
.factory-heading {
  position: sticky;
  top: -16px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  flex-wrap: wrap;
  margin: -16px -16px -8px;
  padding: 12px 16px;
  background: var(--wm-canvas);
  border-bottom: 1px solid var(--wm-border);
}
.factory-heading h1 {
  margin: 0;
  font-size: 20px;
  line-height: 32px;
  font-weight: 650;
}
.factory-heading-start {
  margin-right: auto;
}
.factory-section-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
}
.factory-section-nav .el-button {
  margin: 0;
  color: var(--wm-muted);
}
.factory-section-nav .el-button[aria-current='location'] {
  color: var(--wm-text);
  background: var(--wm-bg);
  box-shadow: inset 0 0 0 1px var(--wm-border);
}
.factory-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex-shrink: 0;
  min-width: 0;
}
.factory-section + .factory-section {
  padding-top: 28px;
  border-top: 1px solid var(--wm-border);
}
.factory-section > h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.factory-section > h2 > span {
  color: var(--wm-muted);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.factory-controls :deep(.dashboard-toolbar__filters > .el-select) {
  width: 130px;
}
.factory-custom-period {
  display: grid;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}
.factory-custom-period > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.factory-custom-period .el-input-number {
  width: 96px;
}
.factory-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.factory-presentation {
  display: grid;
  gap: 16px;
}
.factory-stage {
  min-width: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .factory-overview > :not(.factory-heading) {
    animation: dashboard-enter 180ms ease-out;
  }
  @keyframes dashboard-enter {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
@media (max-width: 900px) {
  .factory-overview {
    padding: 14px;
  }
  .factory-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .factory-section-nav {
    width: 100%;
  }
}
</style>

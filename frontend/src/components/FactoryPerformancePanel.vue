<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import {
  ElAlert,
  ElButton,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
} from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import AnimatedMetric from './AnimatedMetric.vue'
import FactoryPerformanceCharts from './FactoryPerformanceCharts.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import TableExportButton from './TableExportButton.vue'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { factoryToday, formatAmount, formatDateTime } from '@/utils/format'
import { tableExportSource, type TableExportField } from '@/utils/tableExport'
import type {
  FactoryPerformance,
  ProductionMetrics,
  QualityBasis,
  QualityMetrics,
} from '@/types/factoryPerformance'
import type { Metric } from '@/types/materialAnalytics'
import type { CalendarRange } from '@/types/recordFilters'

const props = defineProps<{ scene: 'production' | 'quality'; motion: boolean }>()
const router = useRouter()
function recentDates(): CalendarRange {
  const today = factoryToday()
  return { from: dayjs(today).subtract(29, 'day').format('YYYY-MM-DD'), to: today }
}
const dates = ref(recentDates()),
  teamId = ref<number>(),
  metric = ref<Metric>('quantity'),
  autoRefresh = ref(true),
  basis = ref<QualityBasis>({ kind: 'patrol', scope: 'sample', phase: 'first' }),
  report = ref<FactoryPerformance | null>(null),
  teams = ref<FactoryPerformance['teams']>([]),
  loading = ref(false),
  error = ref(''),
  dateError = ref('')
let generation = 0,
  timer: ReturnType<typeof setInterval> | undefined
const unit = computed(() => (metric.value === 'quantity' ? '件次' : 'kg'))
const basisLabel = computed(
  () =>
    `${basis.value.kind === 'patrol' ? '巡检' : '检验'} · ${basis.value.scope === 'sample' ? '抽检' : '全检'} · ${basis.value.phase === 'first' ? '首次检查' : '复检'}`,
)
const qualityRows = computed(() =>
  (report.value?.quality.groups || []).filter(
    (row) =>
      row.kind === basis.value.kind &&
      row.scope === basis.value.scope &&
      row.phase === basis.value.phase,
  ),
)
const qualityTrend = computed(() =>
  (report.value?.quality.trend || []).filter(
    (row) =>
      row.kind === basis.value.kind &&
      row.scope === basis.value.scope &&
      row.phase === basis.value.phase,
  ),
)
const qualityTotal = computed<QualityMetrics>(() => {
  const total = { record_count: 0, checked_quantity: 0, passed_quantity: 0, failed_quantity: 0 }
  for (const row of qualityRows.value)
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += row[key]
  return {
    ...total,
    pass_rate: total.checked_quantity
      ? (100 * total.passed_quantity) / total.checked_quantity
      : null,
  }
})
const cards = computed(() => {
  if (!report.value) return []
  if (props.scene === 'production') {
    const total = report.value.production.totals,
      precision = metric.value === 'quantity' ? 0 : 3
    return [
      {
        label: '正常加工完成',
        value: total[`completed_${metric.value}`],
        unit: unit.value,
        precision,
      },
      { label: '返工完成', value: total[`rework_${metric.value}`], unit: unit.value, precision },
      { label: '加工登记', value: total.record_count, unit: '笔', precision: 0 },
      { label: '加工废料重量', value: total.scrap_weight, unit: 'kg', precision: 3 },
    ]
  }
  const total = qualityTotal.value
  return [
    { label: '受检合格率', value: total.pass_rate, unit: '%', precision: 2 },
    { label: '实际受检', value: total.checked_quantity, unit: '件次', precision: 0 },
    { label: '检出不合格', value: total.failed_quantity, unit: '件次', precision: 0 },
    { label: '检查记录', value: total.record_count, unit: '笔', precision: 0 },
  ]
})
const qualityWorkspace = computed(() =>
  teams.value.find((team) => team.active && team.code === 'FACTORY-QC'),
)
const selectedTeam = computed(() => teams.value.find((team) => team.id === teamId.value))
const exportContext = computed(() =>
  [
    props.scene,
    dates.value.from,
    dates.value.to,
    teamId.value,
    JSON.stringify(basis.value),
    report.value?.generated_at,
    error.value,
  ].join('|'),
)
function applyDates(value: CalendarRange) {
  const next = value.from || value.to ? value : recentDates()
  const days = dayjs(next.to).diff(dayjs(next.from), 'day')
  if (!next.from || !next.to || !Number.isFinite(days) || days < 0 || days >= 366) {
    dateError.value = '请选择完整日期范围，最多 366 天。'
    return
  }
  dateError.value = ''
  dates.value = next
}
async function load() {
  const token = ++generation
  loading.value = true
  try {
    const result = await factoryPerformanceApi.get({
      date_from: dates.value.from,
      date_to: dates.value.to,
      team_id: teamId.value,
    })
    if (token !== generation) return
    report.value = result
    teams.value = result.teams
    error.value = ''
  } catch {
    if (token === generation)
      error.value = report.value
        ? '更新失败，当前显示上次成功读取的数据。'
        : '生产与质量数据读取失败，请重试。'
  } finally {
    if (token === generation) loading.value = false
  }
}
function openProcessing(id: number) {
  if (!teams.value.some((team) => team.id === id && team.active)) return
  void router.push({
    path: `/team-workspaces/${id}`,
    query: { tab: 'processing', date_from: dates.value.from, date_to: dates.value.to },
  })
}
function openQuality(tab: 'quality-feedback' | 'inspections' | 'inspection-results') {
  const target =
    tab === 'quality-feedback'
      ? selectedTeam.value || qualityWorkspace.value
      : qualityWorkspace.value
  if (target?.active) void router.push({ path: `/team-workspaces/${target.id}`, query: { tab } })
}
function productionExport(daily = false) {
  const data = report.value
  if (!data) return null
  const rows: (ProductionMetrics & { name: string })[] = daily
    ? data.production.trend.map((row) => ({ ...row, name: row.date }))
    : data.production.teams.map((row) => ({ ...row, name: row.team_name }))
  return tableExportSource(
    daily ? '每日加工汇总' : '班组加工汇总',
    rows.length,
    [
      { key: 'name', label: daily ? '加工日期' : '班组', value: (row) => row.name },
      { key: 'date_from', label: '开始日期', value: () => data.date_from },
      { key: 'date_to', label: '结束日期', value: () => data.date_to },
      ...(
        [
          ['completed_quantity', '正常加工完成 (件次)'],
          ['completed_weight', '正常加工重量 (kg)'],
          ['rework_quantity', '返工完成 (件次)'],
          ['rework_weight', '返工重量 (kg)'],
          ['work_quantity', '完成工作量 (件次)'],
          ['scrap_weight', '加工废料重量 (kg)'],
          ['record_count', '加工登记笔数'],
        ] as const
      ).map(([key, label]) => ({ key, label, value: (row: ProductionMetrics) => row[key] })),
    ],
    async () => rows,
  )
}
function qualityExport(daily = false) {
  const data = report.value
  if (!data) return null
  const rows: (QualityMetrics & { name: string })[] = daily
    ? qualityTrend.value.map((row) => ({ ...row, name: row.date }))
    : qualityRows.value.map((row) => ({ ...row, name: row.team_name }))
  const label = basisLabel.value
  const fields: TableExportField<(typeof rows)[number]>[] = [
    { key: 'name', label: daily ? '检查日期' : '受检班组', value: (row) => row.name },
    { key: 'basis', label: '统计口径', value: () => label },
    { key: 'date_from', label: '开始日期', value: () => data.date_from },
    { key: 'date_to', label: '结束日期', value: () => data.date_to },
    { key: 'checked_quantity', label: '受检件次', value: (row) => row.checked_quantity },
    { key: 'passed_quantity', label: '合格件次', value: (row) => row.passed_quantity },
    { key: 'failed_quantity', label: '不合格件次', value: (row) => row.failed_quantity },
    { key: 'pass_rate', label: '合格率 (%)', value: (row) => row.pass_rate },
    { key: 'record_count', label: '检查笔数', value: (row) => row.record_count },
  ]
  return tableExportSource(
    daily ? '每日检验汇总' : '班组检验汇总',
    rows.length,
    fields,
    async () => rows,
  )
}
function issuesExport() {
  const data = report.value
  if (!data) return null
  const rows = [
    {
      category: '去重合计',
      name: '全部问题',
      total: data.issues.summary.total,
      unresolved: data.issues.summary.unresolved,
    },
    ...data.issues.problems.map((row) => ({
      category: '问题分类（可多选）',
      name: row.name,
      total: row.issue_count,
      unresolved: row.unresolved_count,
    })),
    ...data.issues.teams.map((row) => ({
      category: '涉及班组（可多选）',
      name: row.team_name,
      total: row.issue_count,
      unresolved: row.unresolved_count,
    })),
  ]
  return tableExportSource(
    '质量问题汇总',
    rows.length,
    [
      { key: 'category', label: '统计维度', value: (row) => row.category },
      { key: 'name', label: '名称', value: (row) => row.name },
      { key: 'date_from', label: '问题发现开始日期', value: () => data.date_from },
      { key: 'date_to', label: '问题发现结束日期', value: () => data.date_to },
      { key: 'total', label: '问题数', value: (row) => row.total },
      { key: 'unresolved', label: '未结束问题数', value: (row) => row.unresolved },
    ],
    async () => rows,
  )
}
function exportSource() {
  return props.scene === 'production' ? productionExport() : qualityExport()
}
function exportVariants() {
  const sources =
    props.scene === 'production' ? [productionExport(true)] : [qualityExport(true), issuesExport()]
  return sources.filter((source) => source !== null)
}
watch(
  () => [dates.value.from, dates.value.to, teamId.value],
  () => {
    report.value = null
    error.value = ''
    void load()
  },
  { immediate: true },
)
onMounted(() => {
  timer = setInterval(() => {
    if (autoRefresh.value && !document.hidden && !loading.value) void load()
  }, 60000)
})
onBeforeUnmount(() => {
  ++generation
  if (timer) clearInterval(timer)
})
</script>
<template>
  <section
    class="factory-performance"
    :aria-label="scene === 'production' ? '生产完成统计' : '检验与质量统计'"
  >
    <div class="performance-toolbar">
      <RecordDateFilter :model-value="dates" label="统计日期" @update:model-value="applyDates" />
      <ElSelect v-model="teamId" clearable filterable placeholder="全部班组" aria-label="统计班组">
        <ElOption
          v-for="team in teams"
          :key="team.id"
          :value="team.id"
          :label="team.name + (team.active ? '' : '（停用）')"
        />
      </ElSelect>
      <ElRadioGroup
        v-if="scene === 'production'"
        v-model="metric"
        size="small"
        aria-label="加工统计单位"
      >
        <ElRadioButton value="quantity">件次</ElRadioButton
        ><ElRadioButton value="weight">重量</ElRadioButton>
      </ElRadioGroup>
      <div class="performance-toolbar-actions">
        <TableExportButton
          :source="exportSource"
          :variants="exportVariants"
          :context="exportContext"
          :disabled="loading || !report || !!error"
        />
        <ElSwitch
          v-model="autoRefresh"
          size="small"
          active-text="自动刷新"
          aria-label="每60秒刷新生产与质量数据"
        />
        <ElButton :icon="Refresh" :loading="loading" @click="load">刷新</ElButton>
      </div>
    </div>
    <ElAlert v-if="dateError" :title="dateError" type="warning" :closable="false" />
    <div v-if="scene === 'quality'" class="quality-basis" aria-label="合格率统计口径">
      <ElRadioGroup v-model="basis.kind" size="small" aria-label="检查来源">
        <ElRadioButton value="patrol">巡检</ElRadioButton
        ><ElRadioButton value="inspection">检验</ElRadioButton>
      </ElRadioGroup>
      <ElRadioGroup v-model="basis.scope" size="small" aria-label="检查范围">
        <ElRadioButton value="sample">抽检</ElRadioButton
        ><ElRadioButton value="full">全检</ElRadioButton>
      </ElRadioGroup>
      <ElRadioGroup v-model="basis.phase" size="small" aria-label="检查阶段">
        <ElRadioButton value="first">首次检查</ElRadioButton
        ><ElRadioButton value="recheck">复检</ElRadioButton>
      </ElRadioGroup>
      <ElButton
        v-if="qualityWorkspace"
        link
        type="primary"
        @click="openQuality(basis.kind === 'patrol' ? 'inspections' : 'inspection-results')"
        >进入{{ basis.kind === 'patrol' ? '巡检' : '检验' }}记录</ElButton
      >
    </div>
    <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!report" state="loading" title="正在读取生产与质量数据" />
    <template v-else>
      <ElAlert v-if="error" :title="error" type="warning" :closable="false" />
      <div class="performance-scope">
        <span
          >{{ scene === 'quality' ? basisLabel : '按加工完成日期统计' }} ·
          {{ selectedTeam?.name || '全部班组' }}</span
        >
        <span>{{ formatDateTime(report.generated_at) }} 更新</span>
      </div>
      <section class="performance-metrics">
        <article v-for="card in cards" :key="card.label" class="performance-metric chart-glass">
          <h2>{{ card.label }}</h2>
          <div>
            <strong v-if="card.value === null">—</strong>
            <strong v-else
              ><AnimatedMetric :value="card.value" :precision="card.precision" :animate="motion"
            /></strong>
            <span>{{ card.value === null ? '未检查' : card.unit }}</span>
          </div>
        </article>
      </section>
      <p class="performance-note">
        {{
          scene === 'production'
            ? '同一工件完成不同任务，件次和加工重量分别累计；返工单列，未加工余料不计产，出库不重复计产。跨班组工作量不能作为全厂成品产量。'
            : '合格率 = 合格件次 ÷ 实际受检件次。抽检、全检、首次检查和复检分开统计；没有检查记录不计为合格，检出问题涉及的班组不据此推算合格率。'
        }}
      </p>
      <div v-if="scene === 'quality'" class="quality-issues-summary">
        <div>
          <strong>质量问题 {{ formatAmount(report.issues.summary.total) }} 条</strong>
          <span>待处理 {{ report.issues.summary.pending }}</span>
          <span>处理中 {{ report.issues.summary.processing }}</span>
          <span>已结束 {{ report.issues.summary.closed }}</span>
        </div>
        <ElButton
          v-if="selectedTeam?.active || qualityWorkspace"
          link
          type="primary"
          @click="openQuality('quality-feedback')"
          >进入质量反馈</ElButton
        >
        <p>
          问题按发现日期、涉及班组及查看权限统计，包含巡检与检验；复检沿用原问题。一个问题可选择多个分类，分类或班组数量不能相加。
        </p>
      </div>
      <FactoryPerformanceCharts
        :data="report"
        :scene="scene"
        :metric="metric"
        :basis="basis"
        :motion="motion && !error"
        @team="openProcessing"
      />
      <div class="performance-table-wrap">
        <table class="performance-table business-table">
          <caption>
            {{
              scene === 'production' ? '各班组加工明细' : `受检明细 · ${basisLabel}`
            }}
          </caption>
          <thead v-if="scene === 'production'">
            <tr>
              <th scope="col">班组</th>
              <th scope="col">正常加工 (件次)</th>
              <th scope="col">正常加工重量 (kg)</th>
              <th scope="col">返工 (件次)</th>
              <th scope="col">返工重量 (kg)</th>
              <th scope="col">加工登记</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <thead v-else>
            <tr>
              <th scope="col">受检班组</th>
              <th scope="col">受检 (件次)</th>
              <th scope="col">合格 (件次)</th>
              <th scope="col">不合格 (件次)</th>
              <th scope="col">合格率</th>
              <th scope="col">检查记录</th>
            </tr>
          </thead>
          <tbody v-if="scene === 'production'">
            <tr v-for="row in report.production.teams" :key="row.team_id">
              <th scope="row">{{ row.team_name }}</th>
              <td>{{ formatAmount(row.completed_quantity) }}</td>
              <td>{{ formatAmount(row.completed_weight) }}</td>
              <td>{{ formatAmount(row.rework_quantity) }}</td>
              <td>{{ formatAmount(row.rework_weight) }}</td>
              <td>{{ formatAmount(row.record_count) }} 笔</td>
              <td>
                <ElButton
                  link
                  type="primary"
                  :disabled="!teams.some((team) => team.id === row.team_id && team.active)"
                  @click="openProcessing(row.team_id)"
                  >加工记录</ElButton
                >
              </td>
            </tr>
            <tr v-if="!report.production.teams.length">
              <td colspan="7">当前范围没有加工记录</td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="row in qualityRows" :key="row.team_id">
              <th scope="row">{{ row.team_name }}</th>
              <td>{{ formatAmount(row.checked_quantity) }}</td>
              <td>{{ formatAmount(row.passed_quantity) }}</td>
              <td>{{ formatAmount(row.failed_quantity) }}</td>
              <td>{{ row.pass_rate == null ? '—' : `${row.pass_rate.toFixed(2)}%` }}</td>
              <td>{{ row.record_count }} 笔</td>
            </tr>
            <tr v-if="!qualityRows.length">
              <td colspan="6">当前口径没有检查记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
<style scoped>
.factory-performance {
  display: grid;
  gap: 14px;
  flex-shrink: 0;
}
.performance-toolbar,
.performance-toolbar-actions,
.quality-basis {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.performance-toolbar > .el-select {
  width: 160px;
}
.performance-toolbar-actions {
  margin-left: auto;
}
.quality-basis {
  padding-bottom: 4px;
}
.quality-basis > .el-button {
  margin-left: auto;
}
.performance-scope {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
.performance-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.performance-metric {
  padding: 16px 20px;
  border-radius: var(--card-radius);
}
.performance-metric h2 {
  color: var(--muted);
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 500;
}
.performance-metric > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.performance-metric strong {
  font-size: clamp(26px, 2vw, 34px);
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}
.performance-metric:first-child strong {
  color: var(--primary);
}
.performance-metric span,
.performance-note,
.quality-issues-summary p {
  font-size: 12px;
  color: var(--muted);
}
.performance-note {
  margin: -4px 0 0;
  line-height: 20px;
}
.quality-issues-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 6px;
}
.quality-issues-summary > div {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 18px;
}
.quality-issues-summary strong {
  font-size: 15px;
  font-weight: 550;
}
.quality-issues-summary span {
  color: var(--muted);
  font-size: 13px;
}
.quality-issues-summary > .el-button {
  margin-left: auto;
}
.quality-issues-summary p {
  margin: 0;
  flex-basis: 100%;
  line-height: 20px;
}
.performance-table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--card-radius);
  background: var(--surface);
}
.performance-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  white-space: nowrap;
  font-size: 13px;
}
.performance-table caption {
  text-align: left;
  padding: 16px 18px;
  font-size: 15px;
  font-weight: 550;
}
.performance-table th,
.performance-table td {
  text-align: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.performance-table thead th {
  color: var(--muted);
  background: var(--table-header-bg);
  font-weight: 500;
}
.performance-table tbody th {
  font-weight: 500;
}
.performance-table tbody tr:last-child > * {
  border-bottom: none;
}
@media (max-width: 1100px) {
  .performance-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .performance-toolbar-actions {
    margin-left: 0;
  }
}
@media (min-width: 1101px) and (max-height: 800px) {
  .factory-performance {
    gap: 10px;
  }
  .performance-metric {
    padding: 12px 16px;
  }
}
</style>

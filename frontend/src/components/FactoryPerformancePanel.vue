<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { ElOption } from 'element-plus'
import ElAlert from './AppAlert.vue'
import ElButton from './AppButton.vue'
import ElSelect from './AppSelect.vue'
import ElSwitch from './AppSwitch.vue'
import DashboardToolbar from './DashboardToolbar.vue'
import DashboardMetric from './DashboardMetric.vue'
import DashboardCard from './DashboardCard.vue'
import AppDetailTable from './AppDetailTable.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { Refresh } from '@element-plus/icons-vue'
import StatisticHelp from './StatisticHelp.vue'
import FactoryPerformanceCharts from './FactoryPerformanceCharts.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import MaterialInput from './MaterialInput.vue'
import StatePanel from './StatePanel.vue'
import TableExportButton from './TableExportButton.vue'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { factoryToday, formatAmount } from '@/utils/format'
import { tableExportSource, type TableExportField } from '@/utils/tableExport'
import type {
  FactoryPerformance,
  ProductionMetrics,
  QualityBasis,
  QualityMetrics,
  PerformancePeriod,
} from '@/types/factoryPerformance'
import type { Metric } from '@/types/materialAnalytics'
import type { CalendarRange } from '@/types/recordFilters'

const props = defineProps<{ scene: 'production' | 'quality'; motion: boolean }>()
const router = useRouter()
const route = useRoute()
const productionView = computed({
  get: () => (route.query.production_view === 'task' ? 'task' : 'all'),
  set: (value: string) => {
    void router.replace({
      query: { ...route.query, production_view: value === 'task' ? 'task' : undefined },
    })
  },
})
const aggregate = computed(() => props.scene === 'production' && productionView.value === 'all')
function recentDates(): CalendarRange {
  const today = factoryToday()
  return { from: dayjs(today).subtract(29, 'day').format('YYYY-MM-DD'), to: today }
}
const dates = ref(recentDates()),
  teamId = ref<number>(),
  metric = ref<Metric>('quantity'),
  period = ref<PerformancePeriod>('day'),
  serialDraft = ref(''),
  serialFilter = ref(''),
  materialDraft = ref(''),
  materialFilter = ref(''),
  workId = ref<number>(),
  autoRefresh = ref(true),
  exporting = ref(false),
  basis = ref<QualityBasis>({ kind: 'patrol', scope: 'sample', phase: 'first' }),
  report = ref<FactoryPerformance | null>(null),
  teams = ref<FactoryPerformance['teams']>([]),
  loading = ref(false),
  error = ref(''),
  dateError = ref('')
let generation = 0,
  timer: ReturnType<typeof setInterval> | undefined
const unit = computed(() => (metric.value === 'quantity' ? '件次' : 'kg'))
const periodLabel = computed(() => ({ day: '每日', week: '每周', month: '每月' })[period.value])
const productionScope = computed(() => report.value?.production.scope)
const basisLabel = computed(
  () =>
    `${basis.value.kind === 'patrol' ? '巡检' : '检验'} · ${basis.value.scope === 'sample' ? '抽检' : '全检'} · ${basis.value.phase === 'first' ? '首次检查' : '复检'}`,
)
const qualityRows = computed(() => (report.value?.quality.groups || []).filter(matchesBasis))
const qualityTrend = computed(() => (report.value?.quality.trend || []).filter(matchesBasis))
const qualityMaterials = computed(() =>
  (report.value?.quality.materials || []).filter(matchesBasis),
)
function matchesBasis(row: QualityBasis) {
  return (
    row.kind === basis.value.kind &&
    row.scope === basis.value.scope &&
    row.phase === basis.value.phase
  )
}
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
    const total = aggregate.value ? report.value.activity?.totals : report.value.production.totals
    if (!total || (!aggregate.value && !productionScope.value)) return []
    const precision = metric.value === 'quantity' ? 0 : 3
    return [
      {
        label: '正常加工完成',
        value: total[`completed_${metric.value}`],
        unit: unit.value,
        precision,
      },
      { label: '返工完成', value: total[`rework_${metric.value}`], unit: unit.value, precision },
      { label: '正常加工登记', value: total.initial_record_count, unit: '笔', precision: 0 },
      { label: '返工登记', value: total.rework_record_count, unit: '笔', precision: 0 },
    ]
  }
  const total = qualityTotal.value
  return [
    qualityMaterials.value.length <= 1
      ? {
          label: qualityMaterials.value[0]
            ? `${qualityMaterials.value[0].material_name || '未填写材质'} · 合格率`
            : '材质合格率',
          value: qualityMaterials.value[0]?.pass_rate ?? null,
          unit: '%',
          precision: 2,
        }
      : { label: '受检材质', value: qualityMaterials.value.length, unit: '种', precision: 0 },
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
    productionView.value,
    dates.value.from,
    dates.value.to,
    teamId.value,
    serialFilter.value,
    materialFilter.value,
    workId.value,
    period.value,
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
      include_activity: props.scene === 'production',
      date_from: dates.value.from,
      date_to: dates.value.to,
      team_id: teamId.value,
      period: period.value,
      serial_no: props.scene === 'production' ? serialFilter.value || undefined : undefined,
      work_id: props.scene === 'production' && !aggregate.value ? workId.value : undefined,
      material_name: props.scene === 'quality' ? materialFilter.value || undefined : undefined,
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
function applyQuery() {
  workId.value = undefined
  const next = props.scene === 'production' ? serialDraft.value.trim() : materialDraft.value.trim()
  const target = props.scene === 'production' ? serialFilter : materialFilter
  if (target.value === next) void load()
  else target.value = next
}
function selectWork(value: number) {
  const scope = report.value?.production.scopes.find((row) => row.scope_id === value)
  if (!scope) return
  serialDraft.value = scope.serial_no
  serialFilter.value = scope.serial_no
  workId.value = value
}
function openProcessing(id: number) {
  if (!teams.value.some((team) => team.id === id && team.active)) return
  void router.push({
    path: `/team-workspaces/${id}`,
    query: {
      tab: 'processing',
      date_from: dates.value.from,
      date_to: dates.value.to,
      query: aggregate.value ? serialFilter.value || undefined : productionScope.value?.serial_no,
    },
  })
}
function openQuality(tab: 'quality-feedback' | 'inspections' | 'inspection-results') {
  const target =
    tab === 'quality-feedback'
      ? selectedTeam.value || qualityWorkspace.value
      : qualityWorkspace.value
  if (target?.active) void router.push({ path: `/team-workspaces/${target.id}`, query: { tab } })
}
function productionExport(periods = false) {
  const data = report.value,
    scope = productionScope.value
  if (!data || !scope) return null
  const rows = periods
    ? data.production.trend.map((row) => ({ ...scope, ...row, period_start: row.date }))
    : data.production.scopes.map((row) => ({ ...row, period_start: '' }))
  return tableExportSource(
    periods ? `${periodLabel.value}流水号加工明细` : '流水号任务加工明细',
    rows.length,
    [
      { key: 'team_name', label: '班组', value: (row) => row.team_name },
      { key: 'serial_no', label: '流水号', value: (row) => row.serial_no },
      { key: 'material_name', label: '材质', value: (row) => row.material_name },
      { key: 'purpose_name', label: '业务', value: (row) => row.purpose_name },
      { key: 'processing_task_name', label: '加工任务', value: (row) => row.processing_task_name },
      { key: 'process_step_name', label: '工艺工序', value: (row) => row.process_step_name || '—' },
      { key: 'period_start', label: '周期开始日期', value: (row) => row.period_start },
      { key: 'period', label: '统计周期', value: () => periodLabel.value },
      { key: 'date_from', label: '统计开始日期', value: () => data.date_from },
      { key: 'date_to', label: '统计结束日期', value: () => data.date_to },
      ...(
        [
          ['completed_quantity', '正常加工完成 (件次)'],
          ['completed_weight', '正常加工重量 (kg)'],
          ['rework_quantity', '返工完成 (件次)'],
          ['rework_weight', '返工重量 (kg)'],
          ['initial_record_count', '正常加工登记'],
          ['rework_record_count', '返工登记'],
        ] as const
      ).map(([key, label]) => ({ key, label, value: (row: ProductionMetrics) => row[key] })),
    ],
    async () => rows,
  )
}
function qualityExport(daily = false) {
  const data = report.value
  if (!data) return null
  const rows = daily
    ? qualityTrend.value.map((row) => ({ ...row, name: row.date }))
    : qualityRows.value.map((row) => ({ ...row, name: row.team_name }))
  const label = basisLabel.value
  const fields: TableExportField<(typeof rows)[number]>[] = [
    { key: 'name', label: daily ? '周期开始日期' : '受检班组', value: (row) => row.name },
    { key: 'material_name', label: '材质', value: (row) => row.material_name || '未填写材质' },
    { key: 'period', label: '统计周期', value: () => periodLabel.value },
    { key: 'basis', label: '统计方式', value: () => label },
    { key: 'date_from', label: '开始日期', value: () => data.date_from },
    { key: 'date_to', label: '结束日期', value: () => data.date_to },
    { key: 'checked_quantity', label: '受检件次', value: (row) => row.checked_quantity },
    { key: 'passed_quantity', label: '合格件次', value: (row) => row.passed_quantity },
    { key: 'failed_quantity', label: '不合格件次', value: (row) => row.failed_quantity },
    { key: 'pass_rate', label: '合格率 (%)', value: (row) => row.pass_rate },
    { key: 'record_count', label: '检查笔数', value: (row) => row.record_count },
  ]
  return tableExportSource(
    daily ? `${periodLabel.value}材质合格率` : '班组材质检验明细',
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
      { key: 'material_name', label: '材质范围', value: () => materialFilter.value || '全部材质' },
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
function activityExport(daily = false) {
  const data = report.value?.activity
  if (!data) return null
  const rows: (ProductionMetrics & { name: string })[] = daily
    ? data.trend.map((row) => ({ ...row, name: row.date }))
    : data.teams.map((row) => ({ ...row, name: row.team_name }))
  return tableExportSource(
    daily ? '全厂加工趋势' : '班组加工完成',
    rows.length,
    [
      { key: 'name', label: daily ? '日期' : '班组', value: (row) => row.name },
      {
        key: 'completed_quantity',
        label: '正常加工 (件次)',
        value: (row) => row.completed_quantity,
      },
      { key: 'completed_weight', label: '正常加工 (kg)', value: (row) => row.completed_weight },
      { key: 'rework_quantity', label: '返工 (件次)', value: (row) => row.rework_quantity },
      { key: 'rework_weight', label: '返工 (kg)', value: (row) => row.rework_weight },
      { key: 'record_count', label: '加工登记', value: (row) => row.record_count },
    ],
    async () => rows,
  )
}
function exportSource() {
  if (aggregate.value) return activityExport()
  return props.scene === 'production' ? productionExport() : qualityExport()
}
function exportVariants() {
  if (aggregate.value) return [activityExport(true)].filter((source) => source !== null)
  const sources =
    props.scene === 'production' ? [productionExport(true)] : [qualityExport(true), issuesExport()]
  return sources.filter((source) => source !== null)
}
watch(
  () => [
    props.scene,
    productionView.value,
    dates.value.from,
    dates.value.to,
    teamId.value,
    serialFilter.value,
    materialFilter.value,
    workId.value,
    period.value,
  ],
  () => {
    report.value = null
    error.value = ''
    void load()
  },
  { immediate: true },
)
watch(
  () => [teamId.value, dates.value.from, dates.value.to],
  () => {
    workId.value = undefined
  },
  { flush: 'sync' },
)
onMounted(() => {
  timer = setInterval(() => {
    if (autoRefresh.value && !exporting.value && !document.hidden && !loading.value) void load()
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
    <DashboardToolbar
      class="performance-toolbar"
      :loading="loading"
      :updated-at="report?.generated_at"
    >
      <RecordDateFilter :model-value="dates" label="统计日期" @update:model-value="applyDates" />
      <ElSelect
        v-model="teamId"
        clearable
        filterable
        :placeholder="'全部班组'"
        aria-label="统计班组"
      >
        <ElOption
          v-for="team in teams"
          :key="team.id"
          :value="team.id"
          :label="team.name + (team.active ? '' : '（停用）')"
        />
      </ElSelect>
      <MaterialInput
        v-if="scene === 'production'"
        v-model="serialDraft"
        field="serial_no"
        label="统计流水号"
        placeholder="输入或选择流水号"
        :maxlength="80"
        @selected="applyQuery"
        @keyup.enter="applyQuery"
      />
      <MaterialInput
        v-else
        v-model="materialDraft"
        field="material_name"
        label="统计材质"
        placeholder="材质（可选）"
        @selected="applyQuery"
        @keyup.enter="applyQuery"
      />
      <ElButton class="action-warm" @click="applyQuery">查询</ElButton>
      <template #actions>
        <TableExportButton
          :source="exportSource"
          :variants="exportVariants"
          :context="exportContext"
          :disabled="
            loading ||
            !report ||
            !!error ||
            (scene === 'production' && !aggregate && !productionScope)
          "
          @visible-change="exporting = $event"
        />
        <ElSwitch
          v-model="autoRefresh"
          size="small"
          active-text="自动刷新"
          aria-label="每60秒刷新生产与质量数据"
        />
        <ElButton :icon="Refresh" :loading="loading" @click="load">刷新</ElButton>
      </template>
    </DashboardToolbar>
    <ElAlert v-if="dateError" :title="dateError" type="warning" :closable="false" />
    <div class="performance-view-options">
      <WatermelonSegmented
        v-if="scene === 'production'"
        v-model="productionView"
        label="生产统计范围"
        :options="[
          { value: 'all', label: '班组汇总' },
          { value: 'task', label: '流水号任务' },
        ]"
      />
      <div v-if="scene === 'quality'" class="quality-basis" aria-label="合格率统计方式">
        <WatermelonSegmented
          label="检查来源"
          :model-value="basis.kind"
          :options="[
            { value: 'patrol', label: '巡检' },
            { value: 'inspection', label: '检验' },
          ]"
          @update:model-value="basis.kind = $event as QualityBasis['kind']"
        />
        <WatermelonSegmented
          label="检查范围"
          :model-value="basis.scope"
          :options="[
            { value: 'sample', label: '抽检' },
            { value: 'full', label: '全检' },
          ]"
          @update:model-value="basis.scope = $event as QualityBasis['scope']"
        />
        <WatermelonSegmented
          label="检查阶段"
          :model-value="basis.phase"
          :options="[
            { value: 'first', label: '首次检查' },
            { value: 'recheck', label: '复检' },
          ]"
          @update:model-value="basis.phase = $event as QualityBasis['phase']"
        />
        <ElButton
          v-if="qualityWorkspace"
          link
          type="primary"
          @click="openQuality(basis.kind === 'patrol' ? 'inspections' : 'inspection-results')"
          >进入{{ basis.kind === 'patrol' ? '巡检' : '检验' }}记录</ElButton
        >
      </div>
      <div class="performance-view-controls">
        <WatermelonSegmented
          label="统计周期"
          :model-value="period"
          :options="[
            { value: 'day', label: '日' },
            { value: 'week', label: '周' },
            { value: 'month', label: '月' },
          ]"
          @update:model-value="period = $event as PerformancePeriod"
        />
        <WatermelonSegmented
          v-if="scene === 'production'"
          label="加工统计单位"
          :model-value="metric"
          :options="[
            { value: 'quantity', label: '件次' },
            { value: 'weight', label: '重量' },
          ]"
          @update:model-value="metric = $event as Metric"
        />
      </div>
    </div>
    <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!report" state="loading" title="正在读取生产与质量数据" />
    <template v-else>
      <ElAlert v-if="error" :title="error" type="warning" :closable="false" />
      <div class="performance-scope">
        <span
          >{{ scene === 'quality' ? basisLabel : '按实际加工日期统计' }} · {{ periodLabel }} ·
          {{
            scene === 'production'
              ? aggregate
                ? selectedTeam?.name || '全部班组'
                : productionScope?.team_name || '未选择班组'
              : selectedTeam?.name || '全部班组'
          }}</span
        >
        <StatisticHelp label="统计说明">
          {{
            scene === 'production'
              ? aggregate
                ? '按实际加工登记汇总各班组件次，同一物料经过多道工序会分别计次，不等于成品产量。'
                : '仅统计当前班组、流水号、业务、任务和工序；正常加工与返工分列，未加工余料和出库不计产。' +
                  (serialFilter ? '' : ' 默认展示最近有加工记录的流水号。')
              : '按材质统计：合格率 = 合格件次 ÷ 实际受检件次；未检不计合格。周一至周日为一周，月按自然月，周期仅计算筛选日期内的记录。'
          }}
        </StatisticHelp>
      </div>
      <div
        v-if="scene === 'production' && !aggregate && productionScope"
        class="production-context"
      >
        <div>
          <span>{{ productionScope.team_name }}</span
          ><strong>{{ productionScope.serial_no }}</strong
          ><span>{{ productionScope.material_name || '未填写材质' }}</span>
        </div>
        <ElSelect
          :model-value="productionScope.scope_id"
          aria-label="加工业务与任务"
          @update:model-value="selectWork"
        >
          <ElOption
            v-for="row in report.production.scopes"
            :key="row.scope_id"
            :value="row.scope_id"
            :label="
              [
                row.material_name,
                row.purpose_name || '未指定任务',
                row.processing_task_name || '历史未登记任务',
                row.process_step_name,
              ]
                .filter(Boolean)
                .join(' · ')
            "
          />
        </ElSelect>
        <ElButton
          v-if="teams.some((team) => team.id === productionScope?.team_id && team.active)"
          link
          type="primary"
          @click="openProcessing(productionScope.team_id)"
          >加工记录</ElButton
        >
      </div>
      <section v-if="cards.length" class="performance-metrics">
        <DashboardMetric
          class="performance-metric"
          v-for="card in cards"
          :key="card.label"
          v-bind="card"
          :unit="card.value === null ? '未检查' : card.unit"
          :motion="motion"
          static
        />
      </section>
      <div v-if="scene === 'quality'" class="quality-issues-summary">
        <div>
          <strong>质量问题 {{ formatAmount(report.issues.summary.total) }} 条</strong>
          <StatisticHelp label="质量问题统计说明">
            问题按发现日期、涉及班组及查看权限统计，包含巡检与检验；复检沿用原问题。一个问题可选择多个分类，分类或班组数量不能相加。
          </StatisticHelp>
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
      </div>
      <StatePanel
        v-if="scene === 'production' && !aggregate && !productionScope"
        state="empty"
        title="当前范围没有加工记录"
        description="请调整班组、流水号或统计日期。"
      />
      <FactoryPerformanceCharts
        v-else
        :data="report"
        :scene="scene"
        :metric="metric"
        :basis="basis"
        :aggregate="aggregate"
        :motion="motion && !error"
      />
      <DashboardCard v-if="aggregate" title="班组加工明细" :subtitle="serialFilter || '全部流水号'">
        <div class="performance-table-scroll">
          <AppDetailTable class="performance-table">
            <thead>
              <tr>
                <th>班组</th>
                <th>正常加工 (件次)</th>
                <th>正常加工 (kg)</th>
                <th>返工 (件次)</th>
                <th>返工 (kg)</th>
                <th>加工登记</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.activity?.teams || []" :key="row.team_id">
                <th scope="row">{{ row.team_name }}</th>
                <td>{{ formatAmount(row.completed_quantity) }}</td>
                <td>{{ formatAmount(row.completed_weight) }}</td>
                <td>{{ formatAmount(row.rework_quantity) }}</td>
                <td>{{ formatAmount(row.rework_weight) }}</td>
                <td>{{ row.record_count }}</td>
                <td><ElButton link @click="openProcessing(row.team_id)">加工记录</ElButton></td>
              </tr>
            </tbody>
          </AppDetailTable>
        </div>
      </DashboardCard>
      <div v-else class="performance-table-wrap">
        <AppDetailTable class="performance-table">
          <caption>
            {{
              scene === 'production'
                ? '当前流水号 · 按业务、任务和工序查看'
                : `受检明细 · ${basisLabel}`
            }}
          </caption>
          <thead v-if="scene === 'production'">
            <tr>
              <th scope="col">班组</th>
              <th scope="col">流水号</th>
              <th scope="col">材质</th>
              <th scope="col">业务</th>
              <th scope="col">加工任务</th>
              <th scope="col">工艺工序</th>
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
              <th scope="col">材质</th>
              <th scope="col">受检 (件次)</th>
              <th scope="col">合格 (件次)</th>
              <th scope="col">不合格 (件次)</th>
              <th scope="col">合格率</th>
              <th scope="col">检查记录</th>
            </tr>
          </thead>
          <tbody v-if="scene === 'production'">
            <tr
              v-for="row in report.production.scopes"
              :key="row.scope_id"
              :class="{ 'is-current-scope': row.scope_id === productionScope?.scope_id }"
            >
              <th scope="row">{{ row.team_name }}</th>
              <td>{{ row.serial_no }}</td>
              <td>{{ row.material_name || '未填写材质' }}</td>
              <td>{{ row.purpose_name || '未指定任务' }}</td>
              <td>{{ row.processing_task_name || '历史未登记任务' }}</td>
              <td>{{ row.process_step_name || '—' }}</td>
              <td>{{ formatAmount(row.completed_quantity) }}</td>
              <td>{{ formatAmount(row.completed_weight) }}</td>
              <td>{{ formatAmount(row.rework_quantity) }}</td>
              <td>{{ formatAmount(row.rework_weight) }}</td>
              <td>{{ formatAmount(row.record_count) }} 笔</td>
              <td>
                <ElButton link type="primary" @click="selectWork(row.scope_id)">查看趋势</ElButton>
              </td>
            </tr>
            <tr v-if="!report.production.scopes.length">
              <td colspan="12">当前范围没有加工记录</td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="row in qualityRows" :key="JSON.stringify([row.team_id, row.material_name])">
              <th scope="row">{{ row.team_name }}</th>
              <td>{{ row.material_name || '未填写材质' }}</td>
              <td>{{ formatAmount(row.checked_quantity) }}</td>
              <td>{{ formatAmount(row.passed_quantity) }}</td>
              <td>{{ formatAmount(row.failed_quantity) }}</td>
              <td>{{ row.pass_rate == null ? '—' : `${row.pass_rate.toFixed(2)}%` }}</td>
              <td>{{ row.record_count }} 笔</td>
            </tr>
            <tr v-if="!qualityRows.length">
              <td colspan="7">当前筛选条件下没有检查记录</td>
            </tr>
          </tbody>
        </AppDetailTable>
      </div>
    </template>
  </section>
</template>
<style scoped>
.factory-performance {
  display: grid;
  gap: 16px;
  flex-shrink: 0;
  min-width: 0;
}
.performance-toolbar :deep(.dashboard-toolbar__filters > .el-select) {
  width: 136px;
}
.performance-toolbar :deep(.material-input) {
  width: 190px;
}
.performance-toolbar :deep(.record-date-trigger) {
  max-width: 340px;
}
.performance-view-options,
.performance-view-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.performance-view-controls {
  margin-left: auto;
}
@media (max-width: 1600px) {
  .performance-toolbar :deep(.dashboard-toolbar__updated) {
    display: none;
  }
}
.production-context,
.quality-basis,
.performance-scope,
.quality-issues-summary,
.quality-issues-summary > div {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.quality-basis > .el-button,
.quality-issues-summary > .el-button {
  margin-left: auto;
}
.production-context {
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid var(--wm-border);
  background: var(--wm-bg);
}
.production-context > div:first-child {
  display: flex;
  align-items: center;
  gap: 10px;
}
.production-context > .el-select {
  width: min(400px, 100%);
}
.production-context strong {
  font-size: 18px;
}
.production-context span,
.performance-scope {
  font-size: 12px;
  color: var(--wm-muted);
}
.performance-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.quality-issues-summary {
  padding: 14px 18px;
  border: 1px solid var(--wm-border);
  border-radius: 12px;
  background: var(--wm-bg);
  font-size: 13px;
}
.quality-issues-summary span {
  color: var(--wm-muted);
}
.performance-table-wrap {
  border: 1px solid var(--wm-border);
  border-radius: 14px;
  overflow: auto;
  background: var(--wm-bg);
}
.performance-table-scroll {
  overflow-x: auto;
}
.performance-table {
  width: 100%;
  white-space: nowrap;
}
.performance-table :deep(caption) {
  padding: 16px 18px;
  text-align: left;
  font-weight: 600;
  font-size: 14px;
}
.performance-table :deep(td),
.performance-table :deep(th) {
  text-align: left;
}
.performance-table :deep(.is-current-scope) {
  background: var(--wm-hover);
}
@media (max-width: 900px) {
  .performance-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

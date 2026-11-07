<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { ElOption } from 'element-plus'
import {
  IconArrowRight,
  IconBox,
  IconTruckDelivery,
  IconAlertTriangle,
  IconTarget,
  IconRefresh,
  IconClock,
} from '@tabler/icons-vue'
import type { EChartsCoreOption } from 'echarts/core'
import AppAlert from './AppAlert.vue'
import AppButton from './AppButton.vue'
import AppSelect from './AppSelect.vue'
import DashboardCard from './DashboardCard.vue'
import DashboardToolbar from './DashboardToolbar.vue'
import DashboardMetric from './DashboardMetric.vue'
import DashboardDistribution from './DashboardDistribution.vue'
import LedgerChart from './LedgerChart.vue'
import TeamProductionChart from './TeamProductionChart.vue'
import StatePanel from './StatePanel.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import {
  useDashboardChart,
  dashboardBar,
  dashboardLine,
  dashboardColors,
} from '@/composables/useDashboardChart'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { factoryToday, formatAmount as number, formatDateTime } from '@/utils/format'
import type { FactoryOverview } from '@/types/factoryOverview'
import type { FactoryPerformance } from '@/types/factoryPerformance'
import type { ProductionSchedule, ScheduleOverview } from '@/types/productionSchedule'
import type { Metric } from '@/types/materialAnalytics'

const props = defineProps<{ days: number; metric: Metric; motion: boolean }>()
const emit = defineEmits<{ preference: [values: Record<string, string>] }>()
const router = useRouter()
const stock = ref<FactoryOverview | null>(null)
const performance = ref<FactoryPerformance | null>(null)
const delivery = ref<ScheduleOverview | null>(null)
const loading = ref(false),
  errors = ref<string[]>([]),
  updated = ref('')
const trendView = ref('movement')
const productionTeamId = ref<number>()
const productionTeams = computed(() => performance.value?.activity?.teams || [])
const visibleProductionTeams = computed(() =>
  productionTeamId.value
    ? productionTeams.value.filter((team) => team.team_id === productionTeamId.value)
    : productionTeams.value,
)
let generation = 0
const { palette, tooltip, plot } = useDashboardChart()
const colors = [
  dashboardColors.primary,
  dashboardColors.secondary,
  dashboardColors.warning,
  dashboardColors.danger,
]
const unit = computed(() => (props.metric === 'weight' ? 'kg' : '件'))
const period = computed(() => `近 ${props.days} 天`)
const periodOptions = computed(() =>
  [...new Set([7, 30, 90, props.days])]
    .sort((a, b) => a - b)
    .map((value) => ({ value: String(value), label: `${value} 天` })),
)
const ageDistribution = computed(() =>
  (stock.value?.stock_age || []).map((row, i) => ({
    key: row.key,
    label: row.label || row.key,
    value: row[props.metric],
    color: [
      dashboardColors.primary,
      dashboardColors.secondary,
      dashboardColors.warning,
      dashboardColors.danger,
    ][i % 4]!,
  })),
)
const teamRows = computed(() => stock.value?.teams.filter((team) => team.id != null) || [])
const stockWarning = computed(() => {
  const missing =
    stock.value?.teams.filter((team) => team.id == null).map((team) => team.name) || []
  const legacy = stock.value?.legacy_received_count || 0
  return [
    missing.length ? `未配置班组：${missing.join('、')}` : '',
    legacy ? `${legacy} 条历史接收未纳入库存` : '',
  ]
    .filter(Boolean)
    .join('；')
})
async function load(reset = false) {
  const token = ++generation
  loading.value = true
  if (reset) {
    stock.value = null
    performance.value = null
    delivery.value = null
    updated.value = ''
  }
  const today = factoryToday()
  const results = await Promise.allSettled([
    factoryOverviewApi.get(props.days),
    factoryPerformanceApi.get({
      include_activity: true,
      date_from: dayjs(today)
        .subtract(props.days - 1, 'day')
        .format('YYYY-MM-DD'),
      date_to: today,
    }),
    productionScheduleApi.overview(props.days),
  ])
  if (token !== generation) return
  const [inventoryResult, performanceResult, deliveryResult] = results
  if (inventoryResult.status === 'fulfilled') stock.value = inventoryResult.value
  if (performanceResult.status === 'fulfilled') performance.value = performanceResult.value
  if (deliveryResult.status === 'fulfilled') delivery.value = deliveryResult.value
  errors.value = results.flatMap((result, i) =>
    result.status === 'rejected' ? [['库存与交接', '加工与质量', '交期'][i]!] : [],
  )
  if (!errors.value.length)
    updated.value = inventoryResult.status === 'fulfilled' ? inventoryResult.value.as_of : ''
  loading.value = false
}
watch(
  () => props.days,
  () => void load(true),
  { immediate: true },
)
const timer = setInterval(() => {
  if (!document.hidden && !loading.value) void load()
}, 60000)
onBeforeUnmount(() => {
  ++generation
  clearInterval(timer)
})
function inventory(query: Record<string, string> = {}) {
  void router.push({ path: '/material-trace', query: { availability: 'current', ...query } })
}
function teamInventory(index: number, pending = false) {
  const team = teamRows.value[index]
  if (team?.id)
    void router.push({
      path: `/team-workspaces/${team.id}`,
      query: { tab: pending ? 'pending' : 'stock' },
    })
}
function openProduction(teamId: number) {
  void router.push({
    path: `/team-workspaces/${teamId}`,
    query: {
      tab: 'processing',
      date_from: dayjs(factoryToday())
        .subtract(props.days - 1, 'day')
        .format('YYYY-MM-DD'),
      date_to: factoryToday(),
    },
  })
}
function stockAge(key: string) {
  const ranges: Record<string, Record<string, string>> = {
    lt1: { stock_age_max: '1' },
    '1_3': { stock_age_min: '1', stock_age_max: '3' },
    '3_7': { stock_age_min: '3', stock_age_max: '7' },
    ge7: { stock_age_min: '7' },
  }
  inventory(ranges[key] || {})
}
function attentionDue(row: ProductionSchedule) {
  return (
    row.batches
      ?.filter((batch) => batch.status === row.status)
      .map((batch) => batch.due_at)
      .sort()[0] || row.due_at
  )
}
function schedule(row?: ProductionSchedule, overdue = false) {
  void router.push({
    path: row ? `/team-workspaces/${row.team_id}` : '/production-schedules',
    query: row
      ? { tab: 'delivery-schedule', schedule_id: String(row.id) }
      : overdue
        ? { status: 'overdue' }
        : {},
  })
}
const metrics = computed(() => [
  {
    label: '全厂在库',
    value: stock.value?.totals[`on_hand_${props.metric}`] ?? null,
    unit: unit.value,
    detail: stock.value
      ? `在途 ${number(stock.value.totals[`in_transit_${props.metric}`])} ${unit.value}`
      : '读取当前库存',
    icon: IconBox,
    tone: 'info' as const,
    precision: props.metric === 'weight' ? 2 : 0,
    help: '各班组未转出库存合计。已转出、下序未签收的物料单独列为在途，不重复计入在库。',
    open: () => inventory(),
  },
  {
    label: '待交接',
    value: stock.value?.pending.batches ?? null,
    unit: '批',
    detail: stock.value
      ? `${number(stock.value.pending[props.metric])} ${unit.value} 待确认`
      : '读取交接记录',
    icon: IconTruckDelivery,
    tone: 'warning' as const,
    help: '当前内部待签收与对外待确认批次。点击查看转料记录。',
    open: () => router.push('/transfer-batches?status=pending'),
  },
  {
    label: '逾期未交完',
    value: delivery.value?.overdue_count ?? null,
    unit: '节点',
    detail: delivery.value
      ? `今日另有 ${number(delivery.value.today_count)} 个节点待交`
      : '读取班组交期',
    icon: IconAlertTriangle,
    tone: 'danger' as const,
    help: '当前所有未履约的逾期班组节点，不受统计天数限制。完成按实际转出判断，下序签收单独记录；库房备料不参加交期考核。',
    open: () => schedule(undefined, true),
  },
  {
    label: '按期交接率',
    value: delivery.value?.on_time_rate ?? null,
    unit: '%',
    detail: delivery.value
      ? `${period.value} · ${number(delivery.value.assessed_count)} 个已考核节点`
      : '读取交期履约情况',
    icon: IconTarget,
    tone: 'success' as const,
    precision: 1,
    help: '所选周期交期范围内，按时完成节点 ÷（按时完成＋逾期完成＋逾期未交完）。未到期、未填写交期及库房备料不参与；没有可考核节点显示 —。',
    open: () => schedule(),
  },
])
const stockOption = computed<EChartsCoreOption>(() =>
  plot(
    teamRows.value.map((team) => team.name),
    [
      dashboardBar(
        '在库',
        teamRows.value.map((team) => team.balance?.[`on_hand_${props.metric}`] ?? null),
        colors[0]!,
      ),
      dashboardBar(
        '待签收',
        teamRows.value.map((team) => team.pending_incoming?.[props.metric] ?? 0),
        colors[2]!,
      ),
    ],
    unit.value,
    true,
  ),
)
const deliveryValues = computed(() =>
  delivery.value
    ? [
        delivery.value.period.completed,
        delivery.value.period.completed_late,
        delivery.value.period.overdue,
      ]
    : [],
)
const deliveryLabels = ['按时完成', '逾期完成', '逾期未交完']
const deliveryColors = [dashboardColors.success, colors[2], colors[3]]
const deliveryOption = computed<EChartsCoreOption>(() => ({
  tooltip: { ...tooltip.value, trigger: 'item', formatter: '{b}：{c} 个节点' },
  series: [
    {
      type: 'pie',
      radius: ['74%', '94%'],
      center: ['50%', '50%'],
      label: { show: false },
      emphasis: { scaleSize: 4 },
      itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: palette.value?.surface || '#fff' },
      data: deliveryValues.value.map((value, i) => ({
        value,
        name: deliveryLabels[i],
        itemStyle: { color: deliveryColors[i] },
      })),
    },
  ],
}))
const trendOption = computed<EChartsCoreOption>(() => {
  const labels = stock.value?.trend.map((row) => row.key.slice(5)) || []
  const values = [
    stock.value?.trend.map((row) => row.inbound[props.metric]) || [],
    stock.value?.trend.map((row) => row.outbound[props.metric] + row.shipment[props.metric]) || [],
  ]
  return plot(
    labels,
    values.map((data, i) => dashboardLine(['入库', '对外出库'][i]!, data, colors[i]!, i === 0)),
    unit.value,
  )
})
const qcTeam = computed(() => performance.value?.teams.find((team) => team.code === 'FACTORY-QC'))
function quality() {
  if (qcTeam.value)
    void router.push({
      path: `/team-workspaces/${qcTeam.value.id}`,
      query: { tab: 'quality-feedback' },
    })
  else emit('preference', { view: 'quality' })
}
</script>

<template>
  <div class="operations-overview" :class="{ 'operations-overview--motion': motion }">
    <DashboardToolbar :updated-at="updated" :loading="loading">
      <WatermelonSegmented
        label="概览统计单位"
        :model-value="metric"
        :options="[
          { value: 'weight', label: '重量' },
          { value: 'quantity', label: '件数' },
        ]"
        @update:model-value="emit('preference', { metric: $event })"
      />
      <WatermelonSegmented
        label="概览统计周期"
        :model-value="String(days)"
        :options="periodOptions"
        @update:model-value="emit('preference', { days: $event })"
      />
      <template #actions
        ><AppButton :loading="loading" aria-label="刷新运行概览" @click="load()"
          ><IconRefresh :size="17" />刷新</AppButton
        ></template
      >
    </DashboardToolbar>
    <AppAlert
      v-if="errors.length"
      type="warning"
      :closable="false"
      :title="`${errors.join('、')}更新失败；已有数据保留，未读取的指标显示 —。`"
    />
    <AppAlert v-if="stockWarning" type="warning" :closable="false" :title="stockWarning" />
    <div class="operations-metrics">
      <DashboardMetric
        v-for="item in metrics"
        :key="item.label"
        v-bind="item"
        :motion="motion"
        @open="item.open"
      />
    </div>
    <div class="operations-main">
      <DashboardCard
        :title="trendView === 'movement' ? '物料收发趋势' : '各班组加工完成量'"
        :subtitle="`${period} · ${trendView === 'production' && metric === 'quantity' ? '件次' : unit}`"
        :help="
          trendView === 'movement'
            ? '入库仅统计库房登记，对外出库包含库房对外出库与检验发货；内部交接不计为新增产量。'
            : '各班组分别统计实际加工登记，正常加工与返工分开。点击柱条查看该班组加工记录。'
        "
      >
        <template #actions>
          <AppSelect
            v-if="trendView === 'production'"
            v-model="productionTeamId"
            class="operations-team-select"
            aria-label="概览加工班组"
            placeholder="全部班组"
            clearable
          >
            <ElOption
              v-for="team in productionTeams"
              :key="team.team_id"
              :label="team.team_name"
              :value="team.team_id"
            />
          </AppSelect>
          <WatermelonSegmented
            v-model="trendView"
            label="趋势内容"
            :options="[
              { value: 'movement', label: '收发' },
              { value: 'production', label: '加工' },
            ]"
        /></template>
        <div
          class="operations-trend"
          :class="{ 'operations-trend--teams': trendView === 'production' }"
        >
          <TeamProductionChart
            v-if="trendView === 'production' && performance?.activity"
            :rows="visibleProductionTeams"
            :metric="metric"
            :motion="motion"
            @select="openProduction"
          />
          <LedgerChart
            v-else-if="trendView === 'movement' && stock"
            :option="trendOption"
            smooth-update
            :enter-duration="800"
            :update-duration="400"
            :motion="motion"
            label="每日入库与对外出库"
          /><StatePanel
            v-else
            :state="loading ? 'loading' : 'error'"
            title="趋势数据未读取"
            @retry="load()"
          />
        </div>
        <template v-if="trendView === 'movement' && stock" #footer
          ><div class="operations-trend-summary">
            <span
              >入库 <strong>{{ number(stock.period_totals.inbound[metric]) }}</strong>
              {{ unit }}</span
            ><span
              >对外出库
              <strong>{{
                number(stock.period_totals.outbound[metric] + stock.period_totals.shipment[metric])
              }}</strong>
              {{ unit }}</span
            >
          </div>
        </template>
      </DashboardCard>
      <DashboardCard
        title="交期与待办"
        :subtitle="`${period}履约 · 当前待处理`"
        help="圆环统计所选周期内已完成或已逾期的交接节点；待办保留所有逾期和今日待交节点，按紧急程度显示前六项。"
      >
        <template #actions
          ><AppButton link @click="schedule()">生产排期<IconArrowRight :size="15" /></AppButton
        ></template>
        <template v-if="delivery">
          <div class="operations-delivery">
            <div class="operations-donut">
              <LedgerChart
                :option="deliveryOption"
                smooth-update
                :enter-duration="800"
                :update-duration="400"
                label="交期履约构成"
                :motion="motion"
              />
              <div>
                <strong>{{ number(delivery.assessed_count) }}</strong
                ><span>已考核节点</span>
              </div>
            </div>
            <div class="operations-delivery-legend">
              <div v-for="(label, i) in deliveryLabels" :key="label">
                <i :style="{ background: deliveryColors[i] }" /><span>{{ label }}</span
                ><strong>{{ number(deliveryValues[i]) }}</strong>
              </div>
            </div>
          </div>
          <div class="operations-attention" aria-label="交期待办">
            <button
              v-for="row in delivery.attention"
              :key="row.id"
              type="button"
              @click="schedule(row)"
            >
              <span class="operations-due-dot" :class="row.status" /><strong>{{
                row.serial_no
              }}</strong
              ><span class="operations-attention-team">{{ row.team_name }}</span
              ><time>{{ formatDateTime(attentionDue(row)).slice(5) }}</time
              ><IconArrowRight :size="14" />
            </button>
            <p v-if="!delivery.attention.length" class="operations-empty">
              当前没有逾期或今日待交节点
            </p>
          </div>
        </template>
        <StatePanel
          v-else
          :state="loading ? 'loading' : 'error'"
          title="交期数据未读取"
          @retry="load()"
        />
      </DashboardCard>
    </div>
    <div class="operations-lower">
      <DashboardCard
        title="物料在哪些班组"
        :subtitle="`当前库存 · ${unit}`"
        help="显示各班组未转出的物料与待签收量。点击柱条进入对应班组；停用班组的已有库存仍保留。"
      >
        <template #actions
          ><AppButton link @click="inventory()">库存明细<IconArrowRight :size="15" /></AppButton
        ></template>
        <div class="operations-stock-chart">
          <LedgerChart
            v-if="stock"
            :option="stockOption"
            smooth-update
            :enter-duration="800"
            :update-duration="400"
            :motion="motion"
            label="各班组当前库存与待签收量"
            :empty="!teamRows.length"
            @select="teamInventory($event.dataIndex, $event.seriesIndex === 1)"
          /><StatePanel
            v-else
            :state="loading ? 'loading' : 'error'"
            title="库存数据未读取"
            @retry="load()"
          />
        </div>
      </DashboardCard>
      <DashboardCard
        title="库存滞留"
        :subtitle="`从本班组接收起算 · ${unit}`"
        help="从本班组接收物料的时刻起算，加工、拆批和同班组转投不重新计时。"
      >
        <template #actions><IconClock :size="18" class="operations-muted" /></template>
        <DashboardDistribution
          v-if="stock"
          :rows="ageDistribution"
          :unit="unit"
          label="库存滞留分布"
          selectable
          :motion="motion"
          @select="stockAge"
        />
        <StatePanel
          v-else
          :state="loading ? 'loading' : 'error'"
          title="滞留数据未读取"
          @retry="load()"
        />
        <template #footer
          ><AppButton link @click="stockAge('ge7')"
            >查看长期滞留物料<IconArrowRight :size="15" /></AppButton
        ></template>
      </DashboardCard>
      <DashboardCard
        title="质量跟进"
        :subtitle="`${period}发现的问题`"
        help="仅统计当前账号可查看的质量问题。问题状态按待反馈、处理中、已关闭区分；不将抽检、全检和复检混算为一个合格率。"
      >
        <template #actions
          ><AppButton link @click="quality()"
            ><IconArrowRight :size="17" /><span class="operations-sr-only"
              >查看质量跟进</span
            ></AppButton
          ></template
        >
        <template v-if="performance">
          <div class="operations-quality-total">
            <strong>{{ number(performance.issues.summary.unresolved) }}</strong
            ><span>项未闭环</span>
          </div>
          <div class="operations-quality-states">
            <span
              >待反馈 <b>{{ performance.issues.summary.pending }}</b></span
            ><span
              >处理中 <b>{{ performance.issues.summary.processing }}</b></span
            ><span
              >已关闭 <b>{{ performance.issues.summary.closed }}</b></span
            >
          </div>
          <div class="operations-problems">
            <div
              v-for="row in performance.issues.problems.slice(0, 3)"
              :key="row.problem_type_id ?? row.name"
            >
              <span>{{ row.name }}</span
              ><strong>{{ row.issue_count }}</strong>
            </div>
            <p v-if="!performance.issues.problems.length" class="operations-empty">
              所选周期暂无质量问题
            </p>
          </div>
        </template>
        <StatePanel
          v-else
          :state="loading ? 'loading' : 'error'"
          title="质量数据未读取"
          @retry="load()"
        />
        <template #footer
          ><AppButton link @click="emit('preference', { view: 'quality' })"
            >检验与质量分析<IconArrowRight :size="15" /></AppButton
        ></template>
      </DashboardCard>
    </div>
  </div>
</template>

<style scoped>
.operations-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.operations-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.operations-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.operations-main {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
.operations-stock-chart {
  height: 280px;
  display: flex;
}
.operations-main > :deep(.dashboard-card) {
  min-height: 340px;
}
.operations-lower {
  display: grid;
  grid-template-columns: 1.45fr 1fr 1fr;
  gap: 16px;
}
.operations-trend {
  height: 254px;
  display: flex;
  padding-top: 8px;
}
.operations-trend--teams {
  height: auto;
}
.operations-team-select {
  width: 136px;
}
.operations-delivery {
  display: flex;
  align-items: center;
  gap: 24px;
  padding-bottom: 8px;
}
.operations-donut {
  width: 128px;
  height: 128px;
  position: relative;
  display: flex;
  flex-shrink: 0;
}
.operations-donut > div:last-child {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.operations-donut strong {
  font-size: 25px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.operations-donut span {
  font-size: 10px;
  color: var(--wm-muted);
  margin-top: 3px;
}
.operations-delivery-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.operations-delivery-legend > div {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.operations-delivery-legend i,
.operations-due-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.operations-delivery-legend strong {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.operations-attention {
  max-height: 166px;
  overflow-y: auto;
  border-top: 1px solid var(--wm-border);
}
.operations-attention button {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 10px;
  border: 0;
  border-bottom: 1px solid var(--wm-table-divider);
  padding: 9px 0;
  background: transparent;
  color: var(--wm-text);
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}
.operations-attention button:hover {
  background: var(--wm-hover);
}
.operations-attention button strong {
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 145px;
}
.operations-attention-team {
  color: var(--wm-muted);
}
.operations-attention time {
  margin-left: auto;
  font-size: 11px;
  color: var(--wm-muted);
  white-space: nowrap;
}
.operations-due-dot.overdue {
  background: var(--wm-danger-text);
}
.operations-due-dot.today {
  background: var(--wm-warning-text);
}
.operations-quality-total {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-top: 6px;
}
.operations-quality-total strong {
  font-size: 32px;
  font-weight: 600;
}
.operations-quality-total span {
  font-size: 12px;
  color: var(--wm-muted);
}
.operations-quality-states {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  font-size: 11px;
  color: var(--wm-muted);
  margin: 12px 0 14px;
}
.operations-quality-states b {
  color: var(--wm-text);
  margin-left: 3px;
}
.operations-problems > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
  border-top: 1px solid var(--wm-table-divider);
}
.operations-problems strong {
  font-variant-numeric: tabular-nums;
}
.operations-trend-summary {
  display: flex;
  gap: 20px;
  color: var(--wm-muted);
  font-size: 11px;
}
.operations-trend-summary strong {
  color: var(--wm-text);
  font-size: 13px;
  margin: 0 3px;
}
.operations-muted,
.operations-empty {
  color: var(--wm-muted);
}
.operations-empty {
  font-size: 12px;
  padding: 16px 0;
  text-align: center;
}
.operations-overview :deep(.el-button > span) {
  gap: 6px;
}
.operations-overview :deep(.state-panel) {
  min-height: 150px;
}
.operations-overview--motion .operations-metrics > *,
.operations-overview--motion .dashboard-card {
  animation: operations-enter 320ms ease-out both;
}
.operations-overview--motion .operations-metrics > :nth-child(2) {
  animation-delay: 35ms;
}
.operations-overview--motion .operations-metrics > :nth-child(3) {
  animation-delay: 70ms;
}
.operations-overview--motion .operations-metrics > :nth-child(4) {
  animation-delay: 105ms;
}
@keyframes operations-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 1200px) {
  .operations-updated > span:last-child:not(.operations-status) {
    display: none;
  }
  .operations-lower {
    grid-template-columns: 1fr 1fr;
  }
  .operations-lower > :first-child {
    grid-column: 1 / -1;
  }
}
@media (max-width: 800px) {
  .operations-metrics {
    grid-template-columns: 1fr 1fr;
  }
  .operations-main,
  .operations-lower {
    grid-template-columns: 1fr;
  }
  .operations-toolbar {
    align-items: flex-start;
  }
  .operations-tools {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .operations-overview--motion .dashboard-card,
  .operations-overview--motion .operations-metrics > * {
    animation: none;
  }
}
</style>

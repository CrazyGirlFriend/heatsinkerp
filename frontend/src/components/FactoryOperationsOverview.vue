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
  IconCheck,
} from '@tabler/icons-vue'
import AppAlert from './AppAlert.vue'
import AppButton from './AppButton.vue'
import AppSelect from './AppSelect.vue'
import DashboardCard from './DashboardCard.vue'
import DashboardToolbar from './DashboardToolbar.vue'
import DashboardMetric from './DashboardMetric.vue'
import FactoryTeamStatus from './FactoryTeamStatus.vue'
import TeamProductionChart from './TeamProductionChart.vue'
import StatePanel from './StatePanel.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { factoryToday, formatAmount as number, formatDateTime } from '@/utils/format'
import type { FactoryOverview, FactoryTeam } from '@/types/factoryOverview'
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
const trendView = ref('stock')
const attentionView = ref('delivery')
const productionTeamId = ref<number>()
const productionTeams = computed(() => performance.value?.activity?.teams || [])
const visibleProductionTeams = computed(() =>
  productionTeamId.value
    ? productionTeams.value.filter((team) => team.team_id === productionTeamId.value)
    : productionTeams.value,
)
let generation = 0
const unit = computed(() => (props.metric === 'weight' ? 'kg' : '件'))
const period = computed(() => `近 ${props.days} 天`)
const periodOptions = computed(() =>
  [...new Set([7, 30, 90, props.days])]
    .sort((a, b) => a - b)
    .map((value) => ({ value: String(value), label: `${value} 天` })),
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
function teamInventory(team: FactoryTeam, state?: string) {
  if (!team.id) return
  const filters: Record<string, string> =
    state && state !== 'pending' ? { processing_state: state } : {}
  if (!team.active) {
    inventory({ inventory_team_id: String(team.id), ...filters })
    return
  }
  void router.push({
    path: `/team-workspaces/${team.id}`,
    query: { tab: state === 'pending' ? 'pending' : 'stock', availability: 'current', ...filters },
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
function elapsed(time: string | null | undefined) {
  if (!time) return '时间未填写'
  const hours = Math.max(
    0,
    dayjs(stock.value?.as_of || delivery.value?.as_of).diff(dayjs(time), 'hour'),
  )
  return hours >= 24
    ? `${Math.floor(hours / 24)}天${hours % 24 ? `${hours % 24}小时` : ''}`
    : hours
      ? `${hours}小时`
      : '不足1小时'
}
const attentionOptions = computed(() => [
  {
    value: 'delivery',
    label: `交期${delivery.value ? ` ${delivery.value.overdue_count + delivery.value.today_count}` : ''}`,
  },
  { value: 'age', label: '滞留最长' },
  { value: 'pending', label: `待签收${stock.value ? ` ${stock.value.pending.batches}` : ''}` },
])
const attentionRows = computed(() => {
  if (attentionView.value === 'delivery')
    return (delivery.value?.attention || []).map((row) => ({
      id: String(row.id),
      serial: row.serial_no,
      team: row.team_name,
      time: attentionDue(row),
      tone: row.status === 'overdue' ? 'danger' : 'warning',
      badge: row.status === 'overdue' ? `逾期 ${elapsed(attentionDue(row))}` : '今日到期',
      amount:
        row.target_quantity != null
          ? `待交 ${number(Math.max(0, row.target_quantity - row.dispatched_quantity))} 件`
          : row.target_weight != null
            ? `待交 ${number(Math.max(0, row.target_weight - row.dispatched_weight))} kg`
            : '数量待填写',
      open: () => schedule(row),
    }))
  if (attentionView.value === 'age')
    return (stock.value?.stock_attention || []).map((row) => ({
      id: row.batch_no,
      serial: row.serial_no || row.batch_no,
      team: row.team_name,
      time: row.received_at,
      tone: 'neutral',
      badge: `滞留 ${elapsed(row.received_at)}`,
      amount: `${number(row.quantity)} 件 · ${number(row.weight)} kg`,
      open: () =>
        inventory({
          inventory_team_id: String(row.team_id),
          ...(row.serial_no ? { serial_no: row.serial_no } : {}),
        }),
    }))
  return (stock.value?.pending_attention || []).map((row) => ({
    id: row.batch_no,
    serial: row.serial_no || row.batch_no,
    team: `${row.source_team_name || '外部'} → ${row.next_team_name || row.external_destination || '待确认'}`,
    time: row.created_at,
    tone: 'warning',
    badge: `等待 ${elapsed(row.created_at)}`,
    amount: `${number(row.quantity)} 件 · ${number(row.weight)} kg`,
    open: () => router.push({ path: '/transfer-batches', query: { batch_no: row.batch_no } }),
  }))
})
const attentionReady = computed(() =>
  attentionView.value === 'delivery' ? !!delivery.value : !!stock.value,
)
function allAttention() {
  if (attentionView.value === 'delivery') schedule()
  else if (attentionView.value === 'age') inventory()
  else void router.push('/transfer-batches?status=pending')
}
const qcTeam = computed(() => performance.value?.teams.find((team) => team.code === 'FACTORY-QC'))
function quality() {
  if (qcTeam.value)
    void router.push({
      path: `/team-workspaces/${qcTeam.value.id}`,
      query: {
        tab: 'quality-feedback',
        date_from: dayjs(factoryToday())
          .subtract(props.days - 1, 'day')
          .format('YYYY-MM-DD'),
        date_to: factoryToday(),
      },
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
        class="operations-teams"
        :title="trendView === 'stock' ? '各班组当前情况' : '各班组加工完成量'"
        :subtitle="
          trendView === 'stock'
            ? `实际在库 · ${unit}`
            : `${period} · ${metric === 'quantity' ? '件次' : unit}`
        "
        :help="
          trendView === 'stock'
            ? '在库只计算本班实际剩余物料；已转出待签收单独显示。加工状态与库存明细一致，废料和历史进度未标明的物料不算已完成。库房只负责备料与转出。'
            : '按实际加工日期，各班组分别统计正常加工和返工。不同工序的件次不能相加作为成品产量。'
        "
      >
        <template #actions
          ><WatermelonSegmented
            v-model="trendView"
            label="班组概况内容"
            :options="[
              { value: 'stock', label: '当前物料' },
              { value: 'production', label: '加工完成' },
            ]"
        /></template>
        <FactoryTeamStatus
          v-if="trendView === 'stock' && stock"
          :teams="teamRows"
          :metric="metric"
          :motion="motion"
          @open="teamInventory"
        />
        <div
          v-else-if="trendView === 'production' && performance?.activity"
          class="operations-production"
        >
          <AppSelect
            v-model="productionTeamId"
            class="operations-team-select"
            aria-label="概览加工班组"
            placeholder="全部班组"
            clearable
            ><ElOption
              v-for="team in productionTeams"
              :key="team.team_id"
              :label="team.team_name"
              :value="team.team_id"
          /></AppSelect>
          <TeamProductionChart
            :rows="visibleProductionTeams"
            :metric="metric"
            :motion="motion"
            @select="openProduction"
          />
        </div>
        <StatePanel
          v-else
          :state="loading ? 'loading' : 'error'"
          title="班组数据未读取"
          @retry="load()"
        />
        <template #footer
          ><div class="operations-team-footer">
            <span
              ><i class="operations-live-dot" />{{ teamRows.length }} 个班组<span
                class="operations-footer-note"
              >
                · 点击数量查看明细</span
              ></span
            >
            <AppButton
              link
              @click="
                trendView === 'stock' ? inventory() : emit('preference', { view: 'production' })
              "
              >{{ trendView === 'stock' ? '库存明细' : '生产完成分析' }}<IconArrowRight :size="15"
            /></AppButton></div
        ></template>
      </DashboardCard>
      <DashboardCard class="operations-inbox" title="需要跟进" subtitle="当前待办">
        <template #actions
          ><span class="operations-inbox-icon"><IconClock :size="19" /></span
        ></template>
        <WatermelonSegmented v-model="attentionView" label="待办类型" :options="attentionOptions" />
        <div v-if="attentionReady" class="operations-attention" aria-label="当前待办清单">
          <AppButton
            v-for="row in attentionRows"
            :key="row.id"
            link
            class="operations-attention-item"
            :aria-label="`查看${row.serial} ${row.team} ${row.badge}`"
            :title="formatDateTime(row.time)"
            @click="row.open()"
          >
            <span class="operations-attention-content">
              <span class="operations-attention-top"
                ><strong>{{ row.serial }}</strong
                ><span class="operations-attention-badge" :class="row.tone">{{
                  row.badge
                }}</span></span
              >
              <span class="operations-attention-bottom"
                ><span>{{ row.team }}</span
                ><span>{{ row.amount }}</span
                ><IconArrowRight :size="14"
              /></span>
            </span>
          </AppButton>
          <div v-if="!attentionRows.length" class="operations-empty">
            <IconCheck :size="25" /><strong>{{
              attentionView === 'delivery'
                ? '当前无逾期或今日待交'
                : attentionView === 'pending'
                  ? '当前没有待签收物料'
                  : '当前没有在库物料'
            }}</strong>
          </div>
        </div>
        <StatePanel
          v-else
          :state="loading ? 'loading' : 'error'"
          title="待办数据未读取"
          @retry="load()"
        />
        <template #footer
          ><AppButton link class="operations-attention-all" @click="allAttention"
            >{{
              attentionView === 'delivery'
                ? '查看全部交期'
                : attentionView === 'age'
                  ? '查看库存明细'
                  : '查看全部待签收'
            }}<IconArrowRight :size="15" /></AppButton
        ></template>
      </DashboardCard>
    </div>
    <div class="operations-context">
      <div class="operations-fulfilment">
        <span class="operations-context-label">{{ period }}交期</span
        ><span
          >按时完成 <b>{{ delivery ? number(delivery.period.completed) : '—' }}</b></span
        ><span
          >逾期完成 <b>{{ delivery ? number(delivery.period.completed_late) : '—' }}</b></span
        ><span
          >逾期未交完 <b>{{ delivery ? number(delivery.period.overdue) : '—' }}</b></span
        >
      </div>
      <AppButton link class="operations-quality" aria-label="查看质量跟进" @click="quality()"
        ><span>{{ period }}质量</span
        ><b>{{ performance ? `${number(performance.issues.summary.unresolved)} 项未处理` : '—' }}</b
        ><IconArrowRight :size="15"
      /></AppButton>
    </div>
  </div>
</template>
<style scoped>
.operations-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.operations-overview :deep(.dashboard-toolbar) {
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.operations-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--wm-border);
  border-radius: 14px;
  background: var(--wm-bg);
  overflow: hidden;
}
.operations-metrics :deep(.dashboard-metric) {
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 16px 22px;
}
.operations-metrics :deep(.dashboard-metric + .dashboard-metric) {
  border-left: 1px solid var(--wm-border);
}
.operations-metrics :deep(.dashboard-metric strong) {
  font-size: 29px;
}
.operations-metrics :deep(.dashboard-metric__heading) {
  font-size: 12px;
}
.operations-main {
  display: grid;
  grid-template-columns: minmax(0, 2.15fr) minmax(320px, 1fr);
  align-items: stretch;
  gap: 16px;
}
.operations-teams :deep(.dashboard-card__header),
.operations-inbox :deep(.dashboard-card__header) {
  padding: 20px 20px 16px;
}
.operations-teams :deep(.dashboard-card__body) {
  padding-bottom: 8px;
}
.operations-inbox :deep(.dashboard-card__body) {
  display: flex;
  flex-direction: column;
  padding-bottom: 0;
}
.operations-inbox :deep(.wm-segmented) {
  align-self: stretch;
}
.operations-team-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--wm-muted);
  font-size: 11px;
}
.operations-team-footer > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.operations-live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wm-success-text);
}
.operations-inbox-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--wm-muted-surface);
  color: var(--wm-muted);
}
.operations-attention {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-top: 10px;
}
.operations-attention-item.el-button {
  width: 100%;
  height: auto;
  min-height: 70px;
  padding: 14px 0;
  margin: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--wm-table-divider);
  text-align: left;
  white-space: normal;
}
.operations-attention-item.el-button:last-child {
  border-bottom: 0;
}
.operations-attention-item :deep(> span) {
  width: 100%;
  min-width: 0;
}
.operations-attention-content {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.operations-attention-top,
.operations-attention-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.operations-attention-top strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--wm-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.operations-attention-badge {
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--wm-muted);
  background: var(--wm-muted-surface);
  flex-shrink: 0;
}
.operations-attention-badge.danger {
  color: var(--wm-danger-text);
  background: var(--wm-danger-bg);
}
.operations-attention-badge.warning {
  color: var(--wm-warning-text);
  background: var(--wm-warning-bg);
}
.operations-attention-bottom {
  color: var(--wm-muted);
  font-size: 11px;
}
.operations-attention-bottom > span:first-child {
  margin-right: auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.operations-attention-bottom > span:nth-child(2) {
  white-space: nowrap;
}
.operations-attention-bottom > svg {
  flex-shrink: 0;
}
.operations-attention-all {
  width: 100%;
  justify-content: space-between;
}
.operations-attention-all :deep(> span) {
  width: 100%;
  justify-content: space-between;
}
.operations-empty {
  flex: 1;
  display: flex;
  gap: 12px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--wm-muted);
  min-height: 220px;
  font-size: 12px;
}
.operations-empty strong {
  font-weight: 400;
}
.operations-empty svg {
  color: var(--wm-success-text);
}
.operations-production {
  min-height: 448px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.operations-production :deep(.team-production-chart) {
  flex: none;
}
.operations-team-select {
  width: 140px;
  margin: 0 0 12px auto;
}
.operations-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 0 4px;
  font-size: 11px;
  color: var(--wm-muted);
}
.operations-fulfilment {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px;
}
.operations-context b {
  font-weight: 600;
  color: var(--wm-text);
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.operations-context-label {
  color: var(--wm-text);
  font-weight: 500;
}
.operations-quality {
  font-size: 11px;
}
.operations-overview :deep(.el-button > span) {
  gap: 6px;
}
.operations-overview :deep(.state-panel) {
  min-height: 220px;
}
.operations-overview--motion .operations-main > * {
  animation: overview-enter 350ms ease-out both;
}
.operations-overview--motion .operations-main > :nth-child(2) {
  animation-delay: 60ms;
}
@keyframes overview-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 1400px) {
  .operations-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .operations-attention {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 24px;
  }
  .operations-empty {
    grid-column: 1 / -1;
  }
}
@media (max-width: 700px) {
  .operations-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .operations-metrics :deep(.dashboard-metric:nth-child(3)) {
    border-left: 0;
  }
  .operations-metrics :deep(.dashboard-metric:nth-child(n + 3)) {
    border-top: 1px solid var(--wm-border);
  }
  .operations-metrics :deep(.dashboard-metric) {
    padding: 14px;
  }
  .operations-attention {
    display: flex;
  }
  .operations-teams :deep(.dashboard-card__header) {
    flex-wrap: wrap;
  }
  .operations-footer-note {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .operations-overview--motion .operations-main > * {
    animation: none;
  }
}
</style>

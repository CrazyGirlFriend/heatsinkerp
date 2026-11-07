<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import dayjs from 'dayjs'
import {
  IconHash,
  IconBox,
  IconCircleCheck,
  IconTruckDelivery,
  IconRefresh,
  IconArrowRight,
} from '@tabler/icons-vue'
import AppButton from './AppButton.vue'
import AppAlert from './AppAlert.vue'
import DashboardToolbar from './DashboardToolbar.vue'
import DashboardMetric from './DashboardMetric.vue'
import DashboardCard from './DashboardCard.vue'
import DashboardDonut from './DashboardDonut.vue'
import StatePanel from './StatePanel.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { dashboardColors as colors } from '@/composables/useDashboardChart'
import { factoryPerformanceApi } from '@/services/factoryPerformanceApi'
import { factoryToday, formatAmount } from '@/utils/format'
import { materialTypeLabel } from '@/types/materialTransfer'
import type { TeamMaterialOverview } from '@/types/teamMaterials'
import type { FactoryPerformance } from '@/types/factoryPerformance'
import type { Metric } from '@/types/materialAnalytics'

const props = defineProps<{
  teamId: number
  processing: boolean
  overview: TeamMaterialOverview | null
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ refresh: []; navigate: [query: Record<string, string>] }>()
const metric = ref<Metric>('quantity'),
  days = ref('30')
const quality = ref<FactoryPerformance['issues']['summary'] | null>(null)
const qualityLoading = ref(false),
  qualityError = ref('')
let generation = 0
const unit = computed(() => (metric.value === 'quantity' ? '件' : 'kg'))
const current = computed(() => props.overview?.current_stock)
const period = computed(() => ({
  date_from: dayjs(factoryToday())
    .subtract(Number(days.value) - 1, 'day')
    .format('YYYY-MM-DD'),
  date_to: factoryToday(),
}))
function inventory(filters: Record<string, string> = {}) {
  emit('navigate', { tab: 'stock', availability: 'current', ...filters })
}
function openQuality(status?: string) {
  emit('navigate', {
    tab: 'quality-feedback',
    team_id: String(props.teamId),
    ...period.value,
    ...(status ? { status } : {}),
  })
}
async function loadQuality() {
  const token = ++generation
  qualityLoading.value = true
  qualityError.value = ''
  try {
    const data = await factoryPerformanceApi.get({ team_id: props.teamId, ...period.value })
    if (token === generation) quality.value = data.issues.summary
  } catch {
    if (token === generation) qualityError.value = '质量数据读取失败，请重试。'
  } finally {
    if (token === generation) qualityLoading.value = false
  }
}
watch(
  () => [props.teamId, days.value],
  () => {
    quality.value = null
    void loadQuality()
  },
  { immediate: true },
)
watch(
  () => props.overview,
  (value, previous) => {
    if (value && previous) void loadQuality()
  },
)
onBeforeUnmount(() => {
  ++generation
})
function amount(state: string) {
  if (!current.value) return null
  return current.value.processing.find((row) => row.state === state)?.[metric.value] || 0
}
const metrics = computed(() => [
  {
    label: '在库流水号',
    value: current.value?.serial_count ?? null,
    unit: '个',
    icon: IconHash,
    detail: current.value?.unnumbered_batch_count
      ? `另有 ${current.value.unnumbered_batch_count} 批未填写流水号`
      : '当前实际在库',
    help: '仅统计本班组还有剩余物料的流水号，重复批次只算一次；共投按关联流水号去重，已转出待签收的料不计入。',
    open: () => inventory(),
  },
  ...(props.processing
    ? [
        {
          label: '未加工',
          value: amount('unregistered'),
          unit: unit.value,
          precision: metric.value === 'weight' ? 3 : 0,
          icon: IconBox,
          detail: '当前在库 · 尚未登记加工',
          open: () => inventory({ processing_state: 'unregistered' }),
        },
        {
          label: '已加工',
          value: amount('complete'),
          unit: unit.value,
          precision: metric.value === 'weight' ? 3 : 0,
          icon: IconCircleCheck,
          tone: 'success' as const,
          detail: '本批完成 · 尚未转出',
          help: '只统计本批加工完成的剩余物料。部分加工及历史进度未标明单列，不算全部完成。',
          open: () => inventory({ processing_state: 'complete' }),
        },
      ]
    : [
        {
          label: '在库数量',
          value: props.overview?.totals.on_hand_quantity ?? null,
          unit: '件',
          icon: IconBox,
          open: () => inventory(),
        },
        {
          label: '在库重量',
          value: props.overview?.totals.on_hand_weight ?? null,
          unit: 'kg',
          precision: 3,
          icon: IconBox,
          open: () => inventory(),
        },
      ]),
  {
    label: '待签收',
    value: props.overview?.pending_incoming.count ?? null,
    unit: '批',
    icon: IconTruckDelivery,
    tone: 'warning' as const,
    detail: props.overview
      ? `${formatAmount(props.overview.pending_incoming.quantity ?? 0)} 件 · ${formatAmount(props.overview.pending_incoming.weight ?? 0)} kg`
      : undefined,
    open: () => emit('navigate', { tab: 'pending' }),
  },
])
const processingRows = computed(() =>
  [
    { key: 'unregistered', label: '未加工', color: colors.primary },
    { key: 'partial', label: '部分加工', color: colors.warning },
    { key: 'complete', label: '已加工', color: colors.success },
    { key: 'registered', label: '进度未标明', color: colors.neutral },
  ]
    .filter(
      (row) =>
        row.key !== 'registered' ||
        current.value?.processing.some((item) => item.state === 'registered'),
    )
    .map((row) => ({ ...row, value: amount(row.key) ?? 0 })),
)
const materialRows = computed(() =>
  (props.overview?.material_types || [])
    .filter((row) => (row.on_hand_quantity ?? 0) !== 0 || (row.on_hand_weight ?? 0) !== 0)
    .map((row, index) => ({
      key: row.material_type || '',
      label: row.material_type ? materialTypeLabel(row.material_type) : '未分类',
      value: row[`on_hand_${metric.value}`] ?? 0,
      color: [
        colors.primary,
        colors.secondary,
        colors.success,
        colors.warning,
        colors.danger,
        colors.neutral,
      ][index % 6]!,
    })),
)
const qualityRows = computed(() =>
  [
    { key: 'pending', label: '待处理', color: colors.danger },
    { key: 'processing', label: '处理中', color: colors.warning },
    { key: 'closed', label: '已结束', color: colors.success },
  ].map((row) => ({
    ...row,
    value: quality.value?.[row.key as 'pending' | 'processing' | 'closed'] ?? 0,
  })),
)
</script>

<template>
  <section class="team-dashboard" aria-label="班组概览">
    <DashboardToolbar :updated-at="overview?.as_of" :loading="loading">
      <WatermelonSegmented
        v-model="metric"
        label="在库统计单位"
        :options="[
          { value: 'quantity', label: '件数' },
          { value: 'weight', label: '重量' },
        ]"
      />
      <template #actions
        ><AppButton :loading="loading || qualityLoading" @click="emit('refresh')"
          ><IconRefresh :size="17" />刷新</AppButton
        ></template
      >
    </DashboardToolbar>
    <AppAlert v-if="error" :title="error" type="error" :closable="false" />
    <StatePanel
      v-if="!overview || !current"
      :state="error ? 'error' : loading ? 'loading' : 'error'"
      :title="error || (loading ? '正在读取班组概览' : '概览数据未读取，请刷新重试')"
      @retry="emit('refresh')"
    />
    <template v-else>
      <div class="team-dashboard-metrics">
        <DashboardMetric
          v-for="item in metrics"
          :key="item.label"
          v-bind="item"
          :motion="true"
          @open="item.open"
        />
      </div>
      <div
        class="team-dashboard-charts"
        :class="{ 'team-dashboard-charts--warehouse': !processing }"
      >
        <DashboardCard
          v-if="processing"
          title="在库加工状态"
          subtitle="当前剩余物料"
          help="按本班组加工状态划分，已转出不计入，废料、废泥和废屑不参加加工进度统计。部分加工不能当作全部完成。"
        >
          <DashboardDonut
            :rows="processingRows"
            :unit="unit"
            label="在库加工状态分布"
            motion
            selectable
            @select="inventory({ processing_state: $event })"
          />
          <template #footer
            ><AppButton link @click="inventory()">库存明细<IconArrowRight :size="16" /></AppButton
          ></template>
        </DashboardCard>
        <DashboardCard title="在库物料类型" subtitle="当前实际在库">
          <DashboardDonut
            :rows="materialRows"
            :unit="unit"
            label="在库物料类型分布"
            motion
            selectable
            @select="inventory($event ? { material_type: $event } : {})"
          />
          <template #footer
            ><AppButton link @click="inventory()">库存明细<IconArrowRight :size="16" /></AppButton
          ></template>
        </DashboardCard>
        <DashboardCard
          title="质量问题"
          :subtitle="`近 ${days} 天发现 · 本班组涉及`"
          help="只统计当前账号可见、涉及本班组的问题。复检不重复计数，处理状态以当前状态为准。"
        >
          <template #actions
            ><WatermelonSegmented
              v-model="days"
              label="质量统计周期"
              :options="[
                { value: '7', label: '7天' },
                { value: '30', label: '30天' },
                { value: '90', label: '90天' },
              ]"
          /></template>
          <StatePanel
            v-if="qualityError || !quality"
            :state="qualityError ? 'error' : 'loading'"
            :title="qualityError || '正在读取质量数据'"
            @retry="loadQuality"
          />
          <DashboardDonut
            v-else
            :rows="qualityRows"
            unit="条"
            label="质量问题处理状态"
            motion
            selectable
            @select="openQuality"
          />
          <template #footer
            ><AppButton link @click="openQuality()">质量反馈<IconArrowRight :size="16" /></AppButton
          ></template>
        </DashboardCard>
      </div>
    </template>
  </section>
</template>

<style scoped>
.team-dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding-bottom: 20px;
}
.team-dashboard-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.team-dashboard-charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: 16px;
}
.team-dashboard-charts--warehouse {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.team-dashboard-charts :deep(.dashboard-card__header) {
  flex-wrap: wrap;
}
.team-dashboard-charts :deep(.state-panel) {
  min-height: 230px;
}
@media (max-width: 1400px) {
  .team-dashboard-charts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .team-dashboard-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .team-dashboard-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup lang="ts">
import { formatAmount as format } from '@/utils/format'

import { computed } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import LedgerChart from './LedgerChart.vue'
import DashboardCard from './DashboardCard.vue'
import DashboardDistribution from './DashboardDistribution.vue'
import {
  useDashboardChart,
  dashboardBar,
  dashboardLine,
  dashboardColors,
} from '@/composables/useDashboardChart'
import { materialTypeLabel, materialTypeOptions } from '@/types/materialTransfer'
import type { Metric } from '@/types/materialAnalytics'
import type { FactoryOverview, FactoryTeam, FactoryScene } from '@/types/factoryOverview'

const props = withDefaults(
  defineProps<{ data: FactoryOverview; metric: Metric; scene?: FactoryScene; motion?: boolean }>(),
  { scene: 'overview', motion: true },
)
const emit = defineEmits<{ team: [team: FactoryTeam] }>()
const unit = computed(() => (props.metric === 'weight' ? 'kg' : '件'))
const colors = computed(() => [
  dashboardColors.primary,
  dashboardColors.secondary,
  dashboardColors.warning,
  dashboardColors.danger,
])
const { palette, plot: basePlot } = useDashboardChart()
const natureColors = [
  dashboardColors.primary,
  dashboardColors.secondary,
  dashboardColors.success,
  dashboardColors.warning,
  '#c18ace',
  dashboardColors.danger,
  dashboardColors.neutral,
  '#9b976f',
  '#56a8b9',
]
const natureOrder = (key: string) => {
  const index = materialTypeOptions.findIndex((option) => option.value === key)
  return index < 0 ? materialTypeOptions.length : index
}
const materialTypes = computed(() =>
  props.data.material_types
    .filter((row) => row.quantity !== 0 || row.weight !== 0)
    .sort((a, b) => natureOrder(a.key) - natureOrder(b.key))
    .map((row) => ({
      ...row,
      name: row.key === 'unknown' ? '未填写性质' : materialTypeLabel(row.key),
      color: natureColors[natureOrder(row.key) % natureColors.length]!,
    })),
)
function plot(
  labels: string[],
  series: object[],
  horizontal = false,
  legend = true,
): EChartsCoreOption {
  return basePlot(labels, series, unit.value, horizontal, false, legend)
}
const distribution = computed(() =>
  materialTypes.value.map((row) => ({
    key: row.key,
    label: row.name,
    value: row[props.metric],
    color: row.color,
  })),
)
const cards = computed(() => {
  const d = props.data,
    metric = props.metric
  const labels = d.trend.map((row) => row.key.slice(5))
  const bar = (
    name: string,
    data: (number | null)[],
    stack?: string,
    color = colors.value[0]!,
  ) => ({
    ...dashboardBar(name, data, color),
    stack,
  })
  const line = dashboardLine
  const rank = (key: 'material' | 'serial', title: string) => {
    const rows = d[`${key}_ranking`]?.[metric] || []
    const option = plot(
      rows.map((row) => row.key),
      [
        {
          ...bar(
            '未转出库存',
            rows.map((row) => row[metric]),
          ),
          barMaxWidth: 12,
          showBackground: true,
          backgroundStyle: { color: palette.value?.mutedSurface || '#205c4808', borderRadius: 4 },
          itemStyle: {
            borderRadius: 4,
            color: ({ dataIndex }: { dataIndex: number }) =>
              dataIndex === 0 ? dashboardColors.primary : '#a2b5f5',
          },
          label: {
            show: true,
            position: 'right',
            distance: 10,
            color: palette.value?.text || '#354d3e',
            fontSize: 13,
            fontWeight: 500,
            formatter: ({ value }: { value: number }) => format(value),
          },
        },
      ],
      true,
      false,
    )
    option.grid = {
      left: 8,
      right: 84,
      top: 4,
      bottom: 4,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    }
    option.xAxis = { type: 'value', show: false }
    return { key: `${key}s`, title, hint: '全厂未转出库存 · 前8项', empty: !rows.length, option }
  }
  const all = [
    {
      key: 'teams',
      title: '班组库存分布',
      hint: '未转出库存 · 点击查看班组',
      empty: !d.teams.some(
        (team) => team.balance && (team.balance[`on_hand_${metric}`] || 0) !== 0,
      ),
      option: plot(
        d.teams.map(
          (team) => team.name + (!team.balance ? '（未配置）' : !team.active ? '（停用）' : ''),
        ),
        [
          bar(
            '未转出库存',
            d.teams.map((team) => team.balance?.[`on_hand_${metric}`] ?? null),
          ),
        ],
        true,
        false,
      ),
    },
    {
      key: 'flow',
      title: '全厂对外收发',
      hint: `近${d.days}天 · 内部转料不计入`,
      empty: !d.trend.some(
        (row) => row.inbound[metric] || row.outbound[metric] || row.shipment[metric],
      ),
      option: plot(labels, [
        line(
          '库房入库',
          d.trend.map((row) => row.inbound[metric]),
          colors.value[0]!,
        ),
        line(
          '库房对外出库',
          d.trend.map((row) => row.outbound[metric]),
          colors.value[1]!,
        ),
        line(
          '检验发货',
          d.trend.map((row) => row.shipment[metric]),
          colors.value[2]!,
        ),
      ]),
    },
    {
      key: 'types',
      title: '物料类型分布',
      hint: '未转出库存构成',
      empty: !materialTypes.value.some((row) => row[metric] > 0),
      option: {},
    },
    {
      key: 'waiting',
      title: '待交接时长',
      hint: '每笔转料只统计一次',
      empty: !d.waiting_age.some((row) => row.internal[metric] || row.external[metric]),
      option: plot(
        ['<1天', '1–3天', '3–7天', '≥7天'],
        [
          bar(
            '内部待签收',
            d.waiting_age.map((row) => row.internal[metric]),
            'waiting',
          ),
          bar(
            '对外待确认',
            d.waiting_age.map((row) => row.external[metric]),
            'waiting',
            colors.value[1],
          ),
        ],
      ),
    },
    {
      key: 'loss',
      title: '丢失趋势',
      hint: `近${d.days}天 ${format(d.period_totals.loss[metric])} ${unit.value} · 不含转废`,
      empty: !d.trend.some((row) => row.loss[metric] > 0),
      option: plot(
        labels,
        [
          line(
            '丢失',
            d.trend.map((row) => row.loss[metric]),
            colors.value[3]!,
          ),
        ],
        false,
        false,
      ),
    },
    rank('serial', '流水号库存排行'),
    rank('material', '材质库存排行'),
    {
      key: 'outbound',
      title: '对外出库与发货',
      hint: `近${d.days}天 · 仅已确认`,
      empty: !(d.period_totals.outbound[metric] || d.period_totals.shipment[metric]),
      option: plot(
        ['库房对外出库', '检验发货'],
        [bar('已确认', [d.period_totals.outbound[metric], d.period_totals.shipment[metric]])],
        false,
        false,
      ),
    },
  ]
  all.push({
    key: 'age',
    title: '库存滞留',
    hint: '从本班组接收时刻起算，加工和拆批不重新计时。',
    empty: !d.stock_age.some((row) => row[metric]),
    option: plot(
      d.stock_age.map((row) => row.label || row.key),
      [
        bar(
          '在库',
          d.stock_age.map((row) => row[metric]),
        ),
      ],
      false,
      false,
    ),
  })
  const keys = {
    all: ['teams', 'age', 'waiting', 'types', 'serials', 'materials'],
    overview: ['teams', 'flow', 'types'],
    stock: ['serials', 'materials'],
    handoff: ['waiting', 'loss', 'outbound'],
  }[props.scene]
  return keys.map((key) => all.find((card) => card.key === key)!)
})
function pick(key: string, index: number) {
  const team = props.data.teams[index]
  if (key === 'teams' && team?.id && team.active) emit('team', team)
}
</script>
<template>
  <section class="factory-charts" :data-scene="scene" aria-label="全厂物料分析">
    <DashboardCard
      v-for="card in cards"
      :key="card.key"
      class="factory-chart"
      :class="`factory-chart--${card.key}`"
      :title="card.title"
      :help="card.hint"
    >
      <template #actions
        ><span class="chart-unit">{{ unit }}</span></template
      >
      <DashboardDistribution
        v-if="card.key === 'types'"
        :rows="distribution"
        :unit="unit"
        label="物料类型库存明细"
        :motion="motion"
      />
      <div v-else class="factory-chart-content">
        <LedgerChart
          :option="card.option"
          :empty="card.empty"
          :label="`${card.title}，单位${unit}`"
          smooth-update
          :motion="motion"
          :enter-duration="800"
          :update-duration="400"
          @select="pick(card.key, $event.dataIndex)"
        />
      </div>
    </DashboardCard>
  </section>
</template>
<style scoped>
.factory-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  min-width: 0;
}
.factory-chart-content {
  display: flex;
  min-width: 0;
  height: 260px;
  gap: 16px;
}
.factory-chart-content > .ledger-chart-frame {
  min-width: 0;
  flex: 1;
}
.chart-unit {
  font-size: 12px;
  color: var(--wm-muted);
}
@media (max-width: 1000px) {
  .factory-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

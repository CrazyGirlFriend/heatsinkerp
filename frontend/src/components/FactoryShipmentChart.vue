<script setup lang="ts">
import { computed } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import LedgerChart from './LedgerChart.vue'
import type { Shipments } from '@/types/factoryDashboard'
import { shipmentColors } from '@/utils/factoryDashboard'
const props = defineProps<{ data: Shipments; expanded?: boolean }>()
const lineColors = computed(() => shipmentColors(props.data.series.map((row) => row.serial_no)))
const option = computed<EChartsCoreOption>(() => ({
  animationEasing: 'cubicInOut',
  animationEasingUpdate: 'cubicOut',
  textStyle: { fontFamily: 'Inter, PingFang SC, sans-serif' },
  tooltip: {
    trigger: 'axis',
    confine: true,
    backgroundColor: 'rgba(255,255,255,.98)',
    borderColor: '#e1e9e3',
    padding: [12, 16],
    textStyle: { color: '#304738', fontSize: 12 },
    extraCssText: 'border-radius:10px;box-shadow:0 10px 35px rgba(35,60,44,.12)',
    valueFormatter: (v: unknown) => (v === null ? '未创建' : `${v} 件`),
    axisPointer: { lineStyle: { color: '#b7cbbc', type: 'dashed' } },
  },
  grid: {
    left: props.expanded ? 54 : 38,
    right: props.expanded ? 30 : 15,
    top: 32,
    bottom: props.expanded ? 65 : 30,
  },
  xAxis: {
    type: 'category',
    data: props.data.dates,
    boundaryGap: false,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#e4ece6' } },
    axisLabel: {
      color: '#718377',
      fontSize: props.expanded ? 12 : 10,
      formatter: (d: string) => d.slice(5).replace('-', '/'),
    },
  },
  yAxis: {
    type: 'value',
    min: 0,
    minInterval: 1,
    name: '件 / 天',
    splitNumber: 4,
    nameTextStyle: { fontSize: 10, color: '#7b8b80', align: 'right' },
    axisLabel: { color: '#7b8b80', fontSize: 11 },
    splitLine: { lineStyle: { color: '#eaf0ec', type: [3, 5] } },
  },
  ...(props.expanded
    ? {
        dataZoom: [
          { id: 'inside', type: 'inside', filterMode: 'none' },
          {
            id: 'slider',
            type: 'slider',
            filterMode: 'none',
            height: 17,
            bottom: 8,
            left: 54,
            right: 30,
            borderColor: 'transparent',
            backgroundColor: '#f3f7f4',
            fillerColor: 'rgba(115,161,129,.10)',
            handleStyle: { color: '#fff', borderColor: '#9bbca6' },
            moveHandleStyle: { color: '#b1c8b8' },
            dataBackground: { lineStyle: { color: '#cad9ce' }, areaStyle: { color: '#eef4ef' } },
            selectedDataBackground: {
              lineStyle: { color: '#93b09d' },
              areaStyle: { color: '#dceadd' },
            },
          },
        ],
      }
    : {}),
  series: props.data.series.map((row, index) => ({
    id: row.serial_no,
    name: row.serial_no,
    type: 'line',
    data: row.values,
    smooth: 0.18,
    connectNulls: false,
    showSymbol: props.data.dates.length <= 14,
    symbol: 'emptyCircle',
    symbolSize: 4.5,
    animationDelay: Math.min(index, 5) * 55,
    animationDelayUpdate: 0,
    itemStyle: { color: lineColors.value[row.serial_no], borderWidth: 1.7 },
    lineStyle: { color: lineColors.value[row.serial_no], width: 2.5, cap: 'round', join: 'round' },
    emphasis: { focus: 'series', scale: 1.6, lineStyle: { width: 3 } },
  })),
}))
</script>
<template>
  <LedgerChart
    :key="data.dates.join('|')"
    :option="option"
    :empty="!data.series.length"
    label="流水号每日确认发货件数折线图"
    smooth-update
    :enter-duration="1000"
    :update-duration="280"
  />
</template>

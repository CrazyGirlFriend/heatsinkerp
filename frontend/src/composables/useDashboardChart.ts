import { computed } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import { useChartPalette } from './useChartPalette'
import { formatAmount } from '@/utils/format'

// Shared by the four factory sections; business series and units stay with each report.
export const dashboardColors = {
  primary: '#6285ed',
  secondary: '#9a83df',
  success: '#36a58a',
  warning: '#e6a447',
  danger: '#db717a',
  neutral: '#94a3b8',
}

export function dashboardBar(name: string, data: (number | null)[], color: string) {
  return {
    name,
    type: 'bar',
    data,
    barMaxWidth: 18,
    barGap: '35%',
    itemStyle: { color, borderRadius: 4 },
    emphasis: { focus: 'series' },
  }
}

export function dashboardLine(name: string, data: (number | null)[], color: string, area = true) {
  return {
    name,
    type: 'line',
    data,
    connectNulls: false,
    showSymbol: true,
    symbol: 'circle',
    symbolSize: data.length > 60 ? 3 : 5,
    itemStyle: { color },
    lineStyle: { color, width: 2.5 },
    emphasis: { focus: 'series', scale: 1.5 },
    ...(area
      ? {
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}30` },
                { offset: 1, color: `${color}03` },
              ],
            },
          },
        }
      : {}),
  }
}

export function useDashboardChart() {
  const palette = useChartPalette()
  const tooltip = computed(() => ({
    className: 'dashboard-chart-tooltip',
    trigger: 'axis',
    confine: true,
    backgroundColor: palette.value?.surface || '#fff',
    borderColor: palette.value?.border || '#e4e4e7',
    borderWidth: 1,
    padding: [12, 16],
    textStyle: { color: palette.value?.text || '#18181b', fontSize: 12 },
    extraCssText: 'border-radius:12px;box-shadow:0 8px 28px #00000014;',
    axisPointer: { type: 'line', lineStyle: { color: dashboardColors.primary, type: 'dashed' } },
  }))
  function plot(
    names: string[],
    series: object[],
    unit: string,
    horizontal = false,
    percentage = false,
    legend = true,
  ): EChartsCoreOption {
    const category = {
      type: 'category',
      data: names,
      inverse: horizontal,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: palette.value?.muted || '#71717a',
        fontSize: 12,
        hideOverlap: true,
        margin: 14,
        formatter: (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value),
        ...(horizontal ? { width: 108, overflow: 'truncate' } : {}),
      },
    }
    const numeric = {
      type: 'value',
      ...(percentage ? { min: 0, max: 100 } : {}),
      splitNumber: 4,
      ...(['件', '件次', '条'].includes(unit) ? { minInterval: 1 } : {}),
      axisLabel: { color: palette.value?.muted || '#71717a', fontSize: 12 },
      splitLine: {
        lineStyle: { color: palette.value?.border || '#e4e4e7', type: 'dashed', opacity: 0.65 },
      },
    }
    return {
      textStyle: {
        fontFamily: 'HeatSink Inter, PingFang SC, Microsoft YaHei, sans-serif',
        fontSize: 12,
      },
      tooltip: {
        ...tooltip.value,
        valueFormatter: (value: number | null) =>
          value == null ? '—' : `${formatAmount(value)} ${unit}`,
      },
      legend: {
        show: legend,
        type: 'scroll',
        top: 0,
        right: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 20,
        textStyle: { color: palette.value?.muted || '#71717a', fontSize: 12 },
      },
      grid: {
        top: legend ? 42 : 12,
        right: percentage ? 44 : 18,
        bottom: 8,
        left: 8,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      xAxis: horizontal ? numeric : category,
      yAxis: horizontal ? category : numeric,
      ...(horizontal && names.length > 8
        ? {
            dataZoom: [
              {
                type: 'slider',
                yAxisIndex: 0,
                startValue: 0,
                endValue: 7,
                width: 8,
                right: 0,
                showDetail: false,
              },
            ],
          }
        : {}),
      series,
    }
  }
  return { palette, tooltip, plot }
}

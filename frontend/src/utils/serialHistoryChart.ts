import type { EChartsOption, LineSeriesOption } from 'echarts'
import type { SerialHistoryEvent, SerialHistoryGroup } from '@/types/teamBusiness'
import { formatDateTime } from './format'

export const historyKindNames = { incoming: '接收入库', opening: '期初入库', outgoing: '转出', adjusted: '出库修改', voided: '作废退回', loss: '丢失' }
export const historyNumber = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
export function purposePalette(names: string[]) {
  const palette = ['#4875c7', '#8660be', '#27918a', '#b07a29', '#bd5781', '#4c8399', '#708339', '#ac6848']
  const colors = new Map<string, string>(), used = new Set<number>()
  for (const name of [...new Set(names)].sort()) {
    const hash = Array.from(name).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0)
    let index = hash % palette.length
    while (used.size < palette.length && used.has(index)) index = (index + 1) % palette.length
    colors.set(name, used.size < palette.length ? palette[index]! : `hsl(${hash % 360}, 52%, 43%)`)
    used.add(index)
  }
  return colors
}

export function purposeColors(groups: SerialHistoryGroup[]) {
  const palette = purposePalette(groups.map(group => group.name))
  return new Map(groups.map(group => [group.key, palette.get(group.name)!]))
}

export function historyTimeline(groups: SerialHistoryGroup[]) {
  // Shared event slots preserve every same-second event without inventing times.
  return groups.flatMap(group => group.events.map(event => ({ groupKey: group.key, event })))
    .sort((a, b) => a.event.at.localeCompare(b.event.at)
      || Number(!['incoming', 'opening'].includes(a.event.kind)) - Number(!['incoming', 'opening'].includes(b.event.kind))
      || Number(a.event.id.split('-').at(-1)) - Number(b.event.id.split('-').at(-1))
      || a.groupKey.localeCompare(b.groupKey))
}

export function historyEventAt(groups: SerialHistoryGroup[], seriesIndex: number, dataIndex: number): SerialHistoryEvent | undefined {
  const point = historyTimeline(groups)[dataIndex - 1]
  return point?.groupKey === groups[seriesIndex]?.key ? point.event : undefined
}

export function serialHistoryChart(groups: SerialHistoryGroup[], metric: 'quantity' | 'weight', focus = ''): EChartsOption {
  const timeline = historyTimeline(groups), colors = purposeColors(groups)
  const labels = ['区间起点', ...timeline.map(({ event }) => formatDateTime(event.at))]
  const unit = metric === 'quantity' ? '件' : 'kg'
  const series: LineSeriesOption[] = groups.map((group, index) => {
    let balance = group[`baseline_${metric}`]
    const color = colors.get(group.key)!, muted = Boolean(focus && focus !== group.key)
    const data = [{ value: balance, symbolSize: 0 }, ...timeline.map(point => {
      const own = point.groupKey === group.key
      if (own) balance = point.event[`balance_${metric}`]
      return { value: balance, symbolSize: own ? 8 : 0, symbol: own && point.event.kind === 'loss' ? 'diamond' : 'circle' }
    })]
    return {
      id: group.key, name: group.name, type: 'line', step: 'end', data,
      showSymbol: true, clip: true, z: muted ? 1 : 3,
      animationDelay: Math.min(index * 100, 400), animationEasing: 'cubicOut',
      lineStyle: { color, width: 2.5, opacity: muted ? .12 : 1 },
      itemStyle: { color: '#fff', borderColor: color, borderWidth: 2, opacity: muted ? .15 : 1 },
      areaStyle: { color, opacity: muted ? 0 : .045 },
      emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
      endLabel: { show: !muted, color, fontSize: 13, formatter: params => `${group.name}  ${historyNumber(Number(params.value))}` },
      labelLayout: { moveOverlap: 'shiftY' },
    }
  })
  return {
    backgroundColor: 'transparent', textStyle: { fontFamily: 'Inter, "PingFang SC", sans-serif' },
    grid: { left: 66, right: 140, top: 30, bottom: 84 },
    tooltip: {
      trigger: 'axis', confine: true, renderMode: 'richText', backgroundColor: '#fff', borderColor: '#dce3ee',
      textStyle: { color: '#34445d', fontSize: 14 }, padding: 14,
      formatter: (raw: unknown) => {
        const params = raw as Array<{ dataIndex: number; seriesIndex: number; value: number }>
        const index = params[0]?.dataIndex ?? 0, event = timeline[index - 1]?.event
        const values = params.filter(point => !focus || groups[point.seriesIndex]?.key === focus)
          .map(point => `${groups[point.seriesIndex]?.name}  ${historyNumber(Number(point.value))} ${unit}`)
        return [labels[index], ...values, ...(event ? [
          `${historyKindNames[event.kind]}  ${event.delta_quantity > 0 ? '+' : ''}${historyNumber(event.delta_quantity)} 件 / ${event.delta_weight > 0 ? '+' : ''}${historyNumber(event.delta_weight)} kg`,
          event.batch_no, '点击节点查看批次',
        ] : [])].join('\n')
      },
      axisPointer: { type: 'line', lineStyle: { color: '#8c9cb3', type: 'dashed' } },
    },
    xAxis: { type: 'category', boundaryGap: false, data: labels, axisTick: { show: false },
      axisLine: { lineStyle: { color: '#dce3ee' } },
      axisLabel: { color: '#76859c', fontSize: 13, margin: 16, hideOverlap: true,
        formatter: (value: string) => value === '区间起点' ? value : value.slice(5).replace(' ', '\n') } },
    yAxis: { type: 'value', name: unit, minInterval: metric === 'quantity' ? 1 : undefined,
      nameTextStyle: { color: '#76859c', padding: [0, 20, 4, 0] },
      axisLabel: { color: '#76859c', formatter: (value: number) => historyNumber(value) },
      splitLine: { lineStyle: { color: '#e7ecf3', type: 'dashed' } } },
    dataZoom: [{ type: 'inside', filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false },
      { type: 'slider', filterMode: 'none', bottom: 4, height: 22, borderColor: '#dce3ee',
        backgroundColor: '#f7f9fc', fillerColor: 'rgba(107,126,181,.1)',
        dataBackground: { lineStyle: { color: '#97a7c1' }, areaStyle: { color: '#dce3ee' } },
        handleStyle: { color: '#aab6cd', borderColor: '#aab6cd' }, textStyle: { color: '#76859c' }, showDetail: false }],
    series,
  }
}

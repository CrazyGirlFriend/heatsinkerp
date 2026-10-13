import type { TooltipComponentOption } from 'echarts'

export const glassTooltip = {
  backgroundColor: '#fffffff2',
  borderColor: '#ffffff',
  borderWidth: 1,
  borderRadius: 12,
  padding: [10, 14],
  shadowBlur: 20,
  shadowOffsetY: 6,
  shadowColor: '#203b2e1f',
  textStyle: { color: '#28332d', fontSize: 12 },
  extraCssText:
    'backdrop-filter:blur(16px) saturate(115%);-webkit-backdrop-filter:blur(16px) saturate(115%);box-shadow:0 8px 28px #203b2e1f,inset 0 1px 0 #fff;font-variant-numeric:tabular-nums;',
} satisfies TooltipComponentOption

// Keep the series hue and scale intact; only the surface catches light.
export function glassFill(color: string, horizontal = false) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: horizontal ? 0 : 1,
    y2: horizontal ? 1 : 0,
    colorStops: [
      { offset: 0, color: `${color}70` },
      { offset: 0.5, color: `${color}bc` },
      { offset: 1, color: `${color}f2` },
    ],
  }
}

export function glassArea(color: string) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `${color}24` },
      { offset: 1, color: `${color}00` },
    ],
  }
}

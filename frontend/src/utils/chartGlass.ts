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

export const dashboardNumber = (value: number | null | undefined, digits = 1) =>
  value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })

export const dashboardColors = [
  '#4f8863',
  '#7e9fb4',
  '#b39c5e',
  '#9b86af',
  '#bd8975',
  '#679e99',
  '#91a165',
  '#577e92',
  '#c09ab2',
  '#8c9084',
  '#a8ad7d',
  '#788eb3',
]
export function shipmentColor(serial: string): string {
  let hash = 0
  for (const char of serial) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return dashboardColors[hash % dashboardColors.length]!
}
// Resolve palette collisions within the current comparison, retaining the same
// serial color across its chart, legend and selection row.
export function shipmentColors(serials: string[]): Record<string, string> {
  const colors: Record<string, string> = {}
  const used = new Set<string>()
  for (const serial of serials) {
    let color = shipmentColor(serial)
    if (used.has(color)) color = dashboardColors.find((candidate) => !used.has(candidate)) || color
    colors[serial] = color
    used.add(color)
  }
  return colors
}
export const dashboardNumber = (value: number | null | undefined, digits = 1) =>
  value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
export const yieldStatus = (status?: string) =>
  status === 'complete' ? '已完结' : status === 'needs_review' ? '投入待核对' : '进行中'
export const deliveryStatus = (status: string) =>
  ({ on_time: '按期完成', late_complete: '逾期完成', overdue: '已超期', pending: '待交付' })[
    status
  ] || status
export function offsetDate(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function scheduleTimestamp(value?: string | null) {
  if (!value) return null
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`)
  return Number.isFinite(timestamp) ? timestamp : null
}

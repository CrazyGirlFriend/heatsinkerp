export function validProcessingMinutes(value: number | null | undefined) {
  return value == null || (Number.isSafeInteger(value) && value > 0 && value <= 2147483647)
}

export function formatProcessingMinutes(value: number | null | undefined) {
  if (value == null) return '—'
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${hours ? `${hours} 小时` : ''}${hours && minutes ? ' ' : ''}${minutes || !hours ? `${minutes} 分钟` : ''}`
}

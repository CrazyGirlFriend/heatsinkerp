import type { MaterialTransfer, SludgeMeasurement } from '@/types/materialTransfer'

export function sludgeWeight(gross?: number | null, percent?: number | null): number | undefined {
  if (gross == null || percent == null || !Number.isFinite(gross) || !Number.isFinite(percent) || gross <= 0 || gross > 99999999999.999 || percent <= 0 || percent > 100) return undefined
  const grams = Math.round(gross * 1000), hundredths = Math.round(percent * 100)
  if (Math.abs(gross * 1000 - grams) > .0001 || Math.abs(percent * 100 - hundredths) > .0001) return undefined
  return Number((BigInt(grams) * BigInt(hundredths) + 5000n) / 10000n) / 1000
}

export function sludgePayload(type: string | null | undefined, gross?: number | null, percent?: number | null): SludgeMeasurement {
  return type === 'sludge' ? { sludge_gross_weight: gross ?? null, sludge_content_percent: percent ?? null } : { sludge_gross_weight: null, sludge_content_percent: null }
}

export function sludgeFields(transfer: MaterialTransfer) {
  if (transfer.material_type !== 'sludge') return []
  return [
    { label: '废泥实重', value: transfer.sludge_gross_weight == null ? '未记录' : `${transfer.sludge_gross_weight} kg` },
    { label: '有效材料占比', value: transfer.sludge_content_percent == null ? '未记录，沿用历史账重' : `${transfer.sludge_content_percent}%` },
  ]
}
export function sludgeSummary(transfer: MaterialTransfer): string {
  return transfer.material_type === 'sludge' ? [...sludgeFields(transfer).map(field => `${field.label}：${field.value}`), `${transfer.sludge_content_percent == null ? '历史账重' : '折算重量'}：${transfer.weight} kg`].join('；') : ''
}

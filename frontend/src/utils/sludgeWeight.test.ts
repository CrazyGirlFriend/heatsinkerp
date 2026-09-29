import { describe, expect, it } from 'vitest'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { sludgeFields, sludgePayload, sludgeSummary, sludgeWeight } from './sludgeWeight'

describe('sludge accounting weight', () => {
  it('uses material percentage, with the same decimal rounding as the backend', () => {
    expect(sludgeWeight(10, 30)).toBe(3)
    expect(sludgeWeight(1.005, 10)).toBe(.101)
    expect(sludgeWeight(12.345, 33.33)).toBe(4.115)
    expect(sludgeWeight(99999999999.999, 100)).toBe(99999999999.999)
    expect(sludgeWeight(.001, 1)).toBe(0)
  })
  it.each([[null, 30], [10, null], [0, 30], [10, 0], [10, 101], [1.0001, 30], [10, 3.333], [Infinity, 100]])('rejects invalid measurement %s / %s', (gross, percent) => {
    expect(sludgeWeight(gross, percent)).toBeUndefined()
  })
  it('does not invent missing historical measurements or percentages', () => {
    const legacy = normalizeMaterialTransfer({ material_type: 'sludge', weight: 3 })
    expect(sludgeFields(legacy)).toEqual([{ label: '废泥实重', value: '未记录' }, { label: '有效材料占比', value: '未记录，沿用历史账重' }])
    expect(sludgeSummary(legacy)).toContain('历史账重：3 kg')
    expect(sludgeSummary(normalizeMaterialTransfer({ ...legacy, sludge_gross_weight: 10, sludge_content_percent: 30 }))).toContain('有效材料占比：30%；折算重量：3 kg')
    expect(sludgePayload('semi_finished', 10, 30)).toEqual({ sludge_gross_weight: null, sludge_content_percent: null })
  })
})

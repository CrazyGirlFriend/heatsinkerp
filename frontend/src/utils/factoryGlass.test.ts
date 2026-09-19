import { describe, expect, it } from 'vitest'
import { glassLinks, inventoryReconciles, stockTypes, sumAmounts } from './factoryGlass'
import { liveFixture } from '@/testFixtures/factoryLive'

describe('live glass dashboard data', () => {
  it('uses every actual directional pair, including reverse and multiple incoming/outgoing links', () => {
    const report = liveFixture(), links = glassLinks(report)
    expect(links.map(link => link.key)).toEqual(['1:2', '1:3', '2:1', '8:3'])
    expect(links[0]!.curve).not.toEqual([...links[2]!.curve].reverse())
    report.links = []
    expect(glassLinks(report)).toEqual([])
  })
  it('connects any configured pair rather than the fourteen design fixture routes', () => {
    const report = liveFixture()
    report.links = [{ source_id: 6, target_id: 1, pending_batches: 1, confirmed_batches: 0, pending_quantity: 0, pending_weight: .001 }]
    const [link] = glassLinks(report)
    expect(link!.source.name).toBe('雕刻'); expect(link!.target.name).toBe('库房')
    expect(link!.pending_quantity).toBe(0); expect(link!.pending_weight).toBe(.001)
    expect(link!.curve.flat().every(Number.isFinite)).toBe(true)
  })
  it('retains unknown categories and positive-weight zero-piece stock without rounding it away', () => {
    const rows = stockTypes([{ key: 'sludge', quantity: 0, weight: .125 }, { key: 'unknown', quantity: 7, weight: .001 }])
    expect(rows.find(row => row.key === 'unknown')).toMatchObject({ label: '未分类', quantity: 7, weight: .001 })
    expect(rows.find(row => row.key === 'sludge')!.weight).toBe(.125)
    expect(sumAmounts(rows)).toEqual({ quantity: 7, weight: .126 })
  })
  it('checks team, global and per-category balances instead of displaying an unconditional success mark', () => {
    const report = liveFixture()
    expect(inventoryReconciles(report)).toBe(true)
    report.teams[0]!.material_types[0]!.weight += .001
    expect(inventoryReconciles(report)).toBe(false)
  })
})

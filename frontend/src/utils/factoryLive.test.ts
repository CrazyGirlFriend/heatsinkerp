import { describe, it, expect } from 'vitest'
import { factoryFixture } from '@/testFixtures/factoryOverview'
import { liveLook, liveMaterial, liveParties, liveBatchStatus, liveWaiting, liveWindow } from './factoryLive'
import type { LiveBatch, LiveTeam } from '@/types/factoryLive'
const teams: LiveTeam[] = factoryFixture().teams.map(t => ({ ...t, incoming: 0, outgoing: 0 }))
describe('material playback semantics', () => {
  it('looks toward actual teams, without inventing an external team', () => {
    expect(teams.map(t => liveLook(t.id, teams))).toEqual(['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right'])
    expect(liveLook(null, teams)).toBe('center')
    expect(liveLook(99, teams)).toBe('center')
  })
  it('rotates a unique eight-row window across the end, including short/empty feeds', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ batch_no: String(i) } as LiveBatch))
    expect(liveWindow(rows, 19).map(r => r.batch_no)).toEqual(['19', '0', '1', '2', '3', '4', '5', '6'])
    expect(liveWindow(rows.slice(0, 3), 2).map(r => r.batch_no)).toEqual(['2', '0', '1'])
    expect(liveWindow([], 8)).toEqual([])
  })
  it('summarizes multiple materials honestly', () => {
    expect(liveMaterial({ material_count: 2, material_name: null } as LiveBatch)).toBe('多材质（2种）')
    expect(liveMaterial({ material_count: 1, material_name: '铜钼' } as LiveBatch)).toBe('铜钼')
  })
  it('uses the oldest pending timestamp, not updated time, for waiting', () => {
    const row = { status: 'partial', waiting_since: '2026-09-12T01:00:00Z' } as LiveBatch
    expect(liveWaiting(row, Date.parse('2026-09-12T01:08:00Z'))).toBe('8分钟')
    expect(liveWaiting(row, Date.parse('2026-09-13T03:00:00Z'))).toBe('1天2小时')
    expect(liveWaiting({ ...row, status: 'received' }, Date.now())).toBe('—')
    expect(liveWaiting({ ...row, waiting_since: null }, Date.now())).toBe('—')
  })
  it('uses truthful external captions and does not label voided receipts as received', () => {
    const row = { entry_kind: 'inspection_shipment', source_name: '检验', target_name: null, external_destination: '客户甲', status: 'pending' } as LiveBatch
    expect(liveParties(row)).toEqual({ source: '检验', target: '客户甲' })
    expect(liveBatchStatus({ ...row, entry_kind: 'warehouse_receipt', status: 'voided' })).not.toBe('已入库')
  })
})

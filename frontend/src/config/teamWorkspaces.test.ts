import { describe, expect, it } from 'vitest'
import { configuredTeamWorkspaces, resolveTeamWorkspaceSection, teamWorkspaceProfiles, teamWorkspaceSectionPath, teamWorkspaceSectionsFor } from './teamWorkspaces'

describe('eight official workspace profiles', () => {
  it('maps stable codes to actual database ids without substituting same-name demo teams', () => {
    const entries = configuredTeamWorkspaces([
      { id: 914, code: 'FACTORY-ROLL', name: '旧扎板名称', active: true, sort_order: 99 },
      { id: 2, code: 'DEMO', name: '退火', active: true },
      { id: 800, code: 'FACTORY-ANNEAL', name: '退火', active: false },
      { id: 900, code: 'FACTORY-QC', name: '检验', active: true, sort_order: 0 },
    ])
    expect(entries.map(entry => entry.profile.name)).toEqual(['库房', '轧制', '退火', '研磨', '线切割', '雕刻', '电镀', '检验'])
    expect(entries[1]!.team?.id).toBe(914)
    expect(entries[2]!.team).toBeUndefined()
    expect(entries[7]!.team?.id).toBe(900)
    expect(teamWorkspaceProfiles.some(profile => ['FACTORY-SHIP', 'FACTORY-SCRAP'].includes(profile.code))).toBe(false)
  })
})

describe('shared workspace navigation', () => {
  it('keeps six workshop entries and the extra warehouse receipt entry', () => {
    expect(teamWorkspaceSectionsFor(false).map(item => item.label)).toEqual(['库存明细', '待接收', '出库记录', '丢失记录', '材质归类', '收发历史'])
    expect(teamWorkspaceSectionsFor(true).map(item => item.value)).toContain('receipts')
    expect(teamWorkspaceSectionPath(7, 'stock')).toBe('/team-workspaces/7')
    expect(teamWorkspaceSectionPath(7, 'pending')).toBe('/team-workspaces/7?tab=pending')
  })
  it('uses the same selected section for legacy links, filters and unsupported tabs', () => {
    expect(resolveTeamWorkspaceSection({ tab: 'overview' }, false)).toBe('history')
    expect(resolveTeamWorkspaceSection({ tab: 'serials' }, false)).toBe('stock')
    expect(resolveTeamWorkspaceSection({ tab: 'receipts' }, false)).toBe('stock')
    expect(resolveTeamWorkspaceSection({ tab: 'receipts' }, true)).toBe('receipts')
    expect(resolveTeamWorkspaceSection({ direction: 'incoming' }, false)).toBe('pending')
    expect(resolveTeamWorkspaceSection({ direction: 'incoming', status: 'received' }, false)).toBe('stock')
    expect(resolveTeamWorkspaceSection({ direction: 'outgoing' }, false)).toBe('outgoing')
    expect(resolveTeamWorkspaceSection({ tab: ['stock', 'pending'] }, false)).toBe('stock')
  })
})

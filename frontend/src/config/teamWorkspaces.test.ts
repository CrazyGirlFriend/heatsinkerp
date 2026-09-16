import { describe, expect, it } from 'vitest'
import { configuredTeamWorkspaces, teamWorkspaceProfiles } from './teamWorkspaces'

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

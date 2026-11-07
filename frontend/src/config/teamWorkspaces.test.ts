import { describe, expect, it } from 'vitest'
import {
  configuredTeamWorkspaces,
  resolveTeamWorkspaceSection,
  teamWorkspaceProfiles,
  teamWorkspaceSectionPath,
  teamWorkspaceSectionsFor,
  teamCanReallocate,
  teamWorkspaceModulesFor,
  teamWorkspaceModuleFor,
} from './teamWorkspaces'

describe('eight official workspace profiles', () => {
  it('maps stable codes to actual database ids without substituting same-name demo teams', () => {
    const entries = configuredTeamWorkspaces([
      { id: 914, code: 'FACTORY-ROLL', name: '旧扎板名称', active: true, sort_order: 99 },
      { id: 2, code: 'DEMO', name: '退火', active: true },
      { id: 800, code: 'FACTORY-ANNEAL', name: '退火', active: false },
      { id: 900, code: 'FACTORY-QC', name: '检验', active: true, sort_order: 0 },
    ])
    expect(entries.map((entry) => entry.profile.name)).toEqual([
      '库房',
      '旧扎板名称',
      '退火',
      '研磨',
      '线切割',
      '雕刻',
      '电镀',
      '检验',
    ])
    expect(entries[1]!.team?.id).toBe(914)
    expect(entries[2]!.team).toBeUndefined()
    expect(entries[7]!.team?.id).toBe(900)
    expect(
      teamWorkspaceProfiles.some((profile) =>
        ['FACTORY-SHIP', 'FACTORY-SCRAP'].includes(profile.code),
      ),
    ).toBe(false)
  })
})

describe('shared workspace navigation', () => {
  it('groups every available section exactly once without losing permission boundaries', () => {
    for (const [warehouse, manage, reallocate, process, inspect] of [
      [false, false, true, true, false],
      [false, false, true, true, true],
      [true, true, true, false, false],
    ] as const) {
      const sections = teamWorkspaceModulesFor(
        warehouse,
        manage,
        reallocate,
        process,
        inspect,
      ).flatMap((module) => module.sections.map((section) => section.value))
      expect(new Set(sections).size).toBe(sections.length)
      expect([...sections].sort()).toEqual(
        teamWorkspaceSectionsFor(warehouse, manage, reallocate, process, inspect)
          .map((section) => section.value)
          .sort(),
      )
    }
    expect(teamWorkspaceModulesFor(false, false, true, true).map((module) => module.label)).toEqual(
      ['概览', '库存', '收发', '加工', '交期', '质量'],
    )
    expect(teamWorkspaceModulesFor(true, true, true).map((module) => module.value)).not.toContain(
      'processing',
    )
    expect(teamWorkspaceModulesFor(true, false, true).map((module) => module.value)).not.toContain(
      'warehouse',
    )
    expect(teamWorkspaceModuleFor('inspection-results')?.value).toBe('quality')
    expect(teamWorkspaceModuleFor('history')?.value).toBe('movement')
  })
  it('exposes processing records only when that capability is enabled', () => {
    expect(teamWorkspaceSectionsFor(false, false, false, true).map((item) => item.value)).toContain(
      'processing',
    )
    expect(teamWorkspaceSectionsFor(false).map((item) => item.value)).not.toContain('processing')
    expect(resolveTeamWorkspaceSection({ tab: 'processing' }, false, false, false, true)).toBe(
      'processing',
    )
    expect(resolveTeamWorkspaceSection({ tab: 'processing' }, false)).toBe('stock')
  })
  it('offers receipt records to every team while keeping warehouse management scoped', () => {
    expect(teamWorkspaceSectionsFor(false).map((item) => item.label)).toEqual([
      '概览',
      '库存明细',
      '交货排期',
      '来料待签收',
      '入库记录',
      '质量反馈',
      '出库记录',
      '丢失记录',
      '收发历史',
    ])
    expect(teamWorkspaceSectionsFor(true).map((item) => item.value)).toContain('receipts')
    expect(resolveTeamWorkspaceSection({ tab: 'delivery-schedule' }, false)).toBe(
      'delivery-schedule',
    )
    expect(teamWorkspaceSectionPath(7, 'delivery-schedule')).toBe(
      '/team-workspaces/7?tab=delivery-schedule',
    )
    expect(teamWorkspaceSectionsFor(true).map((item) => item.value)).not.toContain('warehouse')
    expect(teamWorkspaceSectionsFor(true, true).map((item) => item.value)).toContain('warehouse')
    expect(resolveTeamWorkspaceSection({ tab: 'warehouse' }, true, true)).toBe('warehouse')
    expect(resolveTeamWorkspaceSection({ tab: 'warehouse' }, false, true)).toBe('stock')
    expect(teamWorkspaceSectionPath(7, 'stock')).toBe('/team-workspaces/7')
    expect(teamWorkspaceSectionPath(7, 'pending')).toBe('/team-workspaces/7?tab=pending')
    expect(teamWorkspaceSectionPath(7, 'material-types')).toBe(
      '/team-workspaces/7?tab=material-types',
    )
  })
  it('enables reallocation and its records for every factory team', () => {
    for (const profile of teamWorkspaceProfiles) {
      expect(
        teamCanReallocate({
          code: profile.code,
          kind: profile.code === 'FACTORY-WAREHOUSE' ? 'warehouse' : 'production',
        }),
      ).toBe(true)
    }
    expect(teamCanReallocate({ code: 'NEW-TEAM', kind: 'production' })).toBe(true)
    expect(teamCanReallocate()).toBe(false)
    expect(teamWorkspaceSectionsFor(true, true, true).map((item) => item.value)).toContain(
      'reallocations',
    )
    expect(teamWorkspaceSectionsFor(false, false, false).map((item) => item.value)).not.toContain(
      'reallocations',
    )
    expect(resolveTeamWorkspaceSection({ tab: 'reallocations' }, false, false, true)).toBe(
      'reallocations',
    )
    expect(resolveTeamWorkspaceSection({ tab: 'reallocations' }, false)).toBe('stock')
  })
  it('uses the same selected section for legacy links, filters and unsupported tabs', () => {
    expect(resolveTeamWorkspaceSection({ tab: 'dashboard' }, false)).toBe('dashboard')
    expect(resolveTeamWorkspaceSection({ tab: 'dashboard' }, true)).toBe('dashboard')
    expect(teamWorkspaceSectionPath(7, 'dashboard')).toBe('/team-workspaces/7?tab=dashboard')
    expect(resolveTeamWorkspaceSection({ tab: 'overview' }, false)).toBe('history')
    expect(resolveTeamWorkspaceSection({ tab: 'materials' }, false)).toBe('stock')
    expect(resolveTeamWorkspaceSection({ tab: 'material-types' }, false)).toBe('stock')
    expect(teamWorkspaceSectionsFor(true, true, true).map((item) => item.value)).not.toContain(
      'material-types',
    )
    expect(resolveTeamWorkspaceSection({ tab: 'serials' }, false)).toBe('stock')
    expect(resolveTeamWorkspaceSection({ tab: 'receipts' }, false)).toBe('receipts')
    expect(resolveTeamWorkspaceSection({ tab: 'receipts' }, true)).toBe('receipts')
    expect(resolveTeamWorkspaceSection({ direction: 'incoming' }, false)).toBe('pending')
    expect(resolveTeamWorkspaceSection({ direction: 'incoming', status: 'received' }, false)).toBe(
      'receipts',
    )
    expect(resolveTeamWorkspaceSection({ direction: 'outgoing' }, false)).toBe('outgoing')
    expect(resolveTeamWorkspaceSection({ tab: ['stock', 'pending'] }, false)).toBe('stock')
  })
})

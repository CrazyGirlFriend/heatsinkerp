import type { Team } from '@/services/adminApi'
import type { LocationQuery } from 'vue-router'

export const teamWorkspaceSections = [
  { value: 'stock', label: '库存明细' },
  { value: 'pending', label: '待接收' },
  { value: 'receipts', label: '入库记录' },
  { value: 'outgoing', label: '出库记录' },
  { value: 'losses', label: '丢失记录' },
  { value: 'materials', label: '材质归类' },
  { value: 'history', label: '收发历史' },
] as const
export type TeamWorkspaceSection = typeof teamWorkspaceSections[number]['value']

export function teamWorkspaceSectionsFor(warehouse: boolean) {
  return teamWorkspaceSections.filter(section => warehouse || section.value !== 'receipts')
}

export function resolveTeamWorkspaceSection(query: LocationQuery, warehouse: boolean): TeamWorkspaceSection {
  if (query.tab === 'serials') return 'stock'
  if (query.tab === 'overview') return 'history'
  const section = teamWorkspaceSectionsFor(warehouse).find(item => item.value === query.tab)
  if (section) return section.value
  if (query.direction === 'outgoing') return 'outgoing'
  if (query.direction === 'incoming') return query.status === 'received' ? 'stock' : 'pending'
  return 'stock'
}

export function teamWorkspaceSectionPath(teamId: Team['id'], section: TeamWorkspaceSection) {
  return `/team-workspaces/${teamId}${section === 'stock' ? '' : `?tab=${section}`}`
}

// Stable page profiles; these do not prescribe a processing route or change team-management permissions.
export const teamWorkspaceProfiles = [
  { code: 'FACTORY-WAREHOUSE', name: '库房', description: '收发与物料保管，包含转废管理' },
  { code: 'FACTORY-ROLL', name: '轧制', description: '轧制班组物料收发与结存' },
  { code: 'FACTORY-ANNEAL', name: '退火', description: '退火班组物料收发与结存' },
  { code: 'FACTORY-GRIND', name: '研磨', description: '研磨班组物料收发与结存' },
  { code: 'FACTORY-WIRE', name: '线切割', description: '线切割班组物料收发与结存' },
  { code: 'FACTORY-ENGRAVE', name: '雕刻', description: '雕刻班组物料收发与结存' },
  { code: 'FACTORY-PLATE', name: '电镀', description: '电镀班组物料收发与结存' },
  { code: 'FACTORY-QC', name: '检验', description: '检验班组物料管理，包含去毛刺与发货职责' },
] as const

export function teamWorkspaceProfile(code: string | null | undefined) {
  return teamWorkspaceProfiles.find(profile => profile.code === code)
}

export function configuredTeamWorkspaces(teams: readonly Team[]) {
  return teamWorkspaceProfiles.map(profile => ({ profile, team: teams.find(team => team.active && team.code === profile.code) }))
}

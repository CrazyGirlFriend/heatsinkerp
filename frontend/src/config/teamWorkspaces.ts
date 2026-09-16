import type { Team } from '@/services/adminApi'

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

import { isProcessingTeamCode } from './materialRules'
import type { Team } from '@/services/adminApi'
import type { LocationQuery } from 'vue-router'

export const teamWorkspaceSections = [
  { value: 'dashboard', label: '概览' },
  { value: 'process-routes', label: '工艺记录' },
  { value: 'stock', label: '库存明细' },
  { value: 'delivery-schedule', label: '交货排期' },
  { value: 'pending', label: '来料待签收' },
  { value: 'receipts', label: '入库记录' },
  { value: 'processing', label: '加工记录' },
  { value: 'inspection-results', label: '检验记录' },
  { value: 'quality-feedback', label: '质量反馈' },
  { value: 'inspections', label: '巡检记录' },
  { value: 'outgoing', label: '出库记录' },
  { value: 'reallocations', label: '转投记录' },
  { value: 'losses', label: '丢失记录' },
  { value: 'materials', label: '材质库存' },
  { value: 'material-types', label: '类型库存' },
  { value: 'history', label: '收发历史' },
  { value: 'warehouse', label: '仓库管理' },
  { value: 'settings', label: '班组管理' },
] as const
export type TeamWorkspaceSection = (typeof teamWorkspaceSections)[number]['value']

export const teamWorkspaceModules = [
  { value: 'overview', label: '概览', sections: ['dashboard'] },
  {
    value: 'inventory',
    label: '库存',
    sections: ['stock', 'losses'],
  },
  {
    value: 'movement',
    label: '收发',
    sections: ['pending', 'receipts', 'outgoing', 'reallocations', 'history'],
  },
  { value: 'processing', label: '加工', sections: ['processing'] },
  { value: 'delivery', label: '交期', sections: ['delivery-schedule'] },
  {
    value: 'quality',
    label: '质量',
    sections: ['inspection-results', 'quality-feedback', 'inspections'],
  },
  { value: 'warehouse', label: '仓库管理', sections: ['warehouse'] },
  { value: 'settings', label: '班组管理', sections: ['settings'] },
] as const

export function teamWorkspaceModuleFor(section: string) {
  return teamWorkspaceModules.find((module) => module.sections.some((value) => value === section))
}

export function teamWorkspaceModulesFor(
  ...capabilities: Parameters<typeof teamWorkspaceSectionsFor>
) {
  const available = teamWorkspaceSectionsFor(...capabilities)
  return teamWorkspaceModules
    .map((module) => ({
      ...module,
      sections: module.sections.flatMap((value) =>
        available.filter((section) => section.value === value),
      ),
    }))
    .filter((module) => module.sections.length)
}

export function teamWorkspaceSectionsFor(
  warehouse: boolean,
  manageWarehouse = false,
  reallocations = false,
  processing = false,
  inspection = false,
  manageSettings = false,
) {
  return teamWorkspaceSections.filter(
    (section) =>
      section.value !== 'process-routes' &&
      section.value !== 'materials' &&
      section.value !== 'material-types' &&
      (section.value !== 'settings' || manageSettings) &&
      (section.value !== 'warehouse' || (warehouse && manageWarehouse)) &&
      (section.value !== 'reallocations' || reallocations) &&
      (section.value !== 'inspection-results' || inspection) &&
      (section.value !== 'processing' || processing) &&
      (section.value !== 'inspections' || processing),
  )
}

export function resolveTeamWorkspaceSection(
  query: LocationQuery,
  warehouse: boolean,
  manageWarehouse = false,
  reallocations = false,
  processing = false,
  inspection = false,
  manageSettings = false,
): TeamWorkspaceSection {
  if (query.tab === 'serials' || query.tab === 'materials' || query.tab === 'material-types')
    return 'stock'
  if (query.tab === 'overview') return 'history'
  const section = teamWorkspaceSectionsFor(
    warehouse,
    manageWarehouse,
    reallocations,
    processing,
    inspection,
    manageSettings,
  ).find((item) => item.value === query.tab)
  if (section) return section.value
  if (query.direction === 'outgoing') return 'outgoing'
  if (query.direction === 'incoming') return query.status === 'received' ? 'receipts' : 'pending'
  return 'stock'
}

export function teamWorkspaceSectionPath(teamId: Team['id'], section: TeamWorkspaceSection) {
  return `/team-workspaces/${teamId}${section === 'stock' ? '' : `?tab=${section}`}`
}

// Stable page profiles; these do not prescribe a processing route or change team-management permissions.
export const teamWorkspaceProfiles = [
  { code: 'FACTORY-WAREHOUSE', name: '库房', description: '收发与物料保管，包含转废管理' },
  { code: 'FACTORY-ROLL', name: '轧制', description: '轧制班组物料收发与库存' },
  { code: 'FACTORY-ANNEAL', name: '退火', description: '退火班组物料收发与库存' },
  { code: 'FACTORY-GRIND', name: '研磨', description: '研磨班组物料收发与库存' },
  { code: 'FACTORY-WIRE', name: '线切割', description: '线切割班组物料收发与库存' },
  { code: 'FACTORY-ENGRAVE', name: '雕刻', description: '雕刻班组物料收发与库存' },
  { code: 'FACTORY-PLATE', name: '电镀', description: '电镀班组物料收发与库存' },
  { code: 'FACTORY-QC', name: '检验', description: '检验班组物料管理，包含去毛刺与发货职责' },
] as const

export function teamWorkspaceProfile(code: string | null | undefined) {
  return teamWorkspaceProfiles.find((profile) => profile.code === code)
}

export function teamCanReallocate(team?: Pick<Team, 'code' | 'kind'>) {
  return team?.kind === 'warehouse' || team?.kind === 'production'
}

export function configuredTeamWorkspaces(teams: readonly Team[]) {
  return teamWorkspaceProfiles.map((profile) => {
    const team = teams.find((team) => team.active && team.code === profile.code)
    return { profile: { ...profile, name: team?.name || profile.name }, team }
  })
}

export function teamCanProcess(team?: Pick<Team, 'code' | 'kind'>) {
  return team?.kind === 'production' && isProcessingTeamCode(team.code)
}

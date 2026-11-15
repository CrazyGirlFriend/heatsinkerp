import type { Account } from '@/types/admin'

export function canMaintainProcessRoute(user: Account | null | undefined): boolean {
  return !!(
    user?.active &&
    user.role === 'TEAM' &&
    user.team?.active &&
    user.team.code === 'FACTORY-PROCESS' &&
    user.team.kind === 'engineering'
  )
}

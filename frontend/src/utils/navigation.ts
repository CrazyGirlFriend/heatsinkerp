import type { Account } from '@/services/adminApi'
import type { RouteLocationRaw, Router } from 'vue-router'

export const DEFAULT_LOGIN_PATH = '/factory-analysis'

export function defaultAuthenticatedPath(user: Pick<Account, 'role' | 'team_id'> | null | undefined): string {
  const teamId = Number(user?.team_id)
  return user?.role === 'TEAM' && Number.isSafeInteger(teamId) && teamId > 0 ? `/team-workspaces/${teamId}` : '/'
}

/** Only allow local application paths, never protocol-relative URLs or auth-page loops. */
export function safeInternalRedirect(value: unknown, fallback = '/transfer-batches'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  // eslint-disable-next-line no-control-regex -- Reject control characters in redirect input.
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return fallback
  try {
    const decoded = decodeURIComponent(value)
    // eslint-disable-next-line no-control-regex -- Also reject percent-encoded controls.
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback
    const url = new URL(value, 'https://heatsink.invalid')
    if (url.origin !== 'https://heatsink.invalid') return fallback
    if (['/access', '/login'].includes(url.pathname.replace(/\/$/, ''))) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

/** Use Vue Router's previous entry, never the browser's external referrer. */
export function pageBackDestination(router: Router, user: Pick<Account, 'role' | 'team_id'> | null | undefined, fallback?: RouteLocationRaw): { path: string; history: boolean } | null {
  const current = router.currentRoute.value
  const back = safeInternalRedirect(router.options.history.state.back, '')
  if (back && back !== current.fullPath) {
    const previous = router.resolve(back)
    const businessPage = previous.matched.some(record => record.components) && !previous.matched.some(record => record.redirect) && !previous.meta.public
    const restricted = user?.role !== 'ADMIN' && (previous.meta.adminOnly || previous.path === '/flow-preview/chain')
    if (businessPage && !restricted) return { path: previous.fullPath, history: true }
  }
  let destination: RouteLocationRaw = fallback || defaultAuthenticatedPath(user)
  if (!fallback) {
    if (current.path.startsWith('/team-workspaces/') && current.query.tab && current.query.tab !== 'stock') destination = current.path
    else if (current.path.startsWith('/settings/') && current.path !== '/settings/teams') destination = '/settings/teams'
    else if (current.path === '/material-trace') destination = '/transfer-batches'
  }
  const path = router.resolve(destination).fullPath
  return path === current.fullPath || (path === current.path && (!current.query.tab || current.query.tab === 'stock')) ? null : { path, history: false }
}

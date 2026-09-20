import type { Account } from '@/services/adminApi'

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

export const SITE_ACCESS_REQUIRED_EVENT = 'heatsink-site-access-required'

const listeners = new Set<() => void>()

// Transport reports expiry; stores own state and release their subscriptions on disposal.
export function onSiteAccessRequired(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifySiteAccessRequired(): void {
  for (const listener of listeners) listener()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SITE_ACCESS_REQUIRED_EVENT))
}

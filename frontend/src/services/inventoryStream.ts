import { API_BASE, authorizationValue, invalidateAccountSession } from './httpClient'
import { notifySiteAccessRequired } from '@/stores/access'
import type { FactoryOverview } from '@/types/factoryOverview'
import type { FactoryLive } from '@/types/factoryLive'
import { reportDiagnostic, type DiagnosticCode } from './diagnostics'

export type InventoryConnection = 'connecting' | 'live' | 'reconnecting' | 'expired'
export interface InventoryChange {
  changed: boolean
  team_ids?: number[] | null
  directory_changed?: boolean
  accounts_changed?: boolean
  current_user_changed?: boolean
}
export interface InventorySubscription<T = FactoryOverview> {
  onData: (report: T) => void
  onState: (state: InventoryConnection) => void
}

// Fetch streaming preserves the existing Authorization header and access cookie;
// native EventSource cannot attach a Bearer header. Tokens never enter the URL.
export function subscribeInventory(subscription: InventorySubscription): () => void {
  return subscribeStream('/factory-overview/stream', 'inventory', subscription, (data) =>
    Boolean(data?.as_of && data?.totals && Array.isArray(data?.teams)),
  )
}
export function subscribeFactoryLive(subscription: InventorySubscription<FactoryLive>): () => void {
  return subscribeStream('/factory-overview/live/stream', 'factory-live', subscription, (data) =>
    Boolean(
      data?.as_of &&
      data?.totals &&
      data?.today &&
      Array.isArray(data?.teams) &&
      Array.isArray(data?.recent_batches) &&
      Array.isArray(data?.material_stock),
    ),
  )
}
export function subscribeInventoryChanges(
  subscription: InventorySubscription<InventoryChange>,
): () => void {
  return subscribeStream(
    '/factory-overview/changes',
    'inventory-changed',
    subscription,
    (data) =>
      data?.changed === true &&
      (data.team_ids === undefined ||
        data.team_ids === null ||
        (Array.isArray(data.team_ids) &&
          data.team_ids.every((id) => Number.isInteger(id) && id > 0))) &&
      [data.directory_changed, data.accounts_changed, data.current_user_changed].every(
        (flag) => flag === undefined || typeof flag === 'boolean',
      ),
  )
}
function subscribeStream<T>(
  path: string,
  eventName: string,
  { onData, onState }: InventorySubscription<T>,
  valid: (data: T) => boolean,
): () => void {
  let stopped = false,
    failures = 0
  let controller: AbortController | undefined
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  function stop() {
    stopped = true
    controller?.abort()
    void activeReader?.cancel().catch(() => {
      /* Transport already closed. */
    })
    clearTimeout(retry)
    clearTimeout(watchdog)
  }
  function expire(status: number) {
    stop()
    onState('expired')
    if (status === 423) notifySiteAccessRequired()
    else invalidateAccountSession()
  }
  async function connect() {
    if (stopped) return
    controller = new AbortController()
    const current = controller
    let diagnostic: DiagnosticCode = 'stream.connect'
    let requestId: string | null = null
    let status: number | undefined
    const touch = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        diagnostic = 'stream.timeout'
        current.abort()
      }, 45000)
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      touch()
      const authorization = authorizationValue()
      const response = await fetch(`${API_BASE}${path}`, {
        headers: {
          Accept: 'text/event-stream',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        credentials: 'include',
        cache: 'no-store',
        signal: current.signal,
      })
      requestId = response.headers.get('x-request-id')
      status = response.status
      diagnostic = 'stream.response'
      if (stopped) {
        await response.body?.cancel()
        return
      }
      if (response.status === 401 || response.status === 423) {
        expire(response.status)
        return
      }
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      ) {
        throw new Error('Inventory stream unavailable')
      }
      reader = response.body.getReader()
      activeReader = reader
      const decoder = new TextDecoder()
      let buffer = ''
      while (!stopped) {
        diagnostic = 'stream.read'
        const { done, value } = await reader.read()
        if (stopped) return
        if (done) {
          diagnostic = 'stream.closed'
          throw new Error('Inventory stream closed')
        }
        touch()
        buffer = (buffer + decoder.decode(value, { stream: true })).replaceAll('\r\n', '\n')
        if (buffer.length > 2000000) {
          diagnostic = 'stream.oversized'
          throw new Error('Inventory event too large')
        }
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const lines = buffer.slice(0, boundary).split('\n')
          buffer = buffer.slice(boundary + 2)
          const event = lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim()
          if (event === 'auth-expired' || event === 'access-required') {
            expire(event === 'auth-expired' ? 401 : 423)
            return
          }
          if (event !== eventName) continue // Heartbeat comments don't animate or refresh data.
          diagnostic = 'stream.parse'
          const data = JSON.parse(
            lines
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n'),
          ) as T
          diagnostic = 'stream.invalid'
          if (!valid(data)) throw new Error('Invalid inventory snapshot')
          if (stopped) return
          failures = 0
          diagnostic = 'stream.consumer'
          onState('live')
          onData(data)
        }
      }
    } catch {
      if (!stopped) {
        reportDiagnostic(diagnostic, { status, requestId })
        onState('reconnecting')
      }
    } finally {
      clearTimeout(watchdog)
      current.abort()
      try {
        await reader?.cancel()
      } catch {
        /* Already disconnected. */
      }
      reader?.releaseLock()
      if (activeReader === reader) activeReader = undefined
      if (!stopped)
        retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** failures++, 15000))
    }
  }
  onState('connecting')
  void connect()
  return stop
}

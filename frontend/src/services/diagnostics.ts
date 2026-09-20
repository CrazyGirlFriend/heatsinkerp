import type { App } from 'vue'

export type DiagnosticCode =
  | 'vue.error'
  | 'window.error'
  | 'promise.rejected'
  | 'http.network'
  | 'http.server'
  | 'http.unexpected'
  | 'stream.connect'
  | 'stream.response'
  | 'stream.read'
  | 'stream.timeout'
  | 'stream.closed'
  | 'stream.oversized'
  | 'stream.parse'
  | 'stream.invalid'
  | 'stream.consumer'

interface Diagnostic {
  at: string
  code: DiagnosticCode
  status?: number
  requestId?: string
}

const entries: Diagnostic[] = []
const lastReported = new Map<string, number>()
const LIMIT = 50
const THROTTLE_MS = 30_000

export function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) ? value : undefined
}

/** Only static categories and server-generated IDs leave this boundary. Never
 * pass messages, stacks, URLs, bodies or tokens to browser diagnostics. */
export function reportDiagnostic(
  code: DiagnosticCode,
  context: { status?: number; requestId?: unknown } = {},
): void {
  const now = Date.now()
  if (now - (lastReported.get(code) ?? -Infinity) < THROTTLE_MS) return
  lastReported.set(code, now)
  const status =
    Number.isInteger(context.status) && context.status! >= 100 && context.status! <= 599
      ? context.status
      : undefined
  const entry: Diagnostic = {
    at: new Date(now).toISOString(),
    code,
    status,
    requestId: safeRequestId(context.requestId),
  }
  entries.push(entry)
  if (entries.length > LIMIT) entries.shift()
  console.warn('[heatsink]', entry)
}

export function readDiagnostics(): readonly Diagnostic[] {
  return entries.map((entry) => ({ ...entry }))
}

function isCancellation(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    (error.name === 'AbortError' || error.name === 'CanceledError')
  )
}

export function installDiagnostics(app: App): () => void {
  const previous = app.config.errorHandler
  app.config.errorHandler = () => reportDiagnostic('vue.error')
  const onError = () => reportDiagnostic('window.error')
  const onRejection = (event: PromiseRejectionEvent) => {
    if (!isCancellation(event.reason)) reportDiagnostic('promise.rejected')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    app.config.errorHandler = previous
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

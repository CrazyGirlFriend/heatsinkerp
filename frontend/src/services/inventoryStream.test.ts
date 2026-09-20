// @vitest-environment jsdom
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  subscribeFactoryLive,
  subscribeInventory,
  subscribeInventoryChanges,
} from './inventoryStream'
import { HTTP_AUTH_SESSION_STORAGE_KEY } from './httpClient'
import { reportDiagnostic } from './diagnostics'
vi.mock('./diagnostics', () => ({
  reportDiagnostic: vi.fn(),
  safeRequestId: (value: unknown) =>
    typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) ? value : undefined,
}))
import { SITE_ACCESS_REQUIRED_EVENT } from '@/stores/access'
import { factoryFixture } from '@/testFixtures/factoryOverview'

let stop: (() => void) | undefined
let stream: ReadableStreamDefaultController<Uint8Array>
let cancelled: ReturnType<typeof vi.fn>
const encoder = new TextEncoder()
function response() {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller
      },
      cancel: cancelled,
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
function push(text: string) {
  stream.enqueue(encoder.encode(text))
}
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  cancelled = vi.fn()
  stop = undefined
  vi.mocked(reportDiagnostic).mockClear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(async () => {
  stop?.()
  await flushPromises()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('authenticated inventory SSE', () => {
  it('receives lightweight ledger changes and does not treat a heartbeat as a change', async () => {
    vi.mocked(fetch).mockResolvedValue(response())
    const onData = vi.fn(),
      onState = vi.fn()
    stop = subscribeInventoryChanges({ onData, onState })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith(
      '/api/factory-overview/changes',
      expect.objectContaining({ credentials: 'include' }),
    )
    push('event: inventory-changed\ndata: {"changed":true}\n\n')
    await flushPromises()
    expect(onData).toHaveBeenCalledWith({ changed: true })
    push(': heartbeat\n\n')
    await flushPromises()
    expect(onData).toHaveBeenCalledOnce()
    push('event: inventory-changed\ndata: null\n\n')
    await flushPromises()
    expect(onState).toHaveBeenLastCalledWith('reconnecting')
    expect(onData).toHaveBeenCalledOnce()
  })
  it('uses the dedicated robot snapshot instead of the shorter homepage feed', async () => {
    vi.mocked(fetch).mockResolvedValue(response())
    const onData = vi.fn(),
      onState = vi.fn()
    stop = subscribeFactoryLive({ onData, onState })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/factory-overview/live/stream', expect.any(Object))
    const report = {
      ...factoryFixture(),
      today: { outgoing_quantity: 10, received_batches: 1 },
      recent_batches: [],
      material_stock: [{ key: '铜钼 CuMo70', quantity: 10, weight: 1 }],
    }
    push(`event: factory-live\ndata: ${JSON.stringify(report)}\n\n`)
    await flushPromises()
    expect(onData).toHaveBeenCalledWith(report)
    push('event: factory-live\ndata: {}\n\n')
    await flushPromises()
    expect(onState).toHaveBeenLastCalledWith('reconnecting')
  })
  it('receives split UTF-8 frames with credentials, ignores heartbeats, and never polls', async () => {
    localStorage.setItem(
      HTTP_AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({ access_token: 'private-token' }),
    )
    vi.mocked(fetch).mockResolvedValue(response())
    const onData = vi.fn(),
      onState = vi.fn()
    stop = subscribeInventory({ onData, onState })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith(
      '/api/factory-overview/stream',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream', Authorization: 'Bearer private-token' },
        credentials: 'include',
        cache: 'no-store',
      }),
    )
    const data = factoryFixture()
    const bytes = encoder.encode(`event: inventory\r\ndata: ${JSON.stringify(data)}\r\n\r\n`)
    for (let index = 0; index < bytes.length; index += 13)
      stream.enqueue(bytes.slice(index, index + 13))
    await flushPromises()
    expect(onData).toHaveBeenCalledOnce()
    expect(onData).toHaveBeenCalledWith(data)
    expect(onState).toHaveBeenLastCalledWith('live')
    push(': heartbeat\n\n')
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetch).toHaveBeenCalledOnce()
    expect(onData).toHaveBeenCalledOnce()
    stop()
    await flushPromises()
    expect(cancelled).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('reconnects after an ended connection and accepts a fresh complete snapshot', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response())
    const onData = vi.fn(),
      onState = vi.fn()
    stop = subscribeInventory({ onData, onState })
    await flushPromises()
    push(`event: inventory\ndata: ${JSON.stringify(factoryFixture())}\n\n`)
    await flushPromises()
    stream.close()
    await flushPromises()
    expect(onState).toHaveBeenLastCalledWith('reconnecting')
    vi.mocked(fetch).mockResolvedValueOnce(response())
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    const next = factoryFixture()
    next.totals.on_hand_quantity = 987
    push(`event: inventory\ndata: ${JSON.stringify(next)}\n\n`)
    await flushPromises()
    expect(onData).toHaveBeenLastCalledWith(next)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('reconnects a silently stalled transport and releases the old reader', async () => {
    vi.mocked(fetch).mockImplementation((_url, options) => {
      options?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')), {
        once: true,
      })
      return Promise.resolve(response())
    })
    const onState = vi.fn()
    stop = subscribeInventory({ onData: vi.fn(), onState })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(45000)
    await flushPromises()
    expect(onState).toHaveBeenLastCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each([401, 423])(
    'stops reconnecting and follows existing access handling for HTTP %s',
    async (status) => {
      localStorage.setItem(HTTP_AUTH_SESSION_STORAGE_KEY, 'keep-unless-401')
      vi.mocked(fetch).mockResolvedValue(new Response('', { status }))
      const onState = vi.fn(),
        listener = vi.fn()
      const event = status === 401 ? 'heatsink-auth-expired' : SITE_ACCESS_REQUIRED_EVENT
      window.addEventListener(event, listener)
      stop = subscribeInventory({ onData: vi.fn(), onState })
      await flushPromises()
      expect(listener).toHaveBeenCalledOnce()
      expect(onState).toHaveBeenLastCalledWith('expired')
      expect(localStorage.getItem(HTTP_AUTH_SESSION_STORAGE_KEY)).toBe(
        status === 401 ? null : 'keep-unless-401',
      )
      await vi.advanceTimersByTimeAsync(60000)
      expect(fetch).toHaveBeenCalledOnce()
      window.removeEventListener(event, listener)
    },
  )
  it.each(['auth-expired', 'access-required'])(
    'honors server-side %s on an already-open stream',
    async (event) => {
      vi.mocked(fetch).mockResolvedValue(response())
      const onState = vi.fn(),
        onData = vi.fn()
      stop = subscribeInventory({ onState, onData })
      await flushPromises()
      push(`event: ${event}\ndata: {}\n\n`)
      await flushPromises()
      expect(onState).toHaveBeenLastCalledWith('expired')
      expect(onData).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(60000)
      expect(fetch).toHaveBeenCalledOnce()
    },
  )
})

it('classifies malformed snapshots without logging their contents and stays silent on stop', async () => {
  vi.mocked(fetch).mockResolvedValue(response())
  stop = subscribeInventory({ onData: vi.fn(), onState: vi.fn() })
  await flushPromises()
  push('event: inventory\ndata: PRIVATE-INVALID-JSON\n\n')
  await flushPromises()
  expect(reportDiagnostic).toHaveBeenCalledWith('stream.parse', { status: 200, requestId: null })
  expect(JSON.stringify(vi.mocked(reportDiagnostic).mock.calls)).not.toContain('PRIVATE')
  stop()
  await flushPromises()
  expect(reportDiagnostic).toHaveBeenCalledOnce()
})

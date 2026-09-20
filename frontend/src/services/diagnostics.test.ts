// @vitest-environment jsdom
import { createApp } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('only records allowlisted metadata and throttles reconnect floods', async () => {
  const { reportDiagnostic, readDiagnostics } = await import('./diagnostics')
  for (let i = 0; i < 100; i++)
    reportDiagnostic('stream.parse', { requestId: 'TOKEN-SECRET', status: 500 })
  expect(readDiagnostics()).toHaveLength(1)
  expect(readDiagnostics()[0]).toMatchObject({
    code: 'stream.parse',
    status: 500,
    requestId: undefined,
  })
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('SECRET')
  await vi.advanceTimersByTimeAsync(30_000)
  reportDiagnostic('stream.parse', { requestId: 'a'.repeat(32) })
  expect(readDiagnostics()[1]?.requestId).toBe('a'.repeat(32))
})

it('bounds retained diagnostics and returns copies', async () => {
  const { reportDiagnostic, readDiagnostics } = await import('./diagnostics')
  for (let i = 0; i < 60; i++) {
    reportDiagnostic('http.server', { status: 503 })
    await vi.advanceTimersByTimeAsync(30_000)
  }
  expect(readDiagnostics()).toHaveLength(50)
  const copy = readDiagnostics()
  copy[0]!.status = 200
  expect(readDiagnostics()[0]?.status).toBe(503)
})

it('captures Vue and global errors without their contents and removes listeners', async () => {
  const { installDiagnostics, readDiagnostics } = await import('./diagnostics')
  const app = createApp({})
  const dispose = installDiagnostics(app)
  app.config.errorHandler?.(new Error('PRIVATE-VUE'), null, 'SECRET-URL')
  window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE-WINDOW' }))
  const rejection = new Event('unhandledrejection')
  Object.defineProperty(rejection, 'reason', { value: new Error('PRIVATE-PROMISE') })
  window.dispatchEvent(rejection)
  expect(readDiagnostics().map((item) => item.code)).toEqual([
    'vue.error',
    'window.error',
    'promise.rejected',
  ])
  expect(JSON.stringify(readDiagnostics())).not.toContain('PRIVATE')
  dispose()
  await vi.advanceTimersByTimeAsync(30_000)
  window.dispatchEvent(new ErrorEvent('error'))
  expect(readDiagnostics()).toHaveLength(3)
  expect(app.config.errorHandler).toBeUndefined()
})

it('ignores deliberate cancellation', async () => {
  const { installDiagnostics, readDiagnostics } = await import('./diagnostics')
  const dispose = installDiagnostics(createApp({}))
  try {
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', {
      value: new DOMException('cancelled', 'AbortError'),
    })
    window.dispatchEvent(rejection)
    expect(readDiagnostics()).toHaveLength(0)
  } finally {
    dispose()
  }
})

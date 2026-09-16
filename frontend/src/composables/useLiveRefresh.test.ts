// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventorySubscription } from '@/services/inventoryStream'
import { useLiveRefresh } from './useLiveRefresh'

const transport = vi.hoisted(() => ({ subscribe: vi.fn(), stop: vi.fn() }))
vi.mock('@/services/inventoryStream', () => ({ subscribeInventoryChanges: transport.subscribe }))
let callbacks: InventorySubscription<{ changed: boolean }>
let wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  transport.stop.mockReset()
  transport.subscribe.mockReset().mockImplementation(value => { callbacks = value; return transport.stop })
})
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = []; vi.useRealTimers() })
function render(refresh: () => Promise<void>, busy = ref(false), enabled = ref(true)) {
  let live!: ReturnType<typeof useLiveRefresh>
  const wrapper = mount(defineComponent({ setup() { live = useLiveRefresh(refresh, { busy: () => busy.value, enabled: () => enabled.value }); return () => null } }))
  wrappers.push(wrapper)
  return { wrapper, live }
}
async function tick() { await vi.advanceTimersByTimeAsync(100); await flushPromises() }
function event() { callbacks.onData({ changed: true }) }

describe('shared table change notifications', () => {
  it('shares one stream, coalesces events and closes only its last subscriber', async () => {
    const a = vi.fn().mockResolvedValue(undefined), b = vi.fn().mockResolvedValue(undefined)
    const first = render(a), second = render(b)
    expect(transport.subscribe).toHaveBeenCalledTimes(1)
    event(); event(); event(); await tick()
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1)
    first.wrapper.unmount(); expect(transport.stop).not.toHaveBeenCalled()
    second.wrapper.unmount(); expect(transport.stop).toHaveBeenCalledTimes(1)
  })
  it('waits while editing and catches up once after editing ends', async () => {
    const busy = ref(true), refresh = vi.fn().mockResolvedValue(undefined)
    render(refresh, busy)
    event(); event(); await tick(); expect(refresh).not.toHaveBeenCalled()
    busy.value = false; await flushPromises(); await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('does not overlap requests and drains one pending update after a slow read', async () => {
    let resolve!: () => void
    const refresh = vi.fn().mockReturnValueOnce(new Promise<void>(done => { resolve = done })).mockResolvedValue(undefined)
    render(refresh); event(); await tick(); event(); event(); await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    resolve(); await flushPromises(); await tick()
    expect(refresh).toHaveBeenCalledTimes(2)
  })
  it('closes hidden views, reconnects on return and never polls when unchanged', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(refresh); event(); await tick()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))
    expect(transport.stop).toHaveBeenCalledOnce()
    callbacks.onData({ changed: true }); await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'))
    expect(transport.subscribe).toHaveBeenCalledTimes(2)
    event(); await tick(); await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
  it('reports failure and reconnecting state; retry clears a recovered read failure', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const { live } = render(refresh)
    event(); await tick(); expect(live.message.value).toContain('同步失败')
    live.request(); await tick(); expect(live.message.value).toBe('')
    callbacks.onState('reconnecting'); expect(live.message.value).toContain('正在重连')
    callbacks.onState('live'); expect(live.message.value).toBe('')
  })
  it('cancels queued work on close and ignores late completions after unmount', async () => {
    const enabled = ref(true), refresh = vi.fn().mockResolvedValue(undefined)
    const { wrapper } = render(refresh, ref(false), enabled)
    event(); enabled.value = false; await flushPromises(); await tick()
    expect(refresh).not.toHaveBeenCalled()
    enabled.value = true; await flushPromises(); event(); wrapper.unmount(); await tick()
    expect(refresh).not.toHaveBeenCalled()
  })
})

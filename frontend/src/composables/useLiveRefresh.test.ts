// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryChange, InventorySubscription } from '@/services/inventoryStream'
import { useLiveRefresh } from './useLiveRefresh'

const transport = vi.hoisted(() => ({ subscribe: vi.fn(), stop: vi.fn() }))
vi.mock('@/services/inventoryStream', () => ({ subscribeInventoryChanges: transport.subscribe }))
let callbacks: InventorySubscription<InventoryChange>
let wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  transport.stop.mockReset()
  transport.subscribe.mockReset().mockImplementation(value => { callbacks = value; return transport.stop })
})
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = []; vi.useRealTimers() })
function render(refresh: () => Promise<void>, busy = ref(false), enabled = ref(true), options: Parameters<typeof useLiveRefresh>[1] = {}) {
  let live!: ReturnType<typeof useLiveRefresh>
  const wrapper = mount(defineComponent({ setup() { live = useLiveRefresh(refresh, { busy: () => busy.value, enabled: () => enabled.value, ...options }); return () => null } }))
  wrappers.push(wrapper)
  return { wrapper, live }
}
async function tick() { await vi.advanceTimersByTimeAsync(100); await flushPromises() }
function event() { callbacks.onData({ changed: true }) }

describe('shared table change notifications', () => {
  it('only refreshes affected teams, follows current scope, and keeps global/legacy notifications', async () => {
    const a = vi.fn().mockResolvedValue(undefined), b = vi.fn().mockResolvedValue(undefined)
    const team = ref(1)
    render(a, ref(false), ref(true), { teamId: () => team.value })
    render(b, ref(false), ref(true), { teamId: () => 2 })
    callbacks.onData({ changed: true, team_ids: [1, 3] }); await tick()
    expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled()
    team.value = 4
    callbacks.onData({ changed: true, team_ids: [1] }); await tick()
    expect(a).toHaveBeenCalledOnce()
    callbacks.onData({ changed: true, team_ids: [4] }); await tick()
    expect(a).toHaveBeenCalledTimes(2)
    callbacks.onData({ changed: true, team_ids: null }); await tick()
    event(); await tick()
    expect(a).toHaveBeenCalledTimes(4); expect(b).toHaveBeenCalledTimes(2)
  })
  it('separates account and directory pages from material notifications', async () => {
    const stock = vi.fn().mockResolvedValue(undefined), directory = vi.fn().mockResolvedValue(undefined), accounts = vi.fn().mockResolvedValue(undefined)
    render(stock, ref(false), ref(true), { teamId: () => 1 })
    render(directory, ref(false), ref(true), { scope: 'directory' })
    render(accounts, ref(false), ref(true), { scope: 'accounts' })
    callbacks.onData({ changed: true, team_ids: [1] }); await tick()
    expect(stock).toHaveBeenCalledOnce(); expect(accounts).not.toHaveBeenCalled(); expect(directory).not.toHaveBeenCalled()
    callbacks.onData({ changed: true, team_ids: [], accounts_changed: true }); await tick()
    expect(stock).toHaveBeenCalledOnce(); expect(accounts).toHaveBeenCalledOnce(); expect(directory).not.toHaveBeenCalled()
    callbacks.onData({ changed: true, team_ids: [], directory_changed: true }); await tick()
    expect(stock).toHaveBeenCalledTimes(2); expect(accounts).toHaveBeenCalledTimes(2); expect(directory).toHaveBeenCalledOnce()
    callbacks.onData({ changed: true, team_ids: [], current_user_changed: true }); await tick()
    expect(stock).toHaveBeenCalledTimes(3); expect(accounts).toHaveBeenCalledTimes(3); expect(directory).toHaveBeenCalledTimes(2)
  })
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

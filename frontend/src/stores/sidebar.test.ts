// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, clearSession } from '@/stores/auth'
import { useSidebarStore } from './sidebar'

function signIn(id: number): void {
  authState.session = { access_token: `sidebar-${id}`, token_type: 'Bearer', user: { id, username: 'test', display_name: '测试', role: 'ADMIN', team_id: null, team: null, active: true } }
}

beforeEach(() => { clearSession(); localStorage.clear(); signIn(1) })
afterEach(() => { clearSession(); vi.restoreAllMocks() })

describe('sidebar preferences', () => {
  it('restores expanded and compact preferences on reload, isolated by account', () => {
    const store = useSidebarStore(createPinia())
    store.compact = true; store.page = '/factory-stock'; store.opened = ['teams']
    const restored = useSidebarStore(createPinia())
    expect(restored.compact).toBe(true)
    expect(restored.opened).toEqual(['teams'])
    expect(restored.page).toBe('/factory-stock')
    signIn(2)
    expect(restored.compact).toBe(false)
    expect(restored.opened).toEqual([])
    signIn(1)
    expect(restored.compact).toBe(true)
    expect(restored.opened).toEqual(['teams'])
    store.$dispose(); restored.$dispose()
  })

  it('migrates old team-section preferences to a two-level menu', () => {
    localStorage.setItem('heatsink-sidebar:1:ADMIN', JSON.stringify({ compact: true, opened: ['teams', 'team-8'], page: '/team-workspaces/8?tab=history' }))
    const store = useSidebarStore(createPinia())
    expect(store.compact).toBe(true)
    expect(store.opened).toEqual(['teams'])
    expect(store.page).toBe('/team-workspaces/8')
    store.$dispose()
  })

  it('works with unavailable or malformed browser storage', () => {
    localStorage.setItem('heatsink-sidebar:1:ADMIN', '{broken')
    const store = useSidebarStore(createPinia())
    expect(store.opened).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => { store.compact = true; store.opened = ['materials'] }).not.toThrow()
    expect(store.compact).toBe(true)
    store.$dispose()
  })
})

// @vitest-environment jsdom
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, clearSession } from '@/stores/auth'
import { useSidebarStore } from './sidebar'

function signIn(id: number): void {
  authState.session = {
    access_token: `sidebar-${id}`,
    token_type: 'Bearer',
    user: {
      id,
      username: 'test',
      display_name: '测试',
      role: 'ADMIN',
      team_id: null,
      team: null,
      active: true,
    },
  }
}

beforeEach(() => {
  clearSession()
  localStorage.clear()
  signIn(1)
})
afterEach(() => {
  clearSession()
  vi.restoreAllMocks()
})

describe('sidebar preferences', () => {
  it('restores expanded and compact preferences on reload, isolated by account', () => {
    const store = useSidebarStore(createPinia())
    store.compact = true
    store.page = '/factory-stock'
    store.opened = ['teams']
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
    store.$dispose()
    restored.$dispose()
  })

  it('restores the three-level team branch without retaining invalid menu keys', () => {
    localStorage.setItem(
      'heatsink-sidebar:1:ADMIN',
      JSON.stringify({
        compact: true,
        opened: ['teams', 'team-8', 'team-invalid'],
        page: '/team-workspaces/8?tab=history',
      }),
    )
    const store = useSidebarStore(createPinia())
    expect(store.compact).toBe(true)
    expect(store.opened).toEqual(['teams', 'team-8'])
    expect(store.page).toBe('/team-workspaces/8')
    store.$dispose()
  })

  it('remembers filters and pages by team and view, and never replays notification links', () => {
    const store = useSidebarStore(createPinia())
    store.rememberWorkspace('8', 'outgoing', { tab: 'outgoing', query: '铜', page: '3' })
    store.rememberWorkspace('8', 'stock', { material_name: '钼' })
    store.rememberWorkspace('8', 'outgoing', {
      tab: 'outgoing',
      business_notice: 'rework:1',
      notice: '1',
    })
    expect(store.workspaceLocation('8', 'outgoing').query).toEqual({
      tab: 'outgoing',
      query: '铜',
      page: '3',
    })
    expect(store.workspaceModules['8:movement']).toBe('outgoing')
    expect(store.workspaceLocation('9', 'outgoing').query).toEqual({ tab: 'outgoing' })
    signIn(2)
    expect(store.workspaceQueries).toEqual({})
    expect(store.workspaceCounts).toEqual({})
    store.$dispose()
  })

  it('works with unavailable or malformed browser storage', () => {
    localStorage.setItem('heatsink-sidebar:1:ADMIN', '{broken')
    const store = useSidebarStore(createPinia())
    expect(store.opened).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => {
      store.compact = true
      store.opened = ['materials']
    }).not.toThrow()
    expect(store.compact).toBe(true)
    store.$dispose()
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({ admin: true, authenticated: true, user: { role: 'ADMIN' as 'ADMIN' | 'TEAM', team_id: null as number | null }, refresh: vi.fn() }))

vi.mock('@/stores/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/auth')>()
  return {
    ...actual,
    isAdmin: { get value() { return authMocks.admin } },
    isAuthenticated: { get value() { return authMocks.authenticated } },
    currentUser: { get value() { return authMocks.user } },
    restoreSession: vi.fn(),
    refreshCurrentUser: authMocks.refresh,
  }
})

vi.mock('@/stores/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/access')>()
  return {
    ...actual,
    canEnterSite: { value: true },
    checkSiteAccess: vi.fn().mockResolvedValue(true),
    SITE_ACCESS_REQUIRED_EVENT: 'test-site-access-required',
  }
})

import router from './index'

beforeEach(async () => {
  vi.stubGlobal('scrollTo', vi.fn())
  authMocks.admin = true
  authMocks.authenticated = true
  authMocks.user = { role: 'ADMIN', team_id: null }
  authMocks.refresh.mockReset().mockResolvedValue(undefined)
  await router.replace('/transfer-batches')
})

afterEach(() => {
  vi.unstubAllGlobals()
  authMocks.admin = true
  authMocks.authenticated = true
})

describe('phase-one routes', () => {
  it('enters the refreshed bound team by default while retaining explicit safe destinations', async () => {
    authMocks.admin = false
    authMocks.user = { role: 'TEAM', team_id: 2 }
    authMocks.refresh.mockImplementationOnce(async () => { authMocks.user = { role: 'TEAM', team_id: 3 } })
    await router.push('/login')
    expect(router.currentRoute.value.path).toBe('/team-workspaces/3')
    await router.push('/login?redirect=%2Fmaterial-trace%3Fserial_no%3DFLOW-1')
    expect(router.currentRoute.value.path).toBe('/team-workspaces/3')
    await router.push('/login?redirect=%2Ftransfer-batches%3Fserial_no%3DFLOW-1')
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches?serial_no=FLOW-1')
    await router.push('/login?redirect=https%3A%2F%2Fevil.example')
    expect(router.currentRoute.value.path).toBe('/team-workspaces/3')
  })

  it('opens the factory homepage for both roles and retains explicit team routes', async () => {
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
    authMocks.admin = false
    authMocks.user = { role: 'TEAM', team_id: 999 }
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
    expect(router.resolve('/team-workspaces/not-a-number').name).toBe('team-workspace')
  })

  it('uses the material-transfer pages as the primary routes', () => {
    expect(router.resolve('/transfer-batches').name).toBe('transfer-batches')
    expect(router.resolve('/transfer-batches/scan').name).toBe('transfer-batch-scan')
    expect(router.resolve('/material-trace').name).toBe('material-trace')
  })

  it.each([
    '/flows',
    '/flows/42',
    '/entry',
    '/team-production',
    '/team-production/7',
    '/processes',
    '/orders',
    '/base-data',
    '/removed-page',
  ])('redirects deprecated route %s to the transfer records', async (path) => {
    await router.push(path)
    expect(router.currentRoute.value.path).toBe('/transfer-batches')
  })

  it('keeps legacy scan links usable while preserving their query', async () => {
    await router.push('/scan?batch_no=TL001')
    expect(router.currentRoute.value.fullPath).toBe('/transfer-batches/scan?batch_no=TL001')
  })

  it('returns a team leader from administrator settings to transfer records', async () => {
    authMocks.admin = false
    await router.push('/settings/teams')
    expect(router.currentRoute.value.path).toBe('/transfer-batches')
  })
})

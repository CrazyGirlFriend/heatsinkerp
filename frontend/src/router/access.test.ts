// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ admin: false }))
vi.mock('@/stores/auth', () => ({
  currentUser: { get value() { return { role: state.admin ? 'ADMIN' : 'TEAM', team_id: state.admin ? null : 8 } } },
  isAdmin: { get value() { return state.admin } }, isAuthenticated: { value: true },
  restoreSession: vi.fn(), refreshCurrentUser: vi.fn(async () => {}),
}))
vi.mock('@/stores/access', () => ({ canEnterSite: { value: true }, checkSiteAccess: vi.fn(async () => true), SITE_ACCESS_REQUIRED_EVENT: 'test-access' }))
vi.mock('@/pages/LoginPage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/AccessPage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/FlowPreviewPage.vue', () => ({ default: { template: '<div>chain</div>' } }))
vi.mock('@/pages/TeamWorkspacePage.vue', () => ({ default: { template: '<div>team</div>' } }))
vi.mock('@/pages/FactoryStockMatrixPage.vue', () => ({ default: { template: '<div>stock matrix</div>' } }))
import router from './index'

beforeEach(() => { state.admin = false; vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
it('keeps the factory inventory matrix in the normal authenticated shell for both roles', async () => {
  for (const admin of [false, true]) {
    state.admin = admin
    await router.push('/factory-stock')
    expect(router.currentRoute.value.name).toBe('factory-stock')
    expect(router.currentRoute.value.meta.standalone).not.toBe(true)
    expect(router.currentRoute.value.meta.public).not.toBe(true)
  }
})
it('denies both full-chain URLs to team accounts, even when entered directly', async () => {
  for (const path of ['/material-trace?serial_no=000012', '/flow-preview/chain?sample=purposes']) {
    await router.push(path)
    expect(router.currentRoute.value.path).toBe('/team-workspaces/8')
  }
})
it('lets administrators open the accepted canvas from the formal menu route', async () => {
  state.admin = true
  await router.push('/material-trace?serial_no=000012')
  expect(router.currentRoute.value.name).toBe('material-trace')
  expect(router.currentRoute.value.meta.adminOnly).toBe(true)
  expect(router.currentRoute.value.meta.standalone).not.toBe(true)
})
it('preserves the scope of old team history bookmarks', async () => {
  await router.push('/material-trace?team_id=8&serial_no=000012&date_from=2026-09-18')
  expect(router.currentRoute.value.path).toBe('/team-workspaces/8')
  expect(router.currentRoute.value.query).toMatchObject({ tab: 'history', serial_no: '000012', date_from: '2026-09-18' })
})

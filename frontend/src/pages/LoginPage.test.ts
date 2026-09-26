// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type LocationQueryRaw } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage.vue'
import { adminApi, type AuthSession } from '@/services/adminApi'
import { clearSession } from '@/stores/auth'

const session: AuthSession = { access_token: 'test-only', token_type: 'Bearer', user: { id: 1, username: 'operator', display_name: '测试', role: 'ADMIN', team_id: null, team: null, active: true } }
const wrappers: VueWrapper[] = []
const originalTransition = document.startViewTransition

beforeEach(() => {
  clearSession()
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  vi.spyOn(adminApi, 'login').mockResolvedValue(session)
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  clearSession()
  document.startViewTransition = originalTransition
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderLogin(query: LocationQueryRaw = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', component: LoginPage },
    { path: '/:pathMatch(.*)*', component: { template: '<main>工作台</main>' } },
  ] })
  await router.push({ path: '/login', query }); await router.isReady()
  const wrapper = mount(LoginPage, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  return { wrapper, router }
}
async function fill(wrapper: VueWrapper) {
  await wrapper.get('#login-username').setValue('  operator  ')
  await wrapper.get('#login-password').setValue('test-password')
}

describe('login form', () => {
  it('validates required fields and announces the error without calling the server', async () => {
    const { wrapper } = await renderLogin()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('请输入登录账号')
    await wrapper.get('#login-username').setValue('operator')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('请输入登录密码')
    expect(wrapper.get('#login-password').attributes('aria-describedby')).toBe('login-error')
    expect(adminApi.login).not.toHaveBeenCalled()
  })

  it('blocks repeated submission while pending, shows server errors, and allows retry', async () => {
    let rejectLogin: (error: Error) => void = () => undefined
    vi.mocked(adminApi.login).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLogin = reject }))
    const { wrapper, router } = await renderLogin()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#login-username').attributes('disabled')).toBeDefined()
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')
    await wrapper.get('form').trigger('submit')
    expect(adminApi.login).toHaveBeenCalledOnce()
    rejectLogin(new Error('账号或密码错误')); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('账号或密码错误')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/login')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(adminApi.login).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('toggles password visibility without changing the entered value', async () => {
    const { wrapper } = await renderLogin()
    await fill(wrapper)
    await wrapper.get('button[aria-label="显示密码"]').trigger('click')
    expect(wrapper.get('#login-password').attributes('type')).toBe('text')
    expect((wrapper.get('#login-password').element as HTMLInputElement).value).toBe('test-password')
    await wrapper.get('button[aria-label="隐藏密码"]').trigger('click')
    expect(wrapper.get('#login-password').attributes('type')).toBe('password')
  })

  it('keeps the internal return destination and skips motion for reduced-motion users', async () => {
    const transition = vi.fn()
    document.startViewTransition = transition
    const { wrapper, router } = await renderLogin({ redirect: '/material-trace?serial_no=T01' })
    await fill(wrapper); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(adminApi.login).toHaveBeenCalledWith({ username: 'operator', password: 'test-password' })
    expect(router.currentRoute.value.fullPath).toBe('/material-trace?serial_no=T01')
    expect(transition).not.toHaveBeenCalled()
  })

  it('uses a successful cross-fade and rejects an external return destination for a team account', async () => {
    vi.mocked(adminApi.login).mockResolvedValue({ ...session, user: { ...session.user, role: 'TEAM', team_id: 7 } })
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    const transition = vi.fn((update: () => Promise<void>) => ({ updateCallbackDone: update() }))
    document.startViewTransition = transition as unknown as typeof document.startViewTransition
    const { wrapper, router } = await renderLogin({ redirect: '//external.example' })
    await fill(wrapper); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(transition).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/team-workspaces/7')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type LocationQueryRaw } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage.vue'
import { adminApi, type AuthSession } from '@/services/adminApi'
import { clearSession, isAuthenticated, login } from '@/stores/auth'

const session: AuthSession = {
  access_token: 'test-only',
  token_type: 'Bearer',
  user: {
    id: 1,
    username: 'operator',
    display_name: '测试',
    role: 'ADMIN',
    team_id: null,
    team: null,
    active: true,
  },
}
const wrappers: VueWrapper[] = []
const originalTransition = document.startViewTransition

beforeEach(() => {
  clearSession()
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  vi.spyOn(adminApi, 'login').mockResolvedValue(session)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  clearSession()
  document.startViewTransition = originalTransition
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderLogin(
  query: LocationQueryRaw = {},
  beforeMount?: (router: ReturnType<typeof createRouter>) => void,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginPage },
      { path: '/:pathMatch(.*)*', component: { template: '<main>工作台</main>' } },
    ],
  })
  await router.push({ path: '/login', query })
  await router.isReady()
  beforeMount?.(router)
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
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('请输入登录账号')
    await wrapper.get('#login-username').setValue('operator')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('请输入登录密码')
    expect(wrapper.get('#login-password').attributes('aria-describedby')).toBe('login-error')
    expect(adminApi.login).not.toHaveBeenCalled()
  })

  it('blocks repeated submission while pending, shows server errors, and allows retry', async () => {
    let rejectLogin: (error: Error) => void = () => undefined
    vi.mocked(adminApi.login).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLogin = reject
        }),
    )
    const { wrapper, router } = await renderLogin()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#login-username').attributes('disabled')).toBeDefined()
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')
    await wrapper.get('form').trigger('submit')
    expect(adminApi.login).toHaveBeenCalledOnce()
    rejectLogin(new Error('账号或密码错误'))
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('账号或密码错误')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/login')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(adminApi.login).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.path).toBe('/factory-analysis')
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
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(adminApi.login).toHaveBeenCalledWith({ username: 'operator', password: 'test-password' })
    expect(router.currentRoute.value.fullPath).toBe('/material-trace?serial_no=T01')
    expect(transition).not.toHaveBeenCalled()
  })

  it('uses a successful cross-fade and rejects an external return destination for a team account', async () => {
    vi.mocked(adminApi.login).mockResolvedValue({
      ...session,
      user: { ...session.user, role: 'TEAM', team_id: 7 },
    })
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    const transition = vi.fn((update: () => Promise<void>) => ({
      updateCallbackDone: update(),
      ready: Promise.resolve(),
      finished: Promise.resolve(),
    }))
    document.startViewTransition = transition as unknown as typeof document.startViewTransition
    const { wrapper, router } = await renderLogin({ redirect: '//external.example' })
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(transition).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/factory-analysis')
  })

  it('preserves a successful login and offers a full-page retry when the destination chunk fails', async () => {
    const { wrapper, router } = await renderLogin({ redirect: '/team-workspaces/15?tab=pending' })
    vi.spyOn(router, 'replace').mockRejectedValue(
      new TypeError('Failed to fetch dynamically imported module'),
    )
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(isAuthenticated.value).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('登录成功，页面加载失败')
    const retry = wrapper.get('a.login-submit')
    expect(retry.text()).toBe('刷新并进入')
    expect(retry.attributes('href')).toBe('/login?redirect=/team-workspaces/15?tab=pending')
    // Enter must not create another login session while the authenticated page is stalled.
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(adminApi.login).toHaveBeenCalledOnce()
  })

  it('handles all rejected transition promises when a route import fails', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    document.startViewTransition = vi.fn((update: () => Promise<void>) => {
      const callback = update()
      return {
        updateCallbackDone: callback,
        ready: callback.then(() => undefined),
        finished: callback.then(() => undefined),
      }
    }) as unknown as typeof document.startViewTransition
    const { wrapper, router } = await renderLogin()
    vi.spyOn(router, 'replace').mockRejectedValue(new Error('missing chunk'))
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('a.login-submit').text()).toBe('刷新并进入')
    expect(isAuthenticated.value).toBe(true)
  })

  it('handles a failed automatic redirect for a restored session without an unhandled rejection', async () => {
    await login({ username: 'operator', password: 'test-password' })
    const { wrapper } = await renderLogin({}, (router) => {
      vi.spyOn(router, 'replace').mockRejectedValue(new Error('page unavailable'))
    })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('登录成功，页面加载失败')
    expect(wrapper.get('a.login-submit').attributes('href')).toBe(
      '/login?redirect=/factory-analysis',
    )
    expect(adminApi.login).toHaveBeenCalledOnce()
  })

  it('reports an aborted navigation instead of silently remaining on the login page', async () => {
    const { wrapper, router } = await renderLogin()
    router.beforeEach(() => false)
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('登录成功，页面加载失败')
    expect(router.currentRoute.value.path).toBe('/login')
    expect(isAuthenticated.value).toBe(true)
  })

  it('keeps the refresh link internal if a transition fails with an unsafe redirect', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    document.startViewTransition = vi.fn(() => {
      throw new Error('transition unavailable')
    })
    const { wrapper } = await renderLogin({ redirect: '//external.example' })
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('a.login-submit').attributes('href')).toBe(
      '/login?redirect=/factory-analysis',
    )
    expect(isAuthenticated.value).toBe(true)
    expect(adminApi.login).toHaveBeenCalledOnce()
  })

  it.each(['ADMIN', 'TEAM'] as const)(
    'opens factory analysis after a %s login without a return destination',
    async (role) => {
      vi.mocked(adminApi.login).mockResolvedValue({
        ...session,
        user: { ...session.user, role, team_id: role === 'TEAM' ? 7 : null },
      })
      const { wrapper, router } = await renderLogin()
      await fill(wrapper)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/factory-analysis')
    },
  )
})

// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type LocationQueryRaw } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessPage from './AccessPage.vue'
import { accessHttpClient, checkSiteAccess } from '@/stores/access'
import { authState, clearSession } from '@/stores/auth'

function adapterReply(data: unknown, status = 200): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response: AxiosResponse = {
      data, status, statusText: status >= 400 ? 'Error' : 'OK', headers: new AxiosHeaders(), config,
    }
    if (status >= 400) {
      throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, undefined, response)
    }
    return response
  }
}

const originalAccessAdapter = accessHttpClient.defaults.adapter
const accessAdapter = vi.fn<AxiosAdapter>()
let wrappers: VueWrapper[] = []

beforeEach(async () => {
  clearSession()
  accessAdapter.mockReset().mockImplementation(adapterReply({ enabled: true, unlocked: false }))
  accessHttpClient.defaults.adapter = accessAdapter
  await checkSiteAccess(true)
  accessAdapter.mockClear()
})

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers = []
  clearSession()
  accessHttpClient.defaults.adapter = originalAccessAdapter
  vi.unstubAllGlobals()
})

async function mountAccessPage(query: LocationQueryRaw = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/access', name: 'access', component: AccessPage },
      { path: '/login', name: 'login', component: { template: '<div>Login</div>' } },
      { path: '/transfer-batches', name: 'transfer-batches', component: { template: '<div>Transfers</div>' } },
      { path: '/transfer-batches/scan', name: 'transfer-batch-scan', component: { template: '<div>Scan</div>' } },
    ],
  })
  await router.push({ path: '/access', query })
  await router.isReady()
  const wrapper = mount(AccessPage, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  return { wrapper, router }
}

async function expand(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('button[aria-label="解锁访问"]').trigger('click')
}

describe('minimal site access page', () => {
  it('initially shows only a lock without any input, brand, introduction, title or footer', async () => {
    const { wrapper } = await mountAccessPage()
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="解锁访问"]').exists()).toBe(true)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('h1, h2, header, footer, .login-brand').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/热沉|HEATSINK|流转管理|扫码报工|访问保护|管理员|班组|验证通过/)
    expect(wrapper.text().trim()).toBe('')
    expect(accessAdapter).not.toHaveBeenCalled()
  })

  it('expands a password field on click and collapses it with Escape', async () => {
    const { wrapper } = await mountAccessPage()
    await expand(wrapper)
    const input = wrapper.get('input[name="site-access-password"]')
    expect(input.attributes('type')).toBe('password')
    expect(input.attributes('aria-label')).toBe('访问口令')
    expect(wrapper.find('button[aria-label="确认解锁"]').exists()).toBe(true)
    await input.setValue('not-submitted')
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('input[name="site-access-password"]').exists()).toBe(false)
    await expand(wrapper)
    expect((wrapper.get('input[name="site-access-password"]').element as HTMLInputElement).value).toBe('')
    expect(accessAdapter).not.toHaveBeenCalled()
  })

  it('validates an empty password without sending an unlock request', async () => {
    const { wrapper, router } = await mountAccessPage()
    await expand(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('请输入访问口令')
    expect(accessAdapter).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/access')
  })

  it('verifies the cookie and takes a successful unlock to account login with the internal destination', async () => {
    accessAdapter
      .mockImplementationOnce(adapterReply({ unlocked: true }))
      .mockImplementationOnce(adapterReply({ enabled: true, unlocked: true }))
    const { wrapper, router } = await mountAccessPage({ redirect: '/transfer-batches/scan?mode=receive' })
    await expand(wrapper)
    await wrapper.get('input[name="site-access-password"]').setValue('test-only-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(accessAdapter).toHaveBeenNthCalledWith(1, expect.objectContaining({
      baseURL: '/api/access', url: '/unlock', method: 'post', data: JSON.stringify({ password: 'test-only-password' }),
    }))
    expect(accessAdapter).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: '/status', method: 'get' }))
    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/transfer-batches/scan?mode=receive')
  })

  it('returns an authenticated user to a safe internal page after unlocking', async () => {
    authState.session = {
      access_token: 'test-only-token',
      token_type: 'Bearer',
      user: { id: 1, username: 'test-user', display_name: 'Test', role: 'ADMIN', team_id: null, team: null, active: true },
    }
    accessAdapter
      .mockImplementationOnce(adapterReply({ unlocked: true }))
      .mockImplementationOnce(adapterReply({ enabled: true, unlocked: true }))
    const { wrapper, router } = await mountAccessPage({ redirect: '//external.example' })
    await expand(wrapper)
    await wrapper.get('input[name="site-access-password"]').setValue('test-only-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/transfer-batches')
  })

  it('keeps the user on the gate and shows the server error for a wrong password', async () => {
    accessAdapter.mockImplementationOnce(adapterReply({ detail: '访问口令错误' }, 401))
    const { wrapper, router } = await mountAccessPage()
    await expand(wrapper)
    await wrapper.get('input[name="site-access-password"]').setValue('wrong-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('访问口令错误')
    expect(router.currentRoute.value.path).toBe('/access')
    expect((wrapper.get('input[name="site-access-password"]').element as HTMLInputElement).value).toBe('')
    expect(accessAdapter).toHaveBeenCalledTimes(1)
  })

  it('retries a failed connection without revealing account login or sending an unlock request', async () => {
    accessAdapter.mockRejectedValueOnce(new AxiosError('Network Error', AxiosError.ERR_NETWORK))
    await checkSiteAccess(true)
    accessAdapter.mockClear()
    const { wrapper, router } = await mountAccessPage()
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.get('button[aria-label="重新检查连接"]').trigger('click')
    await flushPromises()
    expect(accessAdapter).toHaveBeenCalledTimes(1)
    expect(accessAdapter).toHaveBeenCalledWith(expect.objectContaining({ url: '/status', method: 'get' }))
    expect(wrapper.find('button[aria-label="解锁访问"]').exists()).toBe(true)
    expect(router.currentRoute.value.path).toBe('/access')
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)
  })

  it('disables submission controls and sends only one unlock request while a submission is pending', async () => {
    let finishUnlock: () => void = () => undefined
    accessAdapter.mockImplementationOnce((config: InternalAxiosRequestConfig) => new Promise((_resolve, reject) => {
      finishUnlock = () => {
        const response: AxiosResponse = {
          data: { detail: '访问口令错误' }, status: 401, statusText: 'Error', headers: new AxiosHeaders(), config,
        }
        reject(new AxiosError('Request failed with status code 401', AxiosError.ERR_BAD_REQUEST, config, undefined, response))
      }
    }))
    const { wrapper } = await mountAccessPage()
    await expand(wrapper)
    await wrapper.get('input[name="site-access-password"]').setValue('test-only-password')
    const form = wrapper.get('form')
    await form.trigger('submit')
    try {
      expect(wrapper.get('button[aria-label="确认解锁"]').attributes('disabled')).toBeDefined()
      expect(wrapper.get('input[name="site-access-password"]').attributes('disabled')).toBeDefined()
      await form.trigger('submit')
      expect(accessAdapter).toHaveBeenCalledTimes(1)
    } finally {
      finishUnlock()
      await flushPromises()
    }
    expect(wrapper.get('button[aria-label="确认解锁"]').attributes('disabled')).toBeUndefined()
  })
})

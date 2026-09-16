// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import LoginPage from '@/pages/LoginPage.vue'
import AccessPage from '@/pages/AccessPage.vue'
import { accessHttpClient, checkSiteAccess, notifySiteAccessRequired } from '@/stores/access'
import { authState, clearSession } from '@/stores/auth'
import { httpClient } from '@/services/httpClient'

let accessBody: unknown = { enabled: true, unlocked: false }
let accessNetworkFailure = false
const originalAccessAdapter = accessHttpClient.defaults.adapter
const originalHttpAdapter = httpClient.defaults.adapter
const accessAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  if (accessNetworkFailure) throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)
  return { data: accessBody, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config }
}
const directoryAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
  data: [], status: 200, statusText: 'OK', headers: new AxiosHeaders(), config,
})

afterEach(() => {
  clearSession()
  accessHttpClient.defaults.adapter = originalAccessAdapter
  httpClient.defaults.adapter = originalHttpAdapter
  vi.unstubAllGlobals()
})

describe('access gate rendering', () => {
  it('never reveals login or the business shell before a server check, or after errors and expiry', async () => {
    accessHttpClient.defaults.adapter = accessAdapter
    httpClient.defaults.adapter = directoryAdapter
    accessNetworkFailure = false
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginPage },
        { path: '/access', name: 'access', component: AccessPage },
        { path: '/flows', name: 'flows', component: { template: '<div>private business content</div>' } },
        { path: '/:pathMatch(.*)*', redirect: '/flows' },
      ],
    })
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)
    expect(wrapper.find('.app-shell').exists()).toBe(false)
    expect(wrapper.text()).toContain('正在检查访问权限')

    accessBody = { enabled: true, unlocked: false }
    await checkSiteAccess(true)
    await nextTick()
    expect(wrapper.find('input[name="site-access-password"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="解锁访问"]').trigger('click')
    expect(wrapper.find('input[name="site-access-password"]').exists()).toBe(true)
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)

    accessNetworkFailure = true
    await checkSiteAccess(true)
    await nextTick()
    expect(wrapper.find('button[aria-label="重新检查连接"]').exists()).toBe(true)
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)
    expect(wrapper.find('.app-shell').exists()).toBe(false)

    accessNetworkFailure = false
    accessBody = { enabled: false, unlocked: true }
    await checkSiteAccess(true)
    await nextTick()
    expect(wrapper.find('input[name="username"]').exists()).toBe(true)
    expect(wrapper.find('input[name="site-access-password"]').exists()).toBe(false)

    authState.session = {
      access_token: 'test-only-token', token_type: 'Bearer',
      user: { id: 1, username: 'tester', display_name: 'Tester', role: 'TEAM', team_id: 1, team: null, active: true },
    }
    await router.push('/flows')
    expect(wrapper.find('.app-shell').exists()).toBe(true)
    expect(wrapper.text()).toContain('private business content')
    notifySiteAccessRequired()
    await nextTick()
    expect(wrapper.find('.app-shell').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('private business content')
    expect(wrapper.find('input[name="site-access-password"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="解锁访问"]').trigger('click')
    expect(wrapper.find('input[name="site-access-password"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

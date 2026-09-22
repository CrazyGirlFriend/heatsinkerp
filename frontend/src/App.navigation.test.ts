// @vitest-environment jsdom
import { AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/services/teamDirectoryApi', () => ({ teamDirectoryApi: { listTeamDirectory: mocks.list } }))

import App from './App.vue'
import FactorySidebar from '@/components/FactorySidebar.vue'
import { accessHttpClient, checkSiteAccess } from '@/stores/access'
import { authState, clearSession } from '@/stores/auth'

const wrappers: VueWrapper[] = []
const originalAccessAdapter = accessHttpClient.defaults.adapter
const accessAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
  data: { enabled: true, unlocked: true }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config,
})

beforeEach(async () => {
  clearSession()
  mocks.list.mockReset().mockResolvedValue([{ id: 1, code: 'FACTORY-ROLL', name: '扎板', active: true }])
  accessHttpClient.defaults.adapter = accessAdapter
  await checkSiteAccess(true)
  authState.session = { access_token: 'navigation-account', token_type: 'Bearer', user: { id: 1, username: 'test', display_name: '测试', role: 'ADMIN', team_id: null, team: null, active: true } }
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  clearSession()
  accessHttpClient.defaults.adapter = originalAccessAdapter
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderApp(mobile: boolean) {
  let viewportChanged: () => void = () => undefined
  const media = {
    matches: mobile,
    addEventListener: vi.fn((_event: string, callback: () => void) => { viewportChanged = callback }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media))
  const page = { template: '<div>转料记录</div>' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/transfer-batches', component: page }, { path: '/transfer-batches/scan', component: page },
    { path: '/material-trace', component: page },
    { path: '/factory-live', component: { template: '<section>独立机器人大屏</section>' }, meta: { standalone: true } },
    { path: '/settings/teams', component: page }, { path: '/settings/accounts', component: page },
    { path: '/:pathMatch(.*)*', component: page },
  ] })
  await router.push('/transfer-batches')
  await router.isReady()
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  async function setMobile(matches: boolean) {
    media.matches = matches
    viewportChanged()
    await nextTick()
  }
  return { wrapper, router, setMobile }
}

describe('application navigation shell', () => {
  it('keeps the same business shell and illustrated navigation across all normal pages', async () => {
    const { wrapper, router } = await renderApp(false)
    for (const path of ['/', '/factory-stock', '/team-workspaces/1', '/transfer-batches', '/transfer-batches/scan', '/material-trace', '/settings/teams', '/settings/accounts', '/factory-analysis']) {
      await router.push(path); await flushPromises()
      expect(wrapper.get('.app-shell').classes()).toContain('app-shell--business')
      expect(wrapper.getComponent(FactorySidebar).props('illustrated')).toBe(true)
    }
  })

  it('opens the robot route without the business shell and restores navigation on return', async () => {
    const { wrapper, router } = await renderApp(false)
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    try {
      await wrapper.get('.topbar__screen').trigger('click', { button: 0 })
      await flushPromises()
      expect(requestFullscreen).toHaveBeenCalledOnce()
      expect(router.currentRoute.value.path).toBe('/factory-live')
      expect(wrapper.get('.standalone-screen').text()).toContain('独立机器人大屏')
      expect(wrapper.find('.app-shell').exists()).toBe(false)
      expect(wrapper.find('.topbar').exists()).toBe(false)
      expect(wrapper.find('#factory-sidebar').exists()).toBe(false)
      await router.push('/transfer-batches'); await flushPromises()
      expect(wrapper.find('.standalone-screen').exists()).toBe(false)
      expect(wrapper.find('.topbar').exists()).toBe(true)
    } finally { Reflect.deleteProperty(document.documentElement, 'requestFullscreen') }
  })

  it('keeps the standalone route usable when browser fullscreen is rejected', async () => {
    const { wrapper } = await renderApp(false)
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: vi.fn().mockRejectedValue(new Error('Not allowed')) })
    try {
      await wrapper.get('.topbar__screen').trigger('click', { button: 0 }); await flushPromises()
      expect(wrapper.find('.standalone-screen').exists()).toBe(true)
    } finally { Reflect.deleteProperty(document.documentElement, 'requestFullscreen') }
  })

  it('keeps the closed mobile menu inert, supports Escape, and closes after navigation', async () => {
    const { wrapper, router } = await renderApp(true)
    const menu = wrapper.get('.topbar__menu')
    const main = wrapper.get('#main-content')
    expect(menu.attributes('aria-expanded')).toBe('false')
    expect(main.attributes('tabindex')).toBe('-1')
    expect(main.attributes('inert')).toBeUndefined()
    expect(wrapper.get('#factory-sidebar').attributes('inert')).toBeDefined()
    expect(wrapper.get('#factory-sidebar').attributes('aria-hidden')).toBe('true')
    await menu.trigger('click')
    expect(menu.attributes('aria-expanded')).toBe('true')
    expect(menu.attributes('inert')).toBeUndefined()
    expect(main.attributes('inert')).toBeDefined()
    expect(main.attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.skip-link').attributes('inert')).toBeDefined()
    expect(wrapper.get('.brand').attributes('inert')).toBeDefined()
    expect(wrapper.get('.topbar__account').attributes('inert')).toBeDefined()
    expect(wrapper.get('#factory-sidebar').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(wrapper.get('#factory-sidebar [role="menubar"]').element)
    // jsdom has no layout. Model only the first and last visible controls to
    // verify both keyboard boundaries without relying on artificial CSS layout.
    const first = wrapper.get('#factory-sidebar [role="menubar"]').element as HTMLElement
    const last = wrapper.get('#factory-sidebar [aria-label="班组长管理"]').element as HTMLElement
    const rects = [new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList
    vi.spyOn(first, 'getClientRects').mockReturnValue(rects)
    vi.spyOn(last, 'getClientRects').mockReturnValue(rects)
    await wrapper.get('#factory-sidebar').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    await wrapper.get('#factory-sidebar').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    await wrapper.get('#factory-sidebar').trigger('keydown', { key: 'Escape' })
    expect(menu.attributes('aria-expanded')).toBe('false')
    expect(main.attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(menu.element)
    await menu.trigger('click')
    await router.push('/transfer-batches/scan')
    await flushPromises()
    expect(menu.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('#factory-sidebar').attributes('inert')).toBeDefined()
    expect(main.attributes('inert')).toBeUndefined()
    expect(wrapper.get('.brand').attributes('inert')).toBeUndefined()
    expect(wrapper.get('.topbar__account').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(main.element)
  })

  it('offers a skip link that moves focus to the main content', async () => {
    const { wrapper } = await renderApp(false)
    const skipLink = wrapper.get('.skip-link')
    const main = wrapper.get('#main-content')

    expect(skipLink.attributes('href')).toBe('#main-content')
    expect(main.attributes('tabindex')).toBe('-1')
    await skipLink.trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(main.element)
  })

  it('keeps all phase-one destinations available in desktop compact mode', async () => {
    const { wrapper } = await renderApp(false)
    expect(wrapper.get('#factory-sidebar').attributes('inert')).toBeUndefined()
    expect(wrapper.get('.app-shell').classes()).not.toContain('app-shell--compact')
    expect(wrapper.get('.brand-mark img').attributes('src')).toBe('/brand/attl-official-logo.png')
    expect(wrapper.get('.brand-mark').attributes('aria-label')).toBe('安泰天龙 · 热沉物料')
    await wrapper.get('.sidebar__collapse').trigger('click')
    expect(wrapper.get('.app-shell').classes()).toContain('app-shell--compact')
    expect(wrapper.getComponent(FactorySidebar).props('compact')).toBe(true)
    expect(wrapper.get('.brand-mark img').attributes('src')).toBe('/brand/attl-official-favicon.ico')
    await wrapper.get('.sidebar__collapse').trigger('click')
    expect(wrapper.getComponent(FactorySidebar).props('compact')).toBe(false)
    expect(wrapper.get('.brand-mark img').attributes('src')).toBe('/brand/attl-official-logo.png')
    expect(wrapper.get('#factory-sidebar [aria-label="轧制工作台"]').text()).toBe('轧制')
    expect(wrapper.get('#factory-sidebar [aria-label="转料记录"]').text()).toBe('转料记录')
  })

  it('uses full labels on mobile and restores the desktop compact preference on resize', async () => {
    const { wrapper, setMobile } = await renderApp(false)
    await wrapper.get('.sidebar__collapse').trigger('click')
    expect(wrapper.getComponent(FactorySidebar).props('compact')).toBe(true)
    await setMobile(true)
    expect(wrapper.getComponent(FactorySidebar).props('compact')).toBe(false)
    expect(wrapper.get('#factory-sidebar').attributes('inert')).toBeDefined()
    await wrapper.get('.topbar__menu').trigger('click')
    expect(wrapper.get('#factory-sidebar').classes()).toContain('sidebar--open')
    await setMobile(false)
    expect(wrapper.getComponent(FactorySidebar).props('compact')).toBe(true)
    expect(wrapper.get('#factory-sidebar').attributes('inert')).toBeUndefined()
    expect(wrapper.get('#factory-sidebar').classes()).not.toContain('sidebar--open')
    expect(wrapper.find('.sidebar-mask').exists()).toBe(false)
  })
})

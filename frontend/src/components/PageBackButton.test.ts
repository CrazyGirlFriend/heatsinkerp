// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type RouteLocationRaw } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PageBackButton from './PageBackButton.vue'
import { authState, clearSession } from '@/stores/auth'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  authState.session = { access_token: 'test-back', token_type: 'Bearer', user: { id: 1, username: 'admin', display_name: '管理员', role: 'ADMIN', team_id: null, team: null, active: true } }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; clearSession() })

async function render(path: string, back?: unknown, fallback?: RouteLocationRaw) {
  const component = { template: '<div />' }
  const history = createMemoryHistory()
  const router = createRouter({ history, routes: [
    { path: '/', component },
    { path: '/factory-analysis', component },
    { path: '/team-workspaces/:teamId', component },
    { path: '/transfer-batches', component },
    { path: '/material-trace', component, meta: { adminOnly: true } },
    { path: '/flow-preview/:view', component },
    { path: '/settings/teams', component, meta: { adminOnly: true } },
    { path: '/settings/accounts', component, meta: { adminOnly: true } },
    { path: '/login', component, meta: { public: true } },
    { path: '/access', component, meta: { public: true } },
    { path: '/:pathMatch(.*)*', redirect: '/transfer-batches' },
  ] })
  if (typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')) await router.push(back)
  await router.push(path)
  // Memory history does not populate the browser history's `back` field itself.
  history.replace(path, { ...history.state, back: back as string ?? null })
  wrapper = mount(PageBackButton, { props: { fallback }, global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('basic page back navigation', () => {
  it('returns to the previous business page instead of the module fallback', async () => {
    const previous = '/team-workspaces/7?tab=pending&query=001'
    const { wrapper, router } = await render('/factory-analysis', previous)
    expect(wrapper.get('button').text()).toBe('返回')
    expect(wrapper.get('button').attributes('title')).toBe('返回上一页')
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(previous)
  })

  it('also goes back across sections in the same team', async () => {
    const { wrapper, router } = await render('/team-workspaces/7?tab=history', '/team-workspaces/7?tab=outgoing')
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/7?tab=outgoing')
  })

  it.each([undefined, null, '/login?redirect=/factory-analysis', '/access', 'https://outside.example', '//outside.example', '/unknown', '/factory-analysis'])('does not go to an external, auth, unknown or identical previous entry: %s', async back => {
    const { wrapper, router } = await render('/factory-analysis', back)
    expect(wrapper.get('button').attributes('title')).toBe('返回所属模块首页')
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it.each([
    ['/team-workspaces/7?tab=outgoing', '/team-workspaces/7'],
    ['/settings/accounts', '/settings/teams'],
    ['/material-trace', '/transfer-batches'],
    ['/settings/teams', '/'],
    ['/transfer-batches', '/'],
  ])('uses a useful fallback when %s is opened directly', async (path, expected) => {
    const { wrapper, router } = await render(path)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(expected)
  })

  it('preserves the flow preview business fallback', async () => {
    const { wrapper, router } = await render('/flow-preview/team', undefined, { path: '/team-workspaces/7', query: { tab: 'history', serial_no: '001' } })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/7?tab=history&serial_no=001')
  })

  it('hides on a direct homepage but remains available when reached from another page', async () => {
    const direct = await render('/')
    expect(direct.wrapper.find('button').exists()).toBe(false)
    direct.wrapper.unmount()
    const visited = await render('/', '/transfer-batches')
    expect(visited.wrapper.find('button').exists()).toBe(true)
  })

  it('uses the bound team home and avoids administrative history for team accounts', async () => {
    authState.session!.user.role = 'TEAM'; authState.session!.user.team_id = 7
    const { wrapper, router } = await render('/transfer-batches', '/settings/accounts')
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/team-workspaces/7')
    expect(wrapper.find('button').exists()).toBe(false)
    await router.replace('/team-workspaces/7?tab=stock'); await flushPromises()
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('honors existing navigation guards when falling back', async () => {
    const { wrapper, router } = await render('/settings/accounts')
    const removeGuard = router.beforeEach(() => false)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings/accounts')
    removeGuard()
  })
})

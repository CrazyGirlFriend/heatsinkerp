// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import FactorySidebar from './FactorySidebar.vue'
import { ElMenu, ElMenuItem, ElSubMenu } from 'element-plus'
import { authState, clearSession } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { appPinia } from '@/stores/access'

const wrappers: VueWrapper[] = []

function signIn(role: 'ADMIN' | 'TEAM' = 'ADMIN'): void {
  authState.session = {
    access_token: `sidebar-${role}`,
    token_type: 'Bearer',
    user: {
      id: role,
      username: role.toLowerCase(),
      display_name: role === 'ADMIN' ? '系统管理员' : '扎板班组长',
      role,
      active: true,
      team_id: role === 'TEAM' ? 2 : null,
      team: role === 'TEAM' ? { id: 2, code: 'ZB', name: '扎板', active: true } : null,
    },
  }
}

async function renderSidebar(path = '/transfer-batches', compact = false) {
  const page = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: page },
      { path: '/factory-stock', component: page },
      { path: '/transfer-batches', component: page },
      { path: '/transfer-batches/scan', component: page },
      { path: '/material-trace', component: page },
      { path: '/settings/teams', component: page },
      { path: '/settings/accounts', component: page },
      { path: '/team-workspaces/:teamId', component: page },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(FactorySidebar, { props: { compact }, global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  clearSession()
  signIn()
  const directory = useTeamDirectoryStore(appPinia)
  directory.items = []; directory.loaded = true; directory.loading = false; directory.error = ''
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  clearSession()
})

describe('three-level team navigation', () => {
  it('groups all eight teams under one parent, using real ids only', async () => {
    const directory = useTeamDirectoryStore(appPinia)
    directory.items = [
      { id: 7, code: 'FACTORY-ROLL', name: '扎板', active: true },
      { id: 8, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true },
      { id: 9, code: 'DEMO', name: '退火', active: true },
    ]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7')
    const groups = wrapper.findAllComponents(ElSubMenu)
    expect(groups.map(group => group.props('index'))).toEqual(['factory', 'teams', 'team-8', 'team-7', 'materials', 'settings'])
    const teams = groups.find(group => group.props('index') === 'teams')!
    expect(teams.findAllComponents(ElSubMenu).map(item => item.props('index'))).toEqual(['team-8', 'team-7'])
    expect(teams.find('[aria-label="库房 · 入库记录"]').exists()).toBe(true)
    expect(teams.find('[aria-label="轧制 · 入库记录"]').exists()).toBe(false)
    expect(wrapper.findAll('.factory-nav__missing')).toHaveLength(6)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制 · 库存明细')
    await router.push('/transfer-batches/scan'); await nextTick()
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('扫码查询')
  })

  it('keeps all eight team headings and opens only one team branch at a time', async () => {
    const { teamWorkspaceProfiles } = await import('@/config/teamWorkspaces')
    useTeamDirectoryStore(appPinia).items = teamWorkspaceProfiles.map((profile, index) => ({ id: index + 1, code: profile.code, name: profile.name, active: true, kind: index === 0 ? 'warehouse' : 'production' }))
    const { wrapper, router } = await renderSidebar('/team-workspaces/4?tab=outgoing&query=铜&page=2')
    expect(wrapper.findAll('.factory-nav__team')).toHaveLength(8)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('研磨 · 出库记录')
    expect(wrapper.get('[aria-label="研磨工作台"]').attributes('aria-expanded')).toBe('true')
    await wrapper.get('[aria-label="轧制工作台"] > .el-sub-menu__title').trigger('click')
    expect(wrapper.get('[aria-label="研磨工作台"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[aria-label="轧制工作台"]').attributes('aria-expanded')).toBe('true')
    await wrapper.get('[aria-label="轧制 · 待接收"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/2?tab=pending')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制 · 待接收')
    await router.back(); await flushPromises()
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('研磨 · 出库记录')
    expect(wrapper.get('[aria-label="研磨工作台"]').attributes('aria-expanded')).toBe('true')
    await wrapper.setProps({ compact: true }); await wrapper.setProps({ compact: false }); await flushPromises()
    expect(wrapper.get('[aria-label="研磨工作台"]').attributes('aria-expanded')).toBe('true')
  })

  it('normalizes old links and shows a live count only for its matching team', async () => {
    useTeamDirectoryStore(appPinia).items = [{ id: 7, code: 'FACTORY-ROLL', name: '轧制', active: true }]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7?tab=overview')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制 · 收发历史')
    await wrapper.setProps({ pendingTeamId: 7, pendingCount: 23 })
    expect(wrapper.get('[aria-label="轧制 · 待接收"] small').text()).toBe('23')
    await wrapper.setProps({ pendingCount: 24 })
    expect(wrapper.get('[aria-label="轧制 · 待接收"] small').text()).toBe('24')
    await wrapper.setProps({ pendingTeamId: 8 })
    expect(wrapper.find('.factory-nav__count').exists()).toBe(false)
    await router.push('/team-workspaces/7?direction=incoming&query=铜'); await flushPromises()
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制 · 待接收')
  })

  it('expands and folds a first-level group without promoting its children', async () => {
    const { wrapper } = await renderSidebar('/team-workspaces/7')
    const teamGroup = wrapper.findAllComponents(ElSubMenu).find(group => group.props('index') === 'teams')!
    expect(teamGroup.attributes('aria-expanded')).toBe('true')
    await teamGroup.get('.el-sub-menu__title').trigger('click')
    expect(teamGroup.attributes('aria-expanded')).toBe('false')
    await teamGroup.get('.el-sub-menu__title').trigger('click')
    expect(teamGroup.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.el-menu').findAll(':scope > .el-sub-menu')).toHaveLength(4)
  })

  it('keeps exactly the same four parent groups when the entire sidebar collapses', async () => {
    const { wrapper } = await renderSidebar()
    await wrapper.setProps({ compact: true })
    expect(wrapper.getComponent(ElMenu).props('collapse')).toBe(true)
    expect(wrapper.findAllComponents(ElSubMenu).map(group => group.props('index'))).toEqual(['factory', 'teams', 'materials', 'settings'])
    await wrapper.setProps({ compact: false })
    expect(wrapper.getComponent(ElMenu).props('collapse')).toBe(false)
    expect(wrapper.findAllComponents(ElSubMenu).map(group => group.props('index'))).toEqual(['factory', 'teams', 'materials', 'settings'])
  })

  it('routes leaf selections to the existing pages', async () => {
    const { wrapper, router } = await renderSidebar()
    await wrapper.get('[aria-label="全链路追踪"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/material-trace')
  })

  it('never exposes system settings to team leaders', async () => {
    signIn('TEAM')
    const { wrapper } = await renderSidebar()
    expect(wrapper.findAllComponents(ElSubMenu).map(group => group.props('index'))).toEqual(['factory', 'teams', 'materials'])
    expect(wrapper.find('[aria-label="班组管理"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="班组长管理"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="全链路追踪"]').exists()).toBe(false)
  })

  it('groups the overview and material matrix under the factory menu and preserves active selection', async () => {
    const { wrapper, router } = await renderSidebar('/factory-stock')
    const group = wrapper.findAllComponents(ElSubMenu).find(item => item.props('index') === 'factory')!
    expect(group.attributes('aria-expanded')).toBe('true')
    expect(group.findAllComponents(ElMenuItem).map(item => item.props('index'))).toEqual(['/', '/factory-stock'])
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('库存明细')
    await wrapper.get('[aria-label="库存总览"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('库存总览')
  })
})

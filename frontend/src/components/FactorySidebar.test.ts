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

describe('two-level material navigation', () => {
  it('groups all eight teams under one parent, using real ids only', async () => {
    const directory = useTeamDirectoryStore(appPinia)
    directory.items = [
      { id: 7, code: 'FACTORY-ROLL', name: '扎板', active: true },
      { id: 8, code: 'FACTORY-WAREHOUSE', name: '库房', active: true },
      { id: 9, code: 'DEMO', name: '退火', active: true },
    ]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7')
    const groups = wrapper.findAllComponents(ElSubMenu)
    expect(groups.map(group => group.props('index'))).toEqual(['teams', 'materials', 'settings'])
    const teams = groups.find(group => group.props('index') === 'teams')!
    expect(teams.findAllComponents(ElSubMenu)).toHaveLength(0)
    expect(teams.findAllComponents(ElMenuItem).filter(item => !item.props('disabled')).map(item => item.props('index'))).toEqual(['/team-workspaces/8', '/team-workspaces/7'])
    expect(wrapper.findAll('.factory-nav__missing')).toHaveLength(6)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
    await router.push('/transfer-batches/scan'); await nextTick()
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('扫码查询')
  })

  it('expands and folds a first-level group without promoting its children', async () => {
    const { wrapper } = await renderSidebar('/team-workspaces/7')
    const teamGroup = wrapper.findAllComponents(ElSubMenu).find(group => group.props('index') === 'teams')!
    expect(teamGroup.attributes('aria-expanded')).toBe('true')
    await teamGroup.get('.el-sub-menu__title').trigger('click')
    expect(teamGroup.attributes('aria-expanded')).toBe('false')
    await teamGroup.get('.el-sub-menu__title').trigger('click')
    expect(teamGroup.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.el-menu').findAll(':scope > .el-sub-menu')).toHaveLength(3)
  })

  it('keeps exactly the same three parent groups when the entire sidebar collapses', async () => {
    const { wrapper } = await renderSidebar()
    await wrapper.setProps({ compact: true })
    expect(wrapper.getComponent(ElMenu).props('collapse')).toBe(true)
    expect(wrapper.findAllComponents(ElSubMenu).map(group => group.props('index'))).toEqual(['teams', 'materials', 'settings'])
    await wrapper.setProps({ compact: false })
    expect(wrapper.getComponent(ElMenu).props('collapse')).toBe(false)
    expect(wrapper.findAllComponents(ElSubMenu).map(group => group.props('index'))).toEqual(['teams', 'materials', 'settings'])
  })

  it('routes leaf selections to the existing pages', async () => {
    const { wrapper, router } = await renderSidebar()
    await wrapper.get('[aria-label="流水号追踪"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/material-trace')
  })

  it('never exposes system settings to team leaders', async () => {
    signIn('TEAM')
    const { wrapper } = await renderSidebar()
    expect(wrapper.findAllComponents(ElSubMenu).map(group => group.props('index'))).toEqual(['teams', 'materials'])
    expect(wrapper.find('[aria-label="班组管理"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="班组长管理"]').exists()).toBe(false)
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactorySidebar from './FactorySidebar.vue'
import { ElMenu, ElMenuItem, ElSubMenu } from 'element-plus'
import { DataAnalysis, Grid } from '@element-plus/icons-vue'
import { authState, clearSession } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { appPinia } from '@/stores/access'
import { useSidebarStore } from '@/stores/sidebar'

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
      { path: '/factory-stock', redirect: '/' },
      { path: '/factory-analysis', component: page },
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
  localStorage.clear()
  signIn()
  const directory = useTeamDirectoryStore(appPinia)
  directory.items = []; directory.loaded = true; directory.loading = false; directory.error = ''
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  clearSession()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('two-level team navigation', () => {
  it('keeps the current module badge on the actual page when other modules open or fold', async () => {
    useTeamDirectoryStore(appPinia).items = [{ id: 7, code: 'FACTORY-PLATE', name: '电镀', active: true }]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7?tab=stock')
    const current = () => wrapper.get('.factory-nav__current')
    expect(current().attributes('aria-label')).toBe('班组工作台')
    expect(current().attributes('aria-description')).toBe('当前页面所属模块')
    expect(wrapper.findAll('.factory-nav__current-badge')).toHaveLength(1)
    expect(current().get('.factory-nav__current-badge').text()).toBe('当前')
    await wrapper.get('[aria-label="全厂总览"] > .el-sub-menu__title').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/7?tab=stock')
    expect(current().attributes('aria-expanded')).toBe('false')
    expect(current().find('.factory-nav__current-badge').exists()).toBe(true)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('电镀工作台')
    await wrapper.get('[aria-label="全厂总览"] > .el-sub-menu__title').trigger('click'); await flushPromises()
    expect(current().attributes('aria-label')).toBe('班组工作台')
    for (const [path, module] of [['/factory-analysis', '全厂总览'], ['/', '全厂总览'], ['/transfer-batches', '流转查询'], ['/settings/accounts', '系统设置'], ['/team-workspaces/7?tab=outgoing', '班组工作台']]) {
      await router.push(path!); await flushPromises()
      expect(wrapper.findAll('.factory-nav__current-badge')).toHaveLength(1)
      expect(current().attributes('aria-label')).toBe(module)
    }
    await router.back(); await flushPromises()
    expect(current().attributes('aria-label')).toBe('系统设置')
  })

  it('retains the current module in compact mode without squeezing a text badge into the icon rail', async () => {
    const { wrapper } = await renderSidebar('/transfer-batches')
    await wrapper.setProps({ compact: true }); await flushPromises()
    expect(wrapper.get('.factory-nav__current').attributes('aria-label')).toBe('流转查询')
    expect(wrapper.get('.factory-nav__current').attributes('aria-description')).toBe('当前页面所属模块')
    expect(wrapper.find('.factory-nav__current-badge').exists()).toBe(false)
    await wrapper.setProps({ compact: false }); await flushPromises()
    expect(wrapper.get('.factory-nav__current-badge').text()).toBe('当前')
  })

  it('preserves a manually opened parent during directory refreshes, section and filter changes', async () => {
    const directory = useTeamDirectoryStore(appPinia)
    directory.items = [{ id: 7, code: 'FACTORY-ROLL', name: '轧制', active: true }, { id: 8, code: 'FACTORY-QC', name: '检验', active: true }]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7?tab=outgoing')
    await wrapper.get('[aria-label="流转查询"] > .el-sub-menu__title').trigger('click')
    directory.items = directory.items.map(team => ({ ...team }))
    await router.push('/team-workspaces/7?tab=outgoing&query=铜&page=2'); await flushPromises()
    expect(wrapper.get('[aria-label="流转查询"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[aria-label="班组工作台"]').attributes('aria-expanded')).toBe('false')
    await wrapper.setProps({ compact: true }); await wrapper.setProps({ compact: false }); await flushPromises()
    expect(wrapper.get('[aria-label="流转查询"]').attributes('aria-expanded')).toBe('true')
    await router.push('/team-workspaces/7?tab=pending'); await flushPromises()
    expect(wrapper.get('[aria-label="班组工作台"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
    await router.push('/team-workspaces/8'); await flushPromises()
    expect(wrapper.get('[aria-label="班组工作台"]').attributes('aria-expanded')).toBe('true')
  })

  it('restores a deliberately folded branch after remounting', async () => {
    const { wrapper } = await renderSidebar('/factory-stock')
    await wrapper.get('[aria-label="全厂总览"] > .el-sub-menu__title').trigger('click')
    expect(useSidebarStore(appPinia).opened).toEqual([])
    wrapper.unmount()
    const restored = await renderSidebar('/factory-stock')
    expect(restored.wrapper.get('[aria-label="全厂总览"]').attributes('aria-expanded')).toBe('false')
    expect(restored.wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('班组材质库存')
  })

  it('waits for the team directory before restoring a saved section and manual branch', async () => {
    const directory = useTeamDirectoryStore(appPinia)
    directory.loaded = false; directory.loading = true
    const sidebar = useSidebarStore(appPinia)
    sidebar.page = '/team-workspaces/8'; sidebar.opened = ['materials']
    const { wrapper } = await renderSidebar('/team-workspaces/8?tab=history')
    expect(sidebar.page).toBe('/team-workspaces/8')
    directory.items = [{ id: 7, code: 'FACTORY-ROLL', name: '轧制', active: true }, { id: 8, code: 'FACTORY-QC', name: '检验', active: true }]
    directory.loaded = true; directory.loading = false
    await flushPromises()
    expect(sidebar.opened).toEqual(['materials'])
    expect(wrapper.get('[aria-label="流转查询"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[aria-label="班组工作台"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('检验工作台')
  })

  it('does not overwrite saved preferences with the temporary route during initial authentication', async () => {
    useTeamDirectoryStore(appPinia).items = [{ id: 7, code: 'FACTORY-ROLL', name: '轧制', active: true }, { id: 8, code: 'FACTORY-QC', name: '检验', active: true }]
    const sidebar = useSidebarStore(appPinia)
    sidebar.page = '/team-workspaces/8'; sidebar.opened = ['materials']
    const history = createMemoryHistory()
    history.push('/team-workspaces/8?tab=history')
    const router = createRouter({ history, routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div />' } }] })
    let release: () => void = () => undefined
    router.beforeEach(() => new Promise<void>(resolve => { release = resolve }))
    const wrapper = mount(FactorySidebar, { global: { plugins: [router] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(sidebar.page).toBe('/team-workspaces/8')
    release(); await router.isReady(); await flushPromises()
    expect(sidebar.opened).toEqual(['materials'])
    expect(wrapper.get('[aria-label="流转查询"]').attributes('aria-expanded')).toBe('true')
  })

  it('shows scroll controls when menus overflow, scrolls only navigation, and disconnects observation', async () => {
    const observe = vi.fn(), disconnect = vi.fn()
    let resize: () => void = () => undefined
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe = observe; disconnect = disconnect; unobserve = vi.fn() })
    const { wrapper } = await renderSidebar()
    const viewport = wrapper.get('.factory-nav__scroll').element as HTMLElement
    Object.defineProperties(viewport, { clientHeight: { value: 300 }, scrollHeight: { value: 600 } })
    resize(); await nextTick()
    expect(wrapper.find('[aria-label="向上滚动导航"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="向下滚动导航"]').exists()).toBe(true)
    await wrapper.get('[aria-label="向下滚动导航"]').trigger('click')
    expect(viewport.scrollTop).toBe(195)
    expect(wrapper.find('[aria-label="向上滚动导航"]').exists()).toBe(true)
    viewport.scrollTop = 300
    await wrapper.get('.factory-nav__scroll').trigger('scroll')
    expect(wrapper.find('[aria-label="向下滚动导航"]').exists()).toBe(false)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('groups all eight teams under one parent, using real ids only', async () => {
    const directory = useTeamDirectoryStore(appPinia)
    directory.items = [
      { id: 7, code: 'FACTORY-ROLL', name: '扎板', active: true },
      { id: 8, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true },
      { id: 9, code: 'DEMO', name: '退火', active: true },
    ]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7')
    const groups = wrapper.findAllComponents(ElSubMenu)
    expect(groups.map(group => group.props('index'))).toEqual(['factory', 'teams', 'materials', 'settings'])
    const teams = groups.find(group => group.props('index') === 'teams')!
    expect(teams.findAllComponents(ElSubMenu)).toHaveLength(0)
    expect(teams.findAllComponents(ElMenuItem).filter(item => !item.props('disabled')).map(item => item.props('index'))).toEqual(['/team-workspaces/8', '/team-workspaces/7'])
    expect(wrapper.findAll('.factory-nav__missing')).toHaveLength(6)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
    await router.push('/transfer-batches?scan=1'); await nextTick()
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('转料记录')
    expect(wrapper.find('[aria-label="扫码查询"]').exists()).toBe(false)
    expect(groups.find(group => group.props('index') === 'materials')!.findAllComponents(ElMenuItem).map(item => item.attributes('aria-label'))).toEqual(['转料记录', '全链路追踪'])
  })

  it('keeps all eight teams directly clickable and restores selection on browser back', async () => {
    const { teamWorkspaceProfiles } = await import('@/config/teamWorkspaces')
    useTeamDirectoryStore(appPinia).items = teamWorkspaceProfiles.map((profile, index) => ({ id: index + 1, code: profile.code, name: profile.name, active: true, kind: index === 0 ? 'warehouse' : 'production' }))
    const { wrapper, router } = await renderSidebar('/team-workspaces/4?tab=outgoing&query=铜&page=2')
    expect(wrapper.findAll('.factory-nav__team')).toHaveLength(8)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('研磨工作台')
    expect(wrapper.find('.factory-nav__team .el-sub-menu__icon-arrow').exists()).toBe(false)
    await wrapper.get('[aria-label="轧制工作台"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/2')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
    await router.back(); await flushPromises()
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('研磨工作台')
    expect(router.currentRoute.value.query).toEqual({ tab: 'outgoing', query: '铜', page: '2' })
    await wrapper.setProps({ compact: true }); await wrapper.setProps({ compact: false }); await flushPromises()
    expect(wrapper.get('[aria-label="班组工作台"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('研磨工作台')
  })

  it('highlights the team for old section links without recreating section menus', async () => {
    useTeamDirectoryStore(appPinia).items = [{ id: 7, code: 'FACTORY-ROLL', name: '轧制', active: true }]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7?tab=overview')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
    expect(wrapper.find('.factory-nav__workspace-link').exists()).toBe(false)
    await router.push('/team-workspaces/7?direction=incoming&query=铜'); await flushPromises()
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
  })

  it('returns to the default inventory section when selecting the team again', async () => {
    useTeamDirectoryStore(appPinia).items = [{ id: 7, code: 'FACTORY-ROLL', name: '轧制', active: true }]
    const { wrapper, router } = await renderSidebar('/team-workspaces/7?tab=outgoing')
    await wrapper.get('[aria-label="轧制工作台"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/team-workspaces/7')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('轧制工作台')
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

  it('puts analysis before stock with distinct matching icons and keeps routes and legacy bookmarks selected correctly', async () => {
    const { wrapper, router } = await renderSidebar('/factory-stock')
    await wrapper.setProps({ illustrated: true })
    const group = wrapper.findAllComponents(ElSubMenu).find(item => item.props('index') === 'factory')!
    expect(group.attributes('aria-expanded')).toBe('true')
    expect(group.findAllComponents(ElMenuItem).map(item => item.props('index'))).toEqual(['/factory-analysis', '/'])
    const analysis = group.findAllComponents(ElMenuItem).find(item => item.props('index') === '/factory-analysis')!
    const stock = group.findAllComponents(ElMenuItem).find(item => item.props('index') === '/')!
    expect(analysis.findComponent(DataAnalysis).exists()).toBe(true)
    expect(stock.findComponent(Grid).exists()).toBe(true)
    for (const item of [analysis, stock]) {
      expect(item.get('.el-icon').classes()).toContain('factory-nav__team-icon')
      expect(item.get('.el-icon').attributes('aria-hidden')).toBe('true')
    }
    expect(wrapper.find('[aria-label="库存明细"]').exists()).toBe(false)
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('班组材质库存')
    await wrapper.get('[aria-label="全厂数据分析"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/factory-analysis')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('全厂数据分析')
    expect(group.attributes('aria-expanded')).toBe('true')
    await wrapper.get('[aria-label="班组材质库存"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('班组材质库存')
  })
})

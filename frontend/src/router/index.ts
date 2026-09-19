import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '@/pages/LoginPage.vue'
import AccessPage from '@/pages/AccessPage.vue'
import { currentUser, isAdmin, isAuthenticated, refreshCurrentUser, restoreSession } from '@/stores/auth'
import { canEnterSite, checkSiteAccess, SITE_ACCESS_REQUIRED_EVENT } from '@/stores/access'
import { defaultAuthenticatedPath, safeInternalRedirect } from '@/utils/navigation'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/access', name: 'access', component: AccessPage, meta: { title: '访问验证', public: true } },
    { path: '/login', name: 'login', component: LoginPage, meta: { title: '登录', public: true } },
    { path: '/', name: 'home', component: () => import('@/pages/FactoryInventoryPage.vue'), meta: { title: '全厂总览' } },
    { path: '/factory-analysis', name: 'factory-analysis', component: () => import('@/pages/FactoryOverviewPage.vue'), meta: { title: '全厂数据分析' } },
    { path: '/factory-live', name: 'factory-live', component: () => import('@/pages/FactoryLivePage.vue'), meta: { title: '动态流转大屏', standalone: true } },
    { path: '/flow-preview/:view(team|chain)', name: 'flow-preview', component: () => import('@/pages/FlowPreviewPage.vue'), meta: { title: '物料流向预览', standalone: true } },
    {
      path: '/team-workspaces/:teamId',
      name: 'team-workspace',
      component: () => import('@/pages/TeamWorkspacePage.vue'),
      meta: { title: '班组工作台' },
    },
    {
      path: '/transfer-batches',
      name: 'transfer-batches',
      component: () => import('@/pages/TransferBatchesPage.vue'),
      meta: { title: '转料记录' },
    },
    {
      path: '/transfer-batches/scan',
      name: 'transfer-batch-scan',
      component: () => import('@/pages/TransferBatchScanPage.vue'),
      meta: { title: '扫码查询' },
    },
    {
      path: '/material-trace',
      name: 'material-trace',
      component: () => import('@/pages/FlowPreviewPage.vue'),
      meta: { title: '全链路追踪', adminOnly: true, standalone: true },
    },
    {
      path: '/settings/teams',
      name: 'teams',
      component: () => import('@/pages/TeamsPage.vue'),
      meta: { title: '班组管理', adminOnly: true },
    },
    {
      path: '/settings/accounts',
      name: 'accounts',
      component: () => import('@/pages/AccountsPage.vue'),
      meta: { title: '班组长管理', adminOnly: true },
    },
    { path: '/settings/main-system', name: 'main-system-configuration', component: () => import('@/pages/MainSystemConfigurationPage.vue'), meta: { title: '主系统对接', adminOnly: true } },
    { path: '/settings', redirect: '/settings/teams' },
    {
      path: '/scan',
      redirect: (to) => ({ path: '/transfer-batches/scan', query: to.query, hash: to.hash }),
    },
    { path: '/flows', redirect: '/transfer-batches' },
    { path: '/flows/:id', redirect: '/transfer-batches' },
    { path: '/entry', redirect: '/transfer-batches' },
    { path: '/team-production', redirect: '/transfer-batches' },
    { path: '/team-production/:teamId', redirect: '/transfer-batches' },
    { path: '/processes', redirect: '/transfer-batches' },
    { path: '/orders', redirect: '/transfer-batches' },
    { path: '/base-data', redirect: '/transfer-batches' },
    { path: '/:pathMatch(.*)*', redirect: '/transfer-batches' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  restoreSession()
  const unlocked = await checkSiteAccess()
  let destination = safeInternalRedirect(to.name === 'login' || to.name === 'access' ? to.query.redirect : to.fullPath, '/')
  if (!unlocked) return to.name === 'access' ? true : { path: '/access', query: { redirect: destination } }
  if (to.meta.public && isAuthenticated.value) {
    try { await refreshCurrentUser() } catch { /* The guarded destination retries account verification. */ }
    destination = safeInternalRedirect(to.query.redirect, defaultAuthenticatedPath(currentUser.value))
  }
  if (to.name === 'access') {
    return isAuthenticated.value ? destination : { path: '/login', query: { redirect: destination } }
  }
  if (to.meta.public) {
    return to.name === 'login' && isAuthenticated.value ? destination : true
  }
  if (!isAuthenticated.value) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  try {
    await refreshCurrentUser()
  } catch {
    if (!canEnterSite.value) return { path: '/access', query: { redirect: destination } }
    if (!isAuthenticated.value) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }
  if (to.name === 'material-trace' && to.query.team_id !== undefined) {
    const id = Number(to.query.team_id)
    if (!Number.isSafeInteger(id) || id < 1) return { path: defaultAuthenticatedPath(currentUser.value) }
    const { team_id: _team, ...query } = to.query
    return { path: `/team-workspaces/${id}`, query: { ...query, tab: 'history' } }
  }
  if ((to.name === 'material-trace' || to.name === 'flow-preview' && to.params.view === 'chain') && !isAdmin.value) {
    return { path: defaultAuthenticatedPath(currentUser.value) }
  }
  if (to.meta.adminOnly && !isAdmin.value) return { path: '/transfer-batches' }
  return true
})

if (typeof window !== 'undefined') {
  window.addEventListener(SITE_ACCESS_REQUIRED_EVENT, () => {
    const current = router.currentRoute.value
    if (current.name === 'access') return
    const destination = safeInternalRedirect(current.name === 'login' ? current.query.redirect : current.fullPath)
    void router.replace({ path: '/access', query: { redirect: destination } })
  })
}

router.afterEach((to) => {
  document.title = `${String(to.meta.title || '物料流转')} · 热沉物料流转管理`
})

export default router

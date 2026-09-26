<script setup lang="ts">
import { ArrowDown, Calendar, Fold, Menu, Monitor, SwitchButton, User } from '@element-plus/icons-vue'
import { ElConfigProvider, ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import FactorySidebar from '@/components/FactorySidebar.vue'
import AccessPage from '@/pages/AccessPage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import { currentUser, isAuthenticated, logout, refreshCurrentUser } from '@/stores/auth'
import { teamDirectory, refreshTeamDirectory } from '@/stores/teamDirectory'
import { canEnterSite } from '@/stores/access'
import { formatDateTime } from '@/utils/format'
import { resolveTeamWorkspaceSection, teamWorkspaceProfile, teamWorkspaceSections } from '@/config/teamWorkspaces'

const now = ref(new Date().toISOString())
let clockTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { clockTimer = setInterval(() => { now.value = new Date().toISOString() }, 60000) })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })
const teamLabel = computed(() => currentUser.value?.role === 'ADMIN' ? '系统管理员' : teamDirectory.items.find(team => String(team.id) === String(currentUser.value?.team_id))?.name || currentUser.value?.team?.name || '未配置班组')
const route = useRoute()
const router = useRouter()
const workspacePending = ref<{ teamId: number; count: number | null } | null>(null)
function updateWorkspacePending(value: { teamId: number; count: number | null }) {
  if (String(value.teamId) === String(route.params.teamId)) workspacePending.value = value
}
watch([() => route.path, () => currentUser.value?.id, () => currentUser.value?.team_id], () => { workspacePending.value = null })
const breadcrumb = computed(() => {
  if (route.path.startsWith('/team-workspaces/')) {
    const team = teamDirectory.items.find(item => String(item.id) === String(route.params.teamId))
    const section = resolveTeamWorkspaceSection(route.query, team?.code === 'FACTORY-WAREHOUSE' && team?.kind === 'warehouse')
    return ['班组工作台', teamWorkspaceProfile(team?.code)?.name || team?.name || '班组', teamWorkspaceSections.find(item => item.value === section)!.label]
  }
  const title = String(route.meta.title || '物料流转')
  if (['/factory-stock', '/factory-analysis'].includes(route.path)) return ['全厂总览', title]
  if (route.path.startsWith('/settings/')) return ['系统设置', title]
  if (['/transfer-batches', '/transfer-batches/scan', '/material-trace'].includes(route.path)) return ['流转查询', title]
  return [title]
})
const mobileMenuOpen = ref(false)
const compactSidebar = ref(false)
const sidebarElement = ref<HTMLElement | null>(null)
const mobileMenuButton = ref<HTMLButtonElement | null>(null)
const mainContent = ref<HTMLElement | null>(null)
const mobileViewport = ref(typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches)
const mobileDrawerOpen = computed(() => mobileViewport.value && mobileMenuOpen.value)
let viewportQuery: MediaQueryList | undefined
async function refreshWorkspaceIdentity(): Promise<void> {
  if (!isAuthenticated.value || !canEnterSite.value) return
  try { await refreshCurrentUser(); await refreshTeamDirectory() } catch { /* Retry on navigation or the next focus. */ }
}
onMounted(() => window.addEventListener('focus', refreshWorkspaceIdentity))
onBeforeUnmount(() => window.removeEventListener('focus', refreshWorkspaceIdentity))

function updateViewport(): void {
  mobileViewport.value = viewportQuery?.matches ?? false
  if (!mobileViewport.value) mobileMenuOpen.value = false
}

async function toggleMobileMenu(): Promise<void> {
  mobileMenuOpen.value = !mobileMenuOpen.value
  if (mobileMenuOpen.value) {
    await nextTick()
    sidebarElement.value?.querySelector<HTMLElement>('a, button, [role="menubar"][tabindex], [role="menu"][tabindex], [role="menuitem"][tabindex]')?.focus()
  }
}

function closeMobileMenu(): void {
  mobileMenuOpen.value = false
  mobileMenuButton.value?.focus()
}

async function focusMainContent(): Promise<void> {
  mobileMenuOpen.value = false
  await nextTick()
  mainContent.value?.focus()
}

function handleSidebarKeydown(event: KeyboardEvent): void {
  if (!mobileViewport.value || !mobileMenuOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMobileMenu()
  }
  if (event.key !== 'Tab') return
  const controls = Array.from(sidebarElement.value?.querySelectorAll<HTMLElement>('a, button, [role="menubar"][tabindex], [role="menu"][tabindex], [role="menuitem"][tabindex]') ?? [])
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-disabled') !== 'true')
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  viewportQuery = window.matchMedia('(max-width: 640px)')
  updateViewport()
  viewportQuery.addEventListener('change', updateViewport)
})
onBeforeUnmount(() => viewportQuery?.removeEventListener('change', updateViewport))

watch(
  () => route.fullPath,
  async () => {
    const shouldFocusMain = mobileDrawerOpen.value
    mobileMenuOpen.value = false
    if (shouldFocusMain) {
      await nextTick()
      mainContent.value?.focus()
    }
  },
)

watch(isAuthenticated, (authenticated) => {
  if (!authenticated && canEnterSite.value && !['login', 'access'].includes(String(route.name))) void router.replace('/login')
})

const isAuthenticationPage = computed(() => ['login', 'access'].includes(String(route.name)))
const userLabel = computed(() => {
  const user = currentUser.value
  if (!user) return ''
  const team = user.team?.name || (user.role === 'ADMIN' ? '系统管理员' : '未配置班组')
  return `${user.display_name || user.username}（${team}）`
})

async function signOut(): Promise<void> {
  await logout()
  await router.replace('/login')
}

function handleUserCommand(command: string | number | object): void {
  if (command === 'logout') void signOut()
}

function enterBigScreen(event: MouseEvent): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  // The click supplies browser activation; direct links still get the standalone layout.
  void document.documentElement.requestFullscreen?.().catch(() => { /* Standalone display remains available. */ })
}
</script>

<template>
  <ElConfigProvider :locale="zhCn" size="default">
    <AccessPage v-if="!canEnterSite" />

    <LoginPage v-else-if="!isAuthenticated && !isAuthenticationPage" />

    <template v-else-if="isAuthenticationPage">
      <RouterView />
    </template>

    <main v-else-if="route.meta.standalone" id="main-content" ref="mainContent" class="standalone-screen" tabindex="-1">
      <RouterView />
    </main>

    <div v-else class="app-shell app-shell--business" :class="{ 'app-shell--compact': compactSidebar, 'app-shell--overview': route.name === 'home' }">
      <a class="skip-link" href="#main-content" :inert="mobileDrawerOpen ? true : undefined" :aria-hidden="mobileDrawerOpen ? true : undefined" @click.prevent="focusMainContent">跳到正文</a>

      <div class="brand-mark" aria-label="安泰天龙 · 热沉物料">
        <img v-if="compactSidebar" class="brand-mark__icon" src="/brand/attl-official-favicon.ico" alt="安泰天龙" width="32" height="32" />
        <img v-else class="brand-mark__logo" src="/brand/attl-official-logo.png" alt="中国钢研 安泰科技 · 安泰天龙" width="1017" height="143" />
      </div>

      <header class="topbar">
        <button ref="mobileMenuButton" class="topbar__menu" type="button" :aria-label="mobileMenuOpen ? '关闭导航' : '打开导航'" :aria-expanded="mobileMenuOpen" aria-controls="factory-sidebar" :title="mobileMenuOpen ? '关闭导航' : '打开导航'" @click="toggleMobileMenu">
          <Menu />
        </button>
        <nav class="brand breadcrumb" aria-label="当前位置" :inert="mobileDrawerOpen ? true : undefined" :aria-hidden="mobileDrawerOpen ? true : undefined"><span v-for="(part, index) in breadcrumb" :key="index" :aria-current="index === breadcrumb.length - 1 ? 'page' : undefined">{{ part }}</span></nav>
        <div class="topbar-clock" :inert="mobileDrawerOpen ? true : undefined" :aria-hidden="mobileDrawerOpen ? true : undefined"><ElIcon><Calendar /></ElIcon><time>{{ formatDateTime(now).slice(0, 10) }}</time></div>
        <div class="topbar__account" :inert="mobileDrawerOpen ? true : undefined" :aria-hidden="mobileDrawerOpen ? true : undefined">
          <ElDropdown placement="bottom-end" trigger="click" popper-class="factory-account-menu" @command="handleUserCommand">
            <button class="topbar__user" type="button" title="账户菜单" :aria-label="`${userLabel}，打开账户菜单`">
              <ElIcon class="topbar__account-icon"><User /></ElIcon>
              <span class="topbar__user-label"><strong>{{ currentUser?.display_name || currentUser?.username }}</strong><small v-if="teamLabel !== currentUser?.display_name">/ {{ teamLabel }}</small></span>
              <ElIcon class="topbar__chevron"><ArrowDown /></ElIcon>
            </button>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="logout"><ElIcon><SwitchButton /></ElIcon>退出登录</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </div>
        <RouterLink to="/factory-live" class="topbar__screen" :inert="mobileDrawerOpen ? true : undefined" :aria-hidden="mobileDrawerOpen ? true : undefined" aria-label="动态流转大屏" @click="enterBigScreen"><ElIcon><Monitor /></ElIcon><span>大屏展示</span></RouterLink>
      </header>

      <aside id="factory-sidebar" ref="sidebarElement" class="sidebar" :class="{ 'sidebar--open': mobileMenuOpen }" :inert="mobileViewport && !mobileMenuOpen ? true : undefined" :aria-hidden="mobileViewport && !mobileMenuOpen ? true : undefined" @keydown="handleSidebarKeydown">
        <FactorySidebar :compact="compactSidebar && !mobileViewport" :overview="route.name === 'home'" :pending-team-id="workspacePending?.teamId" :pending-count="workspacePending?.count" illustrated />

        <button class="sidebar__collapse" type="button" :aria-label="compactSidebar ? '展开侧栏' : '收起侧栏'" :aria-expanded="!compactSidebar" aria-controls="factory-sidebar" :title="compactSidebar ? '展开侧栏' : '收起侧栏'" @click="compactSidebar = !compactSidebar">
          <Fold />
          <span v-if="!compactSidebar">收起导航</span>
        </button>
      </aside>

      <Transition name="overlay-fade">
        <button v-if="mobileMenuOpen" class="sidebar-mask" type="button" aria-label="关闭导航" title="关闭导航" tabindex="-1" @click="closeMobileMenu" />
      </Transition>

      <main id="main-content" ref="mainContent" class="main-content" tabindex="-1" :inert="mobileDrawerOpen ? true : undefined" :aria-hidden="mobileDrawerOpen ? true : undefined">
        <RouterView v-slot="{ Component }">
          <Transition name="page-shift">
            <component :is="Component" :key="route.path" v-on="route.name === 'team-workspace' ? { 'pending-count': updateWorkspacePending } : {}" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </ElConfigProvider>
</template>

<style scoped>
.skip-link { position: fixed; z-index: 110; top: 8px; left: 8px; padding: 9px 13px; border-radius: 4px; color: #fff; background: var(--navy-active); transform: translateY(calc(-100% - 12px)); }
.skip-link:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; transform: translateY(0); }
.main-content:focus { outline: none; }
.standalone-screen { position: fixed; inset: 0; width: 100%; height: 100dvh; overflow: hidden; background: #00111d; }
.app-shell--business { --sidebar-width: 184px; --topbar-height: 56px; color: var(--text); font-family: var(--font-body); }
.app-shell--business.app-shell--compact { --sidebar-width: 64px; }
.app-shell--business .brand-mark { justify-content: center; padding-inline: 14px; }
.brand-mark__logo { display: block; width: 100%; height: auto; object-fit: contain; }
.brand-mark__icon { display: block; flex: none; width: 32px; height: 32px; object-fit: contain; }
.app-shell--business .topbar { gap: 18px; }
.app-shell--business .breadcrumb { font-size: 14px; }
.app-shell--business .topbar-clock, .app-shell--business .topbar__screen, .app-shell--business .topbar__user-label strong { font-size: 14px; }
.app-shell--business .sidebar__collapse { height: 60px; padding-bottom: 0; font-size: 12px; }
.app-shell--business .sidebar { background: #fff; }
.app-shell--business.app-shell--compact .brand-mark { padding: 0; }
@media (max-width: 640px) { .app-shell--business { --topbar-height: 60px; } .app-shell--business .topbar { gap: 10px; } }
.app-shell--overview .topbar__screen { display: none; }
</style>

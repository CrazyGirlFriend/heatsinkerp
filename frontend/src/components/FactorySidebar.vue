<script setup lang="ts">
import { Search, OfficeBuilding, Setting, Refresh, House, Box, Connection, HotWater, Tools, Scissor, EditPen, Coin, CircleCheck, Tickets, Aim, Location, User, ArrowRight, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { ElIcon, ElMenu, ElMenuItem, ElSubMenu, type MenuInstance } from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isAdmin } from '@/stores/auth'
import { appPinia } from '@/stores/access'
import { useSidebarStore } from '@/stores/sidebar'
import { teamDirectory, refreshTeamDirectory } from '@/stores/teamDirectory'
import { configuredTeamWorkspaces, resolveTeamWorkspaceSection, teamWorkspaceSectionsFor, teamWorkspaceSectionPath } from '@/config/teamWorkspaces'

const props = withDefaults(defineProps<{ compact?: boolean; illustrated?: boolean; pendingTeamId?: number; pendingCount?: number | null }>(), { compact: false, illustrated: false })
const teamIcons = { 'FACTORY-WAREHOUSE': Box, 'FACTORY-ROLL': Connection, 'FACTORY-ANNEAL': HotWater, 'FACTORY-GRIND': Tools,
  'FACTORY-WIRE': Scissor, 'FACTORY-ENGRAVE': EditPen, 'FACTORY-PLATE': Coin, 'FACTORY-QC': CircleCheck }
const route = useRoute()
const router = useRouter()
const menu = ref<MenuInstance>()
const viewport = ref<HTMLElement>()
const sidebar = useSidebarStore(appPinia)
const activeGroup = computed(() => route.path.startsWith('/settings/') ? 'settings' : ['/', '/factory-stock', '/factory-analysis'].includes(route.path) ? 'factory' : ['/transfer-batches', '/transfer-batches/scan', '/material-trace'].includes(route.path) ? 'materials' : 'teams')
const workspaces = computed(() => configuredTeamWorkspaces(teamDirectory.items))
const activeTeam = computed(() => workspaces.value.find(({ team }) => team && route.path === `/team-workspaces/${team.id}`)?.team)
const activeIndex = computed(() => activeTeam.value ? teamWorkspaceSectionPath(activeTeam.value.id, resolveTeamWorkspaceSection(route.query, activeTeam.value.code === 'FACTORY-WAREHOUSE' && activeTeam.value.kind === 'warehouse')) : route.path)
const routeGroups = computed(() => [activeGroup.value, ...(activeTeam.value ? [`team-${activeTeam.value.id}`] : [])])
const waitingForDirectory = computed(() => route.path.startsWith('/team-workspaces/') && !teamDirectory.loaded)
const groupIndexes = computed(() => ['factory', 'teams', 'materials', ...(isAdmin.value ? ['settings'] : []), ...workspaces.value.flatMap(({ team }) => team ? [`team-${team.id}`] : [])])
const canScrollUp = ref(false)
const canScrollDown = ref(false)
let ready = false
let disposed = false
let initialized = false
let syncing = false
let revealIndex: string | null = null
let observer: ResizeObserver | undefined

function updateOverflow(): void {
  const element = viewport.value
  if (!element) return
  canScrollUp.value = element.scrollTop > 1
  canScrollDown.value = element.scrollHeight - element.clientHeight - element.scrollTop > 1
}

function revealMenu(): void {
  const element = viewport.value
  if (!element || props.compact || !revealIndex) return
  const target = revealIndex === activeIndex.value
    ? element.querySelector<HTMLElement>('[aria-current="page"]')
    : Array.from(element.querySelectorAll<HTMLElement>('[data-nav-index]')).find(item => item.dataset.navIndex === revealIndex)
  if (!target?.getClientRects().length) return
  const bounds = element.getBoundingClientRect()
  const title = target.querySelector<HTMLElement>(':scope > .el-sub-menu__title')
  const rect = target.getBoundingClientRect()
  const visibleRect = title && (!revealIndex.startsWith('team-') || rect.height > element.clientHeight - 48) ? title.getBoundingClientRect() : rect
  if (visibleRect.top < bounds.top + 24) element.scrollTop += visibleRect.top - bounds.top - 24
  else if (visibleRect.bottom > bounds.bottom - 24) element.scrollTop += visibleRect.bottom - bounds.bottom + 24
  updateOverflow()
}

function requestReveal(index: string): void {
  revealIndex = index
  void nextTick(() => { revealMenu(); updateOverflow() })
}

function scrollMenu(direction: number): void {
  revealIndex = null
  const element = viewport.value
  if (element) element.scrollTop += direction * element.clientHeight * 0.65
  updateOverflow()
}

function observeMenu(): void {
  observer?.disconnect()
  if (viewport.value) observer?.observe(viewport.value)
  if (menu.value?.$el) observer?.observe(menu.value.$el)
}

function syncMenu(): void {
  if (!ready || props.compact || !menu.value) return
  syncing = true
  // Element Plus only reads default-openeds on creation; restore via its public API.
  groupIndexes.value.forEach(index => { if (!sidebar.opened.includes(index)) menu.value?.close(index) })
  sidebar.opened.filter(index => groupIndexes.value.includes(index)).forEach(index => menu.value?.open(index))
  syncing = false
}

function onOpen(index: string, indexPath: string[]): void {
  if (!ready || !initialized || syncing || props.compact) return
  sidebar.opened = indexPath.filter(item => groupIndexes.value.includes(item))
  requestReveal(index)
}

function onClose(index: string): void {
  if (!ready || !initialized || syncing || props.compact) return
  const position = sidebar.opened.indexOf(index)
  if (position !== -1) sidebar.opened = sidebar.opened.slice(0, position)
  syncMenu()
  requestReveal(index)
}

async function restoreNavigation(): Promise<void> {
  if (!ready) return
  if (waitingForDirectory.value) { initialized = false; return }
  // Resolve the team and its section before comparing a saved route on reload.
  const changedPage = sidebar.page !== activeIndex.value
  if (changedPage) { sidebar.page = activeIndex.value; sidebar.opened = routeGroups.value }
  await nextTick()
  if (!ready) return
  initialized = true
  syncMenu()
  requestReveal(changedPage && activeTeam.value ? `team-${activeTeam.value.id}` : sidebar.opened.at(-1) || activeIndex.value)
}
watch([activeIndex, () => routeGroups.value.join('/'), waitingForDirectory], restoreNavigation)
watch(() => props.compact, async (compact) => {
  syncing = true
  await nextTick()
  syncing = false
  observeMenu()
  if (!compact) { syncMenu(); requestReveal(sidebar.opened.at(-1) || activeIndex.value) }
  else { revealIndex = null; updateOverflow() }
}, { flush: 'sync' })
onMounted(async () => {
  await router.isReady()
  await nextTick()
  if (disposed) return
  ready = true
  await restoreNavigation()
  if (disposed) return
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => { revealMenu(); updateOverflow() })
    observeMenu()
  }
})
onBeforeUnmount(() => { disposed = true; ready = false; observer?.disconnect() })
const materialLinks = computed(() => [
  { path: '/transfer-batches', label: '转料记录', icon: Tickets },
  { path: '/transfer-batches/scan', label: '扫码查询', icon: Aim },
  ...(isAdmin.value ? [{ path: '/material-trace', label: '全链路追踪', icon: Location }] : []),
])
</script>

<template>
  <nav class="factory-nav" :class="{ 'factory-nav--compact': compact, 'factory-nav--illustrated': illustrated }" aria-label="主导航">
    <div ref="viewport" class="factory-nav__scroll" @scroll.passive="updateOverflow" @wheel.passive="revealIndex = null" @touchstart.passive="revealIndex = null" @pointerdown="revealIndex = null" @keydown="revealIndex = null" @transitionend="revealMenu">
    <ElMenu ref="menu" router unique-opened tabindex="0" :default-active="activeIndex" :collapse="compact" :collapse-transition="false" popper-class="factory-nav-popup" @open="onOpen" @close="onClose">
      <ElSubMenu index="factory" data-nav-index="factory" aria-label="全厂总览">
        <template #title><ElIcon><House /></ElIcon><span>全厂总览</span></template>
        <ElMenuItem index="/" aria-label="库存总览" :aria-current="route.path === '/' ? 'page' : undefined">库存总览</ElMenuItem>
        <ElMenuItem index="/factory-stock" aria-label="库存明细" :aria-current="route.path === '/factory-stock' ? 'page' : undefined">库存明细</ElMenuItem>
      </ElSubMenu>
      <ElSubMenu index="teams" data-nav-index="teams" aria-label="班组工作台">
        <template #title><ElIcon><OfficeBuilding /></ElIcon><span>班组工作台</span></template>
        <ElMenuItem v-if="teamDirectory.loading && !teamDirectory.loaded" index="teams-loading" disabled>加载班组…</ElMenuItem>
        <ElMenuItem v-else-if="teamDirectory.error" index="teams-retry" :route="route.fullPath" @click="refreshTeamDirectory"><ElIcon><Refresh /></ElIcon>重新加载班组</ElMenuItem>
        <template v-else>
          <template v-for="{ profile, team } in workspaces" :key="profile.code">
            <ElSubMenu v-if="team" :index="`team-${team.id}`" :data-nav-index="`team-${team.id}`" class="factory-nav__team" :aria-label="profile.name + '工作台'" :expand-close-icon="ArrowRight" :expand-open-icon="ArrowRight" popper-class="factory-nav-popup">
              <template #title><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><component :is="teamIcons[profile.code as keyof typeof teamIcons]" /></ElIcon><span>{{ profile.name }}</span></template>
              <ElMenuItem v-for="section in teamWorkspaceSectionsFor(profile.code === 'FACTORY-WAREHOUSE' && team.kind === 'warehouse')" :key="section.value" :index="teamWorkspaceSectionPath(team.id, section.value)" class="factory-nav__workspace-link" :aria-label="`${profile.name} · ${section.label}`" :aria-current="activeIndex === teamWorkspaceSectionPath(team.id, section.value) ? 'page' : undefined">
                <span>{{ section.label }}</span><small v-if="section.value === 'pending' && String(pendingTeamId) === String(team.id) && pendingCount" class="factory-nav__count">{{ pendingCount }}</small>
              </ElMenuItem>
            </ElSubMenu>
            <ElMenuItem v-else :index="'missing-' + profile.code" class="factory-nav__missing" disabled>{{ profile.name }}<small>未配置</small></ElMenuItem>
          </template>
        </template>
      </ElSubMenu>
      <ElSubMenu index="materials" data-nav-index="materials" aria-label="流转查询">
        <template #title><ElIcon><Search /></ElIcon><span>流转查询</span></template>
        <ElMenuItem v-for="link in materialLinks" :key="link.path" :index="link.path" :aria-label="link.label" :aria-current="route.path === link.path ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><component :is="link.icon" /></ElIcon>{{ link.label }}</ElMenuItem>
      </ElSubMenu>
      <ElSubMenu v-if="isAdmin" index="settings" data-nav-index="settings" aria-label="系统设置">
        <template #title><ElIcon><Setting /></ElIcon><span>系统设置</span></template>
        <ElMenuItem index="/settings/teams" aria-label="班组管理" :aria-current="route.path === '/settings/teams' ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><OfficeBuilding /></ElIcon>班组管理</ElMenuItem>
        <ElMenuItem index="/settings/accounts" aria-label="班组长管理" :aria-current="route.path === '/settings/accounts' ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><User /></ElIcon>班组长管理</ElMenuItem>
        <ElMenuItem index="/settings/main-system" aria-label="主系统对接" :aria-current="route.path === '/settings/main-system' ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><Connection /></ElIcon>主系统对接</ElMenuItem>
      </ElSubMenu>
    </ElMenu>
    </div>
    <button v-if="canScrollUp && !compact" type="button" class="factory-nav__scroll-hint factory-nav__scroll-hint--up" aria-label="向上滚动导航" @click="scrollMenu(-1)"><ElIcon><ArrowUp /></ElIcon><span>上方菜单</span></button>
    <button v-if="canScrollDown && !compact" type="button" class="factory-nav__scroll-hint factory-nav__scroll-hint--down" aria-label="向下滚动导航" @click="scrollMenu(1)"><span>更多菜单</span><ElIcon><ArrowDown /></ElIcon></button>
  </nav>
</template>

<style scoped>
.factory-nav { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; }
.factory-nav__scroll { flex: 1; min-width: 0; min-height: 0; padding: 24px 10px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #bdc9c1 transparent; }
.factory-nav__scroll::-webkit-scrollbar { width: 5px; }
.factory-nav__scroll::-webkit-scrollbar-thumb { border-radius: 5px; background: #bdc9c1; }
.factory-nav__scroll-hint { position: absolute; z-index: 1; right: 6px; left: 6px; display: flex; align-items: center; justify-content: center; gap: 5px; height: 24px; padding: 0; border: 0; border-radius: 4px; color: var(--muted); font-size: 11px; cursor: pointer; }
.factory-nav__scroll-hint:hover, .factory-nav__scroll-hint:focus-visible { color: var(--primary); }
.factory-nav__scroll-hint--up { top: 0; background: linear-gradient(#fff 70%, #ffffffc9); }
.factory-nav__scroll-hint--down { bottom: 0; background: linear-gradient(#ffffffc9, #fff 30%); }
.factory-nav :deep(.el-menu) { width: 100%; border: 0; --el-menu-base-level-padding: 12px; --el-menu-level-padding: 34px; --el-menu-item-height: 44px; --el-menu-sub-item-height: 38px; --el-menu-text-color: var(--muted); --el-menu-hover-bg-color: var(--surface-soft); --el-menu-active-color: var(--primary); }
.factory-nav :deep(.el-sub-menu__title) { border-radius: 6px; color: var(--text); font-size: 14px; font-weight: 450; }
.factory-nav :deep(.el-sub-menu__icon-arrow) { color: var(--muted); font-size: 11px; transition: transform var(--motion-standard) var(--motion-ease); }
.factory-nav :deep(.el-menu--inline) { --el-transition-duration: var(--motion-standard); }
.factory-nav :deep(.el-menu-item) { margin: 2px 0; border-radius: 6px; font-size: 14px; }
.factory-nav :deep(.el-menu > .el-menu-item) { color: var(--text); }
.factory-nav :deep(.el-menu > .el-menu-item > .el-icon), .factory-nav :deep(.el-sub-menu__title > .el-icon:not(.el-sub-menu__icon-arrow)) { width: 24px; margin-right: 8px; }
.factory-nav__scroll > :deep(.el-menu > .el-menu-item), .factory-nav__scroll > :deep(.el-menu > .el-sub-menu) { margin: 4px 0; }
.factory-nav :deep(.el-menu-item.is-active) { color: var(--primary); background: var(--surface-soft); font-weight: 550; }
.factory-nav :deep(.el-sub-menu .el-menu-item.is-active::before) { position: absolute; left: 24px; height: 20px; width: 2px; background: var(--primary); content: ''; }
.factory-nav__missing small { margin-left: auto; font-size: 11px; }
.factory-nav :deep(.factory-nav__team > .el-sub-menu__title) { height: 38px; line-height: 38px; padding-left: 24px; font-weight: 450; }
.factory-nav :deep(.factory-nav__team > .el-menu > .el-menu-item) { min-width: 0; height: 34px; line-height: 34px; padding-left: 56px; padding-right: 12px; font-size: 13px; }
.factory-nav :deep(.factory-nav__team .el-menu-item.is-active::before) { left: 42px; height: 16px; }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team) { margin-block: 2px; border-radius: 8px; transition: background-color var(--motion-standard) var(--motion-ease); }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team.is-opened) { background: var(--workspace-bg); }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team > .el-sub-menu__title) { padding-right: 12px; color: var(--text); font-weight: 450; }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team.is-opened > .el-sub-menu__title) { font-weight: 550; }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team > .el-sub-menu__title > .el-sub-menu__icon-arrow) { position: static; flex: 0 0 12px; width: 12px; height: 12px; margin: 0 0 0 7px; font-size: 10px; }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team > .el-sub-menu__title > .el-sub-menu__icon-arrow svg) { transition: transform var(--motion-standard) var(--motion-ease); }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team.is-opened > .el-sub-menu__title > .el-sub-menu__icon-arrow svg) { transform: rotate(90deg); }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team > .el-menu) { padding-bottom: 4px; }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team > .el-menu > .el-menu-item) { margin: 2px 6px 2px 38px; padding-left: 34px; padding-right: 8px; }
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team .el-menu-item.is-active::before) { left: 12px; }
.factory-nav__count { min-width: 18px; margin-left: auto; padding: 0 5px; border-radius: 4px; background: var(--surface-soft); color: var(--primary); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }
.factory-nav--compact .factory-nav__scroll { padding-inline: 6px; }
.factory-nav--compact :deep(.el-menu-item), .factory-nav--compact :deep(.el-sub-menu__title), .factory-nav--compact :deep(.el-menu-tooltip__trigger) { justify-content: center; padding: 0; }
.factory-nav--compact :deep(.el-menu .el-icon:not(.el-sub-menu__icon-arrow)) { margin: 0; }
.factory-nav--illustrated :deep(.el-menu) { background: transparent; --el-menu-item-height: 42px; --el-menu-sub-item-height: 40px; --el-menu-level-padding: 20px; }
.factory-nav--illustrated :deep(.el-sub-menu__title), .factory-nav--illustrated :deep(.el-menu > .el-menu-item) { font-weight: 550; }
.factory-nav--illustrated :deep(.el-sub-menu > .el-menu) { background: transparent; }
.factory-nav--illustrated :deep(.el-sub-menu .el-menu-item:not(.is-active)) { color: var(--muted); }
.factory-nav--illustrated :deep(.factory-nav__team-icon) { width: 22px; margin-right: 10px; font-size: 19px; color: var(--muted); }
</style>

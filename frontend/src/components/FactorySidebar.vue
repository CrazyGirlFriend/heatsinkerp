<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { ElIcon, ElMenu, ElMenuItem, ElSubMenu, type MenuInstance } from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authState, currentUser, isAdmin, isTeamAccount } from '@/stores/auth'
import { appPinia } from '@/stores/access'
import { useSidebarStore } from '@/stores/sidebar'
import { teamDirectory, refreshTeamDirectory } from '@/stores/teamDirectory'
import {
  configuredTeamWorkspaces,
  resolveTeamWorkspaceSection,
  teamCanProcess,
  teamCanReallocate,
  teamWorkspaceModuleFor,
  teamWorkspaceModulesFor,
} from '@/config/teamWorkspaces'
import type { Team } from '@/services/adminApi'
import FactoryNavIcon from './FactoryNavIcon.vue'

const props = withDefaults(
  defineProps<{ compact?: boolean; illustrated?: boolean; glass?: boolean }>(),
  { compact: false, illustrated: false, glass: false },
)
const teamIcons = {
  'FACTORY-WAREHOUSE': 'warehouse',
  'FACTORY-ROLL': 'rolling',
  'FACTORY-ANNEAL': 'annealing',
  'FACTORY-GRIND': 'grinding',
  'FACTORY-WIRE': 'cutting',
  'FACTORY-ENGRAVE': 'engraving',
  'FACTORY-PLATE': 'plating',
  'FACTORY-QC': 'inspection',
} as const
const route = useRoute()
const router = useRouter()
const menu = ref<MenuInstance>()
const viewport = ref<HTMLElement>()
const sidebar = useSidebarStore(appPinia)
const activeGroup = computed(() =>
  route.path.startsWith('/settings/')
    ? 'settings'
    : ['/', '/factory-analysis', '/production-schedules'].includes(route.path)
      ? 'factory'
      : ['/transfer-batches', '/material-trace'].includes(route.path)
        ? 'materials'
        : ['/process-routes', '/business-people', '/dispatch-schedules'].includes(route.path)
          ? 'management'
          : 'teams',
)
const workspaces = computed(() => configuredTeamWorkspaces(teamDirectory.items))
function capabilities(team: Team) {
  const warehouse = team.code === 'FACTORY-WAREHOUSE' && team.kind === 'warehouse'
  const manageWarehouse =
    warehouse &&
    (isAdmin.value ||
      (isTeamAccount.value &&
        currentUser.value?.active &&
        !authState.currentUserError &&
        String(currentUser.value.team_id) === String(team.id)))
  return [
    warehouse,
    Boolean(manageWarehouse),
    teamCanReallocate(team),
    teamCanProcess(team),
    team.code === 'FACTORY-QC',
  ] as const
}
const currentTeam = computed(
  () =>
    workspaces.value.find(({ team }) => team && route.path === `/team-workspaces/${team.id}`)?.team,
)
const currentSection = computed(() =>
  currentTeam.value
    ? resolveTeamWorkspaceSection(route.query, ...capabilities(currentTeam.value))
    : null,
)
const activeIndex = computed(() => {
  if (currentTeam.value && currentSection.value)
    return `team-${currentTeam.value.id}:${teamWorkspaceModuleFor(currentSection.value)?.value}`
  if (route.path === '/process-routes')
    return route.query.kind === 'rework' ? 'engineering:rework' : 'engineering:normal'
  return route.path
})
const routeGroups = computed(() => [
  activeGroup.value,
  ...(currentTeam.value ? [`team-${currentTeam.value.id}`] : []),
  ...(route.path === '/process-routes' ? ['engineering'] : []),
])
function modulesFor(team: Team) {
  return teamWorkspaceModulesFor(...capabilities(team))
}
function moduleLocation(team: Team, module: ReturnType<typeof modulesFor>[number]) {
  const remembered = sidebar.workspaceModules[`${team.id}:${module.value}`]
  const section = module.sections.find((item) => item.value === remembered) || module.sections[0]!
  return sidebar.workspaceLocation(String(team.id), section.value)
}
function moduleCount(team: Team, module: string) {
  const counts = sidebar.workspaceCounts[String(team.id)]
  return module === 'movement' ? counts?.pending : module === 'quality' ? counts?.quality : 0
}
const waitingForDirectory = computed(
  () => route.path.startsWith('/team-workspaces/') && !teamDirectory.loaded,
)
const groupIndexes = computed(() => [
  'factory',
  'management',
  'engineering',
  'teams',
  ...workspaces.value.flatMap(({ team }) => (team ? [`team-${team.id}`] : [])),
  'materials',
  ...(isAdmin.value ? ['settings'] : []),
])
let ready = false
let disposed = false
let initialized = false
let syncing = false
let revealIndex: string | null = null
let previousActiveIndex = ''
let observer: ResizeObserver | undefined

function revealMenu(): void {
  const element = viewport.value
  if (!element || props.compact || !revealIndex) return
  const target =
    revealIndex === activeIndex.value
      ? element.querySelector<HTMLElement>('[aria-current="page"]')
      : Array.from(element.querySelectorAll<HTMLElement>('[data-nav-index]')).find(
          (item) => item.dataset.navIndex === revealIndex,
        )
  if (!target?.getClientRects().length) return
  const bounds = element.getBoundingClientRect()
  const title = target.querySelector<HTMLElement>(':scope > .el-sub-menu__title')
  const visibleRect = (title || target).getBoundingClientRect()
  if (visibleRect.top < bounds.top + 24) element.scrollTop += visibleRect.top - bounds.top - 24
  else if (visibleRect.bottom > bounds.bottom - 24)
    element.scrollTop += visibleRect.bottom - bounds.bottom + 24
}

function requestReveal(index: string): void {
  revealIndex = index
  void nextTick(revealMenu)
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
  groupIndexes.value.forEach((index) => {
    if (!sidebar.opened.includes(index)) menu.value?.close(index)
  })
  sidebar.opened
    .filter((index) => groupIndexes.value.includes(index))
    .forEach((index) => menu.value?.open(index))
  syncing = false
}

function onOpen(index: string, indexPath: string[]): void {
  if (!ready || !initialized || syncing || props.compact) return
  sidebar.opened = indexPath.filter((item) => groupIndexes.value.includes(item))
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
  if (waitingForDirectory.value) {
    initialized = false
    return
  }
  // Wait until team links exist before restoring selection and scroll position.
  const changedPage = sidebar.page !== route.path
  const changedModule = previousActiveIndex && previousActiveIndex !== activeIndex.value
  if (changedPage || changedModule || route.query.notice) {
    sidebar.page = route.path
    sidebar.opened = routeGroups.value
  }
  previousActiveIndex = activeIndex.value
  await nextTick()
  if (!ready) return
  initialized = true
  syncMenu()
  requestReveal(changedPage ? activeIndex.value : sidebar.opened.at(-1) || activeIndex.value)
}
watch(
  [activeIndex, () => routeGroups.value.join('/'), waitingForDirectory, () => route.query.notice],
  restoreNavigation,
)
watch(
  () => props.compact,
  async (compact) => {
    syncing = true
    await nextTick()
    syncing = false
    observeMenu()
    if (!compact) {
      syncMenu()
      requestReveal(sidebar.opened.at(-1) || activeIndex.value)
    } else {
      revealIndex = null
    }
  },
  { flush: 'sync' },
)
onMounted(async () => {
  await router.isReady()
  await nextTick()
  if (disposed) return
  ready = true
  await restoreNavigation()
  if (disposed) return
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(revealMenu)
    observeMenu()
  }
})
onBeforeUnmount(() => {
  disposed = true
  ready = false
  observer?.disconnect()
})
const materialLinks = computed(() => [
  { path: '/transfer-batches', label: '转料记录', icon: 'records' as const },
  ...(isAdmin.value
    ? [{ path: '/material-trace', label: '流水号查询', icon: 'trace' as const }]
    : []),
])
</script>

<template>
  <nav
    class="factory-nav"
    :class="{
      'factory-nav--compact': compact,
      'factory-nav--illustrated': illustrated,
      'factory-nav--glass': glass,
    }"
    aria-label="主导航"
  >
    <div
      ref="viewport"
      class="factory-nav__scroll"
      @wheel.passive="revealIndex = null"
      @touchstart.passive="revealIndex = null"
      @pointerdown="revealIndex = null"
      @keydown="revealIndex = null"
      @transitionend="revealMenu"
    >
      <ElMenu
        ref="menu"
        router
        unique-opened
        tabindex="0"
        :default-active="activeIndex"
        :collapse="compact"
        :collapse-transition="false"
        popper-class="factory-nav-popup"
        @open="onOpen"
        @close="onClose"
      >
        <ElSubMenu
          index="factory"
          data-nav-index="factory"
          aria-label="全厂总览"
          :class="{ 'factory-nav__current': activeGroup === 'factory' }"
          :aria-description="activeGroup === 'factory' ? '当前页面所属模块' : undefined"
        >
          <template #title
            ><ElIcon class="factory-nav__module-icon" aria-hidden="true"
              ><FactoryNavIcon name="overview" /></ElIcon
            ><span>全厂总览</span
            ><span
              v-if="activeGroup === 'factory' && !compact"
              class="factory-nav__current-badge"
              aria-hidden="true"
              >当前</span
            ></template
          >
          <ElMenuItem
            index="/factory-analysis"
            aria-label="全厂数据分析"
            :aria-current="route.path === '/factory-analysis' ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="analysis" /></ElIcon
            ><span>全厂数据分析</span></ElMenuItem
          >
          <ElMenuItem
            index="/"
            aria-label="班组材质库存"
            :aria-current="route.path === '/' ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="inventory" /></ElIcon
            ><span>班组材质库存</span></ElMenuItem
          >
          <ElMenuItem
            index="/production-schedules"
            aria-label="生产排期"
            :aria-current="route.path === '/production-schedules' ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="schedule" /></ElIcon
            ><span>生产排期</span></ElMenuItem
          >
        </ElSubMenu>
        <ElSubMenu
          index="management"
          data-nav-index="management"
          aria-label="生产管理"
          :class="{ 'factory-nav__current': activeGroup === 'management' }"
          :aria-description="activeGroup === 'management' ? '当前页面所属模块' : undefined"
        >
          <template #title
            ><ElIcon class="factory-nav__module-icon" aria-hidden="true"
              ><FactoryNavIcon name="schedule" /></ElIcon
            ><span>生产管理</span
            ><span
              v-if="activeGroup === 'management' && !compact"
              class="factory-nav__current-badge"
              aria-hidden="true"
              >当前</span
            ></template
          >
          <ElSubMenu
            index="engineering"
            data-nav-index="engineering"
            aria-label="工艺工作台"
            class="factory-nav__team"
          >
            <template #title
              ><ElIcon class="factory-nav__team-icon" aria-hidden="true"
                ><FactoryNavIcon name="records" /></ElIcon
              ><span>工艺</span></template
            >
            <ElMenuItem
              v-for="kind in ['normal', 'rework']"
              :key="kind"
              :index="`engineering:${kind}`"
              :route="{ path: '/process-routes', query: kind === 'rework' ? { kind } : {} }"
              class="factory-nav__workspace-link"
              :aria-label="kind === 'normal' ? '正常工艺' : '返工工艺'"
              :aria-current="activeIndex === `engineering:${kind}` ? 'page' : undefined"
              >{{ kind === 'normal' ? '正常工艺' : '返工工艺' }}</ElMenuItem
            >
          </ElSubMenu>
          <ElMenuItem
            index="/business-people"
            aria-label="业务班组"
            :aria-current="route.path === '/business-people' ? 'page' : undefined"
            ><ElIcon class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="accounts" /></ElIcon
            ><span>业务</span></ElMenuItem
          >
          <ElMenuItem
            index="/dispatch-schedules"
            aria-label="调度工作台"
            :aria-current="route.path === '/dispatch-schedules' ? 'page' : undefined"
            ><ElIcon class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="schedule" /></ElIcon
            ><span>调度</span></ElMenuItem
          >
        </ElSubMenu>
        <ElSubMenu
          index="teams"
          data-nav-index="teams"
          aria-label="班组工作台"
          :class="{ 'factory-nav__current': activeGroup === 'teams' }"
          :aria-description="activeGroup === 'teams' ? '当前页面所属模块' : undefined"
        >
          <template #title
            ><ElIcon class="factory-nav__module-icon" aria-hidden="true"
              ><FactoryNavIcon name="workspaces" /></ElIcon
            ><span>班组工作台</span
            ><span
              v-if="activeGroup === 'teams' && !compact"
              class="factory-nav__current-badge"
              aria-hidden="true"
              >当前</span
            ></template
          >
          <ElMenuItem
            v-if="teamDirectory.loading && !teamDirectory.loaded"
            index="teams-loading"
            disabled
            >加载班组…</ElMenuItem
          >
          <ElMenuItem
            v-else-if="teamDirectory.error"
            index="teams-retry"
            :route="route.fullPath"
            @click="refreshTeamDirectory"
            ><ElIcon><Refresh /></ElIcon>重新加载班组</ElMenuItem
          >
          <template v-else>
            <template v-for="{ profile, team } in workspaces" :key="profile.code">
              <ElSubMenu
                v-if="team"
                :index="`team-${team.id}`"
                :data-nav-index="`team-${team.id}`"
                class="factory-nav__team"
                :aria-label="profile.name + '工作台'"
              >
                <template #title
                  ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
                    ><FactoryNavIcon :name="teamIcons[profile.code]" /></ElIcon
                  ><span>{{ profile.name }}</span></template
                >
                <ElMenuItem
                  v-for="module in modulesFor(team)"
                  :key="module.value"
                  :index="`team-${team.id}:${module.value}`"
                  :route="moduleLocation(team, module)"
                  class="factory-nav__workspace-link"
                  :aria-label="`${profile.name} / ${module.label}`"
                  :aria-current="
                    activeIndex === `team-${team.id}:${module.value}` ? 'page' : undefined
                  "
                  ><span>{{ module.label }}</span
                  ><span
                    v-if="moduleCount(team, module.value)"
                    class="factory-nav__count"
                    :aria-label="`${module.value === 'movement' ? '待签收' : '待处理质量问题'} ${moduleCount(team, module.value)} 项`"
                    >{{
                      moduleCount(team, module.value)! > 99
                        ? '99+'
                        : moduleCount(team, module.value)
                    }}</span
                  >
                </ElMenuItem>
              </ElSubMenu>
              <ElMenuItem
                v-else
                :index="'missing-' + profile.code"
                class="factory-nav__missing"
                disabled
                >{{ profile.name }}<small>未配置</small></ElMenuItem
              >
            </template>
          </template>
        </ElSubMenu>
        <ElSubMenu
          index="materials"
          data-nav-index="materials"
          aria-label="流转查询"
          :class="{ 'factory-nav__current': activeGroup === 'materials' }"
          :aria-description="activeGroup === 'materials' ? '当前页面所属模块' : undefined"
        >
          <template #title
            ><ElIcon class="factory-nav__module-icon" aria-hidden="true"
              ><FactoryNavIcon name="flow" /></ElIcon
            ><span>流转查询</span
            ><span
              v-if="activeGroup === 'materials' && !compact"
              class="factory-nav__current-badge"
              aria-hidden="true"
              >当前</span
            ></template
          >
          <ElMenuItem
            v-for="link in materialLinks"
            :key="link.path"
            :index="link.path"
            :aria-label="link.label"
            :aria-current="route.path === link.path ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon :name="link.icon" /></ElIcon
            >{{ link.label }}</ElMenuItem
          >
        </ElSubMenu>
        <ElSubMenu
          v-if="isAdmin"
          index="settings"
          data-nav-index="settings"
          aria-label="系统设置"
          :class="{ 'factory-nav__current': activeGroup === 'settings' }"
          :aria-description="activeGroup === 'settings' ? '当前页面所属模块' : undefined"
        >
          <template #title
            ><ElIcon class="factory-nav__module-icon" aria-hidden="true"
              ><FactoryNavIcon name="settings" /></ElIcon
            ><span>系统设置</span
            ><span
              v-if="activeGroup === 'settings' && !compact"
              class="factory-nav__current-badge"
              aria-hidden="true"
              >当前</span
            ></template
          >
          <ElMenuItem
            index="/settings/teams"
            aria-label="班组管理"
            :aria-current="route.path === '/settings/teams' ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="workspaces" /></ElIcon
            >班组管理</ElMenuItem
          >
          <ElMenuItem
            index="/settings/accounts"
            aria-label="班组长管理"
            :aria-current="route.path === '/settings/accounts' ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="accounts" /></ElIcon
            >班组长管理</ElMenuItem
          >
          <ElMenuItem
            index="/settings/main-system"
            aria-label="主系统对接"
            :aria-current="route.path === '/settings/main-system' ? 'page' : undefined"
            ><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"
              ><FactoryNavIcon name="integration" /></ElIcon
            >主系统对接</ElMenuItem
          >
        </ElSubMenu>
      </ElMenu>
    </div>
  </nav>
</template>

<style scoped>
.factory-nav {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.factory-nav__scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 24px 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-padding-block: 24px;
  scrollbar-width: thin;
  scrollbar-color: #bdc9c1 transparent;
}
.factory-nav__scroll::-webkit-scrollbar {
  width: 5px;
}
.factory-nav__scroll::-webkit-scrollbar-thumb {
  border-radius: 5px;
  background: #bdc9c1;
}
.factory-nav :deep(.el-menu) {
  width: 100%;
  border: 0;
  --el-menu-base-level-padding: 12px;
  --el-menu-level-padding: 34px;
  --el-menu-item-height: 44px;
  --el-menu-sub-item-height: 38px;
  --el-menu-text-color: var(--muted);
  --el-menu-hover-bg-color: var(--primary-soft);
  --el-menu-active-color: var(--primary);
}
.factory-nav :deep(.el-sub-menu__title) {
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  font-weight: 450;
  padding-right: 24px;
}
.factory-nav :deep(.el-sub-menu__icon-arrow) {
  right: 8px;
  color: var(--muted);
  font-size: 11px;
  transition: transform var(--motion-standard) var(--motion-ease);
}
.factory-nav__current-badge {
  position: absolute;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  padding: 0 2px;
  border-radius: 4px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
  font-weight: 550;
  line-height: 18px;
  pointer-events: none;
}
.factory-nav--compact :deep(.factory-nav__current > .el-sub-menu__title::after) {
  content: '';
  position: absolute;
  right: 8px;
  top: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  pointer-events: none;
}
.factory-nav :deep(.el-menu--inline) {
  --el-transition-duration: var(--motion-standard);
}
.factory-nav :deep(.el-menu-item) {
  margin: 2px 0;
  border-radius: 6px;
  font-size: 14px;
}
.factory-nav :deep(.el-menu > .el-menu-item) {
  color: var(--text);
}
.factory-nav :deep(.el-menu > .el-menu-item > .el-icon),
.factory-nav :deep(.el-sub-menu__title > .el-icon:not(.el-sub-menu__icon-arrow)) {
  width: 24px;
  margin-right: 8px;
}
.factory-nav__scroll > :deep(.el-menu > .el-menu-item),
.factory-nav__scroll > :deep(.el-menu > .el-sub-menu) {
  margin: 4px 0;
}
.factory-nav :deep(.el-menu-item.is-active) {
  color: var(--primary);
  background: var(--primary-soft);
  font-weight: 550;
}
.factory-nav :deep(.el-sub-menu .el-menu-item.is-active::before) {
  position: absolute;
  left: 24px;
  height: 20px;
  width: 2px;
  background: var(--primary);
  content: '';
}
.factory-nav__missing small {
  margin-left: auto;
  font-size: 11px;
}
.factory-nav__count {
  min-width: 18px;
  margin-left: auto;
  padding: 0 5px;
  border-radius: 5px;
  color: var(--action-warm);
  background: var(--action-warm-soft);
  font-size: 11px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.factory-nav__module-icon {
  flex-shrink: 0;
  height: 20px;
}
.factory-nav__team-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  font-size: 20px;
}
.factory-nav--compact .factory-nav__scroll {
  padding-inline: 6px;
}
.factory-nav--compact :deep(.el-menu-item),
.factory-nav--compact :deep(.el-sub-menu__title),
.factory-nav--compact :deep(.el-menu-tooltip__trigger) {
  justify-content: center;
  padding: 0;
}
.factory-nav--compact :deep(.el-menu .el-icon:not(.el-sub-menu__icon-arrow)) {
  margin: 0;
}
.factory-nav--illustrated :deep(.el-menu) {
  background: transparent;
  --el-menu-item-height: 42px;
  --el-menu-sub-item-height: 40px;
  --el-menu-level-padding: 20px;
}
.factory-nav--illustrated :deep(.el-sub-menu__title),
.factory-nav--illustrated :deep(.el-menu > .el-menu-item) {
  font-weight: 550;
}
.factory-nav--illustrated :deep(.el-sub-menu > .el-menu) {
  background: transparent;
}
.factory-nav--illustrated :deep(.el-sub-menu .el-menu-item:not(.is-active)) {
  color: var(--muted);
}
.factory-nav--illustrated :deep(.factory-nav__team-icon) {
  width: 22px;
  margin-right: 10px;
  font-size: 19px;
  color: var(--muted);
}
.factory-nav--glass .factory-nav__scroll {
  padding: 0 14px 20px;
}
.factory-nav--glass :deep(.el-menu) {
  --el-menu-item-height: 42px;
  --el-menu-sub-item-height: 36px;
  --el-menu-level-padding: 20px;
  --el-menu-hover-bg-color: var(--primary-soft);
}
.factory-nav--glass :deep(.el-sub-menu__title),
.factory-nav--glass :deep(.el-menu-item) {
  transition:
    background-color var(--motion-standard) var(--motion-ease),
    box-shadow var(--motion-standard) var(--motion-ease),
    color var(--motion-standard) ease;
}
.factory-nav--glass :deep(.el-sub-menu__title) {
  border-radius: 8px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
}
.factory-nav--glass :deep(.el-sub-menu__title > .factory-nav__module-icon) {
  width: 20px;
  height: 20px;
  margin-right: 10px;
  color: #52695d;
  transition: color var(--motion-standard) ease;
}
.factory-nav--glass :deep(.factory-nav__current > .el-sub-menu__title > .factory-nav__module-icon),
.factory-nav--glass
  :deep(.el-sub-menu:not(.is-disabled) > .el-sub-menu__title:hover > .factory-nav__module-icon) {
  color: var(--primary);
}
.factory-nav--glass :deep(.factory-nav__current > .el-sub-menu__title) {
  color: var(--text);
  font-weight: 550;
}
.factory-nav--glass .factory-nav__current-badge {
  display: none;
}
.factory-nav--glass :deep(.el-menu--inline) {
  padding-block: 2px 6px;
}
.factory-nav--glass :deep(.el-menu-item) {
  margin: 2px 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 450;
}
.factory-nav--glass:not(.factory-nav--compact) :deep(.el-sub-menu .el-menu-item) {
  padding-inline: 32px 10px;
}
.factory-nav--glass :deep(.el-sub-menu .el-menu-item:not(.is-active)) {
  color: #596a61;
}
.factory-nav--glass
  :deep(.el-sub-menu:not(.is-disabled) > .el-sub-menu__title:is(:hover, :focus-visible)),
.factory-nav--glass
  :deep(.el-menu-item:not(.is-active):not(.is-disabled):is(:hover, :focus-visible)) {
  color: var(--primary);
  background: var(--glass-hover-fill);
  box-shadow:
    inset 0 0 0 1px var(--glass-interaction-edge),
    var(--glass-hover-shadow);
}
.factory-nav--glass :deep(.el-menu-item.is-active:not(.is-disabled)),
.factory-nav--glass.factory-nav--compact
  :deep(.factory-nav__current:not(.is-disabled) > .el-sub-menu__title) {
  color: var(--primary);
  background: var(--glass-selected-fill);
  box-shadow:
    inset 0 0 0 1px var(--glass-interaction-edge),
    var(--glass-selected-shadow);
  font-weight: 550;
}
.factory-nav--glass :deep(.el-sub-menu .el-menu-item.is-active::before) {
  left: 20px;
  height: 14px;
  width: 2px;
  border-radius: 2px;
}
.factory-nav--glass :deep(.el-menu-item:not(.is-disabled):focus-visible),
.factory-nav--glass :deep(.el-sub-menu:not(.is-disabled) > .el-sub-menu__title:focus-visible) {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.factory-nav--glass :deep(.factory-nav__team-icon) {
  width: 20px;
  height: 18px;
  margin-right: 8px;
  color: inherit;
}
.factory-nav--glass :deep(.factory-nav__team-icon .tabler-icon) {
  width: 18px;
  height: 18px;
}
.factory-nav--glass.factory-nav--compact .factory-nav__scroll {
  padding-inline: 6px;
}
.factory-nav--glass.factory-nav--compact
  :deep(.el-sub-menu__title > .el-icon:not(.el-sub-menu__icon-arrow)) {
  margin-right: 0;
}
@media (max-width: 1320px) and (min-width: 641px) {
  .factory-nav--glass:not(.factory-nav--compact) .factory-nav__scroll {
    padding-inline: 10px;
  }
  .factory-nav--glass :deep(.el-menu) {
    --el-menu-base-level-padding: 9px;
    --el-menu-level-padding: 12px;
  }
  .factory-nav--glass:not(.factory-nav--compact) :deep(.el-sub-menu .el-menu-item) {
    padding-left: 29px;
  }
  .factory-nav--glass :deep(.el-sub-menu .el-menu-item.is-active::before) {
    left: 17px;
  }
}
@media (max-height: 820px) {
  .factory-nav--glass :deep(.el-menu) {
    --el-menu-item-height: 40px;
    --el-menu-sub-item-height: 34px;
  }
}
.factory-nav:not(.factory-nav--compact) :deep(.factory-nav__team > .el-sub-menu__title) {
  height: 34px;
  padding-left: 30px;
  font-size: 13px;
}
.factory-nav:not(.factory-nav--compact) :deep(.el-menu-item.factory-nav__workspace-link) {
  height: 32px;
  padding-inline: 48px 12px;
  font-size: 13px;
}
.factory-nav:not(.factory-nav--compact)
  :deep(.el-menu-item.factory-nav__workspace-link.is-active::before) {
  left: 36px;
}
</style>

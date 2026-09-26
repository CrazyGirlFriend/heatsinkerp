<script setup lang="ts">
import { Search, OfficeBuilding, Setting, Refresh, House, Box, Connection, HotWater, Tools, Scissor, EditPen, Coin, CircleCheck, Tickets, Aim, Location, User } from '@element-plus/icons-vue'
import { ElIcon, ElMenu, ElMenuItem, ElSubMenu, type MenuInstance } from 'element-plus'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { isAdmin } from '@/stores/auth'
import { teamDirectory, refreshTeamDirectory } from '@/stores/teamDirectory'
import { configuredTeamWorkspaces } from '@/config/teamWorkspaces'

const props = withDefaults(defineProps<{ compact?: boolean; illustrated?: boolean; overview?: boolean }>(), { compact: false, illustrated: false })
const teamIcons = { 'FACTORY-WAREHOUSE': Box, 'FACTORY-ROLL': Connection, 'FACTORY-ANNEAL': HotWater, 'FACTORY-GRIND': Tools,
  'FACTORY-WIRE': Scissor, 'FACTORY-ENGRAVE': EditPen, 'FACTORY-PLATE': Coin, 'FACTORY-QC': CircleCheck }
const route = useRoute()
const menu = ref<MenuInstance>()
const activeGroup = computed(() => route.path.startsWith('/settings/') ? 'settings' : ['/', '/factory-stock', '/factory-analysis'].includes(route.path) ? 'factory' : ['/transfer-batches', '/transfer-batches/scan', '/material-trace'].includes(route.path) ? 'materials' : 'teams')
watch([() => route.path, () => props.compact], async () => {
  await nextTick()
  if (!props.compact && !props.overview) menu.value?.open(activeGroup.value)
})
const workspaces = computed(() => configuredTeamWorkspaces(teamDirectory.items))
const materialLinks = computed(() => [
  { path: '/transfer-batches', label: '转料记录', icon: Tickets },
  { path: '/transfer-batches/scan', label: '扫码查询', icon: Aim },
  ...(isAdmin.value ? [{ path: '/material-trace', label: '全链路追踪', icon: Location }] : []),
])
</script>

<template>
  <nav class="factory-nav" :class="{ 'factory-nav--compact': compact, 'factory-nav--illustrated': illustrated, 'factory-nav--overview': overview }" aria-label="主导航">
    <ElMenu ref="menu" router tabindex="0" :default-active="route.path" :default-openeds="overview ? [] : [activeGroup]" :collapse="compact" :collapse-transition="false" popper-class="factory-nav-popup">
      <ElMenuItem v-if="overview" index="/" aria-label="库存总览" aria-current="page"><ElIcon><House /></ElIcon><span>全厂总览</span></ElMenuItem>
      <ElSubMenu v-else index="factory" aria-label="全厂总览">
        <template #title><ElIcon><House /></ElIcon><span>全厂总览</span></template>
        <ElMenuItem index="/" aria-label="库存总览" :aria-current="route.path === '/' ? 'page' : undefined">库存总览</ElMenuItem>
        <ElMenuItem index="/factory-stock" aria-label="库存明细" :aria-current="route.path === '/factory-stock' ? 'page' : undefined">库存明细</ElMenuItem>
      </ElSubMenu>
      <ElSubMenu index="teams" aria-label="班组工作台">
        <template #title><ElIcon><OfficeBuilding /></ElIcon><span>班组工作台</span></template>
        <ElMenuItem v-if="teamDirectory.loading && !teamDirectory.loaded" index="teams-loading" disabled>加载班组…</ElMenuItem>
        <ElMenuItem v-else-if="teamDirectory.error" index="teams-retry" :route="route.fullPath" @click="refreshTeamDirectory"><ElIcon><Refresh /></ElIcon>重新加载班组</ElMenuItem>
        <template v-else>
          <template v-for="{ profile, team } in workspaces" :key="profile.code">
            <ElMenuItem v-if="team" :index="'/team-workspaces/' + team.id" class="factory-nav__team-link" :aria-label="profile.name + '工作台'" :aria-current="route.path === '/team-workspaces/' + team.id ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><component :is="teamIcons[profile.code as keyof typeof teamIcons]" /></ElIcon>{{ profile.name }}</ElMenuItem>
            <ElMenuItem v-else :index="'missing-' + profile.code" class="factory-nav__missing" disabled>{{ profile.name }}<small>未配置</small></ElMenuItem>
          </template>
        </template>
      </ElSubMenu>
      <template v-if="overview"><ElMenuItem index="/factory-stock"><ElIcon><Box /></ElIcon><span>库存明细</span></ElMenuItem><ElMenuItem v-for="link in materialLinks" :key="link.path" :index="link.path" :aria-label="link.label"><ElIcon><component :is="link.icon" /></ElIcon><span>{{ link.label }}</span></ElMenuItem></template>
      <ElSubMenu v-else index="materials" aria-label="流转查询">
        <template #title><ElIcon><Search /></ElIcon><span>流转查询</span></template>
        <ElMenuItem v-for="link in materialLinks" :key="link.path" :index="link.path" :aria-label="link.label" :aria-current="route.path === link.path ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><component :is="link.icon" /></ElIcon>{{ link.label }}</ElMenuItem>
      </ElSubMenu>
      <ElSubMenu v-if="isAdmin" index="settings" aria-label="系统设置">
        <template #title><ElIcon><Setting /></ElIcon><span>系统设置</span></template>
        <ElMenuItem index="/settings/teams" aria-label="班组管理" :aria-current="route.path === '/settings/teams' ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><OfficeBuilding /></ElIcon>班组管理</ElMenuItem>
        <ElMenuItem index="/settings/accounts" aria-label="班组长管理" :aria-current="route.path === '/settings/accounts' ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><User /></ElIcon>班组长管理</ElMenuItem>
        <ElMenuItem index="/settings/main-system" aria-label="主系统对接" :aria-current="route.path === '/settings/main-system' ? 'page' : undefined"><ElIcon v-if="illustrated" class="factory-nav__team-icon" aria-hidden="true"><Connection /></ElIcon>主系统对接</ElMenuItem>
      </ElSubMenu>
    </ElMenu>
  </nav>
</template>

<style scoped>
.factory-nav { flex: 1; min-height: 0; padding: 16px 10px; overflow-y: auto; scrollbar-width: thin; }
.factory-nav :deep(.el-menu) { width: 100%; border: 0; --el-menu-base-level-padding: 12px; --el-menu-level-padding: 34px; --el-menu-item-height: 44px; --el-menu-sub-item-height: 38px; --el-menu-text-color: var(--muted); --el-menu-hover-bg-color: var(--surface-soft); --el-menu-active-color: var(--primary); }
.factory-nav :deep(.el-sub-menu__title) { border-radius: 6px; color: var(--text); font-size: 14px; font-weight: 450; }
.factory-nav :deep(.el-menu-item) { margin: 2px 0; border-radius: 6px; font-size: 14px; }
.factory-nav :deep(.el-menu > .el-menu-item) { color: var(--text); }
.factory-nav :deep(.el-menu > .el-menu-item > .el-icon), .factory-nav :deep(.el-sub-menu__title > .el-icon:not(.el-sub-menu__icon-arrow)) { width: 24px; margin-right: 8px; }
.factory-nav > :deep(.el-menu > .el-menu-item), .factory-nav > :deep(.el-menu > .el-sub-menu) { margin: 4px 0; }
.factory-nav :deep(.el-menu-item.is-active) { color: var(--primary); background: var(--surface-soft); font-weight: 550; }
.factory-nav :deep(.el-sub-menu .el-menu-item.is-active::before) { position: absolute; left: 24px; height: 20px; width: 2px; background: var(--primary); content: ''; }
.factory-nav__missing small { margin-left: auto; font-size: 11px; }
.factory-nav--compact { padding-inline: 6px; }
.factory-nav--compact :deep(.el-menu-item), .factory-nav--compact :deep(.el-sub-menu__title), .factory-nav--compact :deep(.el-menu-tooltip__trigger) { justify-content: center; padding: 0; }
.factory-nav--compact :deep(.el-menu .el-icon:not(.el-sub-menu__icon-arrow)) { margin: 0; }
.factory-nav--illustrated { padding: 14px 10px; }
.factory-nav--illustrated :deep(.el-menu) { background: transparent; --el-menu-item-height: 42px; --el-menu-sub-item-height: 40px; --el-menu-level-padding: 20px; }
.factory-nav--illustrated :deep(.el-sub-menu__title), .factory-nav--illustrated :deep(.el-menu > .el-menu-item) { font-weight: 550; }
.factory-nav--illustrated :deep(.el-sub-menu > .el-menu) { background: transparent; }
.factory-nav--illustrated :deep(.el-sub-menu .el-menu-item:not(.is-active)) { color: var(--muted); }
.factory-nav--illustrated :deep(.factory-nav__team-icon) { width: 22px; margin-right: 10px; font-size: 19px; color: var(--muted); }
.factory-nav--illustrated.factory-nav--compact { padding-inline: 6px; }
.factory-nav--overview :deep(.el-menu-item), .factory-nav--overview :deep(.el-sub-menu__title) { font-size: 14px; font-weight: 450; }
.factory-nav--overview :deep(.el-menu > .el-menu-item), .factory-nav--overview :deep(.el-sub-menu__title) { height: 42px; line-height: 42px; }
.factory-nav--overview :deep(.el-menu-item.is-active) { font-weight: 550; }
.factory-nav--overview :deep(.el-menu .el-icon) { font-size: 19px; }
</style>

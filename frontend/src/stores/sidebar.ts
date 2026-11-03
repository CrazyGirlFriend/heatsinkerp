import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { currentUser } from '@/stores/auth'
import type { LocationQuery } from 'vue-router'
import { teamWorkspaceModuleFor, type TeamWorkspaceSection } from '@/config/teamWorkspaces'

export const useSidebarStore = defineStore('sidebar', () => {
  const compact = ref(false)
  const opened = ref<string[]>([])
  const page = ref('')
  const workspaceQueries = ref<Record<string, LocationQuery>>({})
  const workspaceModules = ref<Record<string, TeamWorkspaceSection>>({})
  const workspaceCounts = ref<Record<string, { pending: number; quality: number }>>({})
  let storageKey = ''

  // Preferences belong to the signed-in account, never to its permissions.
  watch(
    () => (currentUser.value ? `${currentUser.value.id}:${currentUser.value.role}` : ''),
    (account) => {
      storageKey = ''
      compact.value = false
      opened.value = []
      page.value = ''
      workspaceQueries.value = {}
      workspaceModules.value = {}
      workspaceCounts.value = {}
      if (!account) return
      const key = `heatsink-sidebar:${account}`
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null')
        if (saved && typeof saved === 'object') {
          compact.value = saved.compact === true
          opened.value = Array.isArray(saved.opened)
            ? saved.opened.filter(
                (item: unknown) =>
                  typeof item === 'string' &&
                  /^(factory|management|teams|materials|settings|engineering|team-\d+)$/.test(item),
              )
            : []
          page.value = typeof saved.page === 'string' ? saved.page.split('?')[0] : ''
          if (['/process-routes', '/business-people', '/dispatch-schedules'].includes(page.value))
            opened.value = opened.value.map((item) => (item === 'teams' ? 'management' : item))
        }
      } catch {
        /* Storage may be unavailable; navigation still works in memory. */
      }
      storageKey = key
    },
    { immediate: true, flush: 'sync' },
  )

  function rememberWorkspace(teamId: string, section: TeamWorkspaceSection, query: LocationQuery) {
    // A notification is a one-time destination, not a saved list filter.
    if (query.business_notice || query.notice) return
    workspaceQueries.value[`${teamId}:${section}`] = { ...query }
    const module = teamWorkspaceModuleFor(section)
    if (module) workspaceModules.value[`${teamId}:${module.value}`] = section
  }

  function workspaceLocation(teamId: string, section: TeamWorkspaceSection) {
    return {
      path: `/team-workspaces/${teamId}`,
      query:
        workspaceQueries.value[`${teamId}:${section}`] ||
        (section === 'stock' ? {} : { tab: section }),
    }
  }

  watch(
    [compact, opened, page],
    () => {
      if (!storageKey) return
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ compact: compact.value, opened: opened.value, page: page.value }),
        )
      } catch {
        /* Private browsing must not prevent navigation. */
      }
    },
    { deep: true, flush: 'sync' },
  )

  return {
    compact,
    opened,
    page,
    workspaceQueries,
    workspaceModules,
    workspaceCounts,
    rememberWorkspace,
    workspaceLocation,
  }
})

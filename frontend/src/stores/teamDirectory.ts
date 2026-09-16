import { readonly, ref, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { teamDirectoryApi } from '@/services/teamDirectoryApi'
import type { Team } from '@/services/adminApi'
import { appPinia, useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'

export const useTeamDirectoryStore = defineStore('teamDirectory', () => {
  const items = ref<Team[]>([])
  const loading = ref(false)
  const error = ref('')
  const loaded = ref(false)
  const authStore = useAuthStore()
  const accessStore = useAccessStore()
  const { isAuthenticated } = storeToRefs(authStore)
  const { canEnterSite } = storeToRefs(accessStore)
  let requestVersion = 0

  function clearTeamDirectory(): void {
    requestVersion += 1
    items.value = []
    loading.value = false
    error.value = ''
    loaded.value = false
  }

  async function refreshTeamDirectory(): Promise<void> {
    if (!canEnterSite.value || !isAuthenticated.value) {
      clearTeamDirectory()
      return
    }
    const version = ++requestVersion
    const token = authStore.session?.access_token
    loading.value = true
    error.value = ''
    try {
      const directory = await teamDirectoryApi.listTeamDirectory()
      if (version !== requestVersion || token !== authStore.session?.access_token
        || !canEnterSite.value || !isAuthenticated.value) return
      items.value = directory
      loaded.value = true
    } catch (requestError) {
      if (version !== requestVersion) return
      items.value = []
      loaded.value = false
      error.value = requestError instanceof Error ? requestError.message : '班组目录加载失败'
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  watch(
    [canEnterSite, () => authStore.session?.access_token, isAuthenticated],
    () => {
      clearTeamDirectory()
      if (canEnterSite.value && isAuthenticated.value) void refreshTeamDirectory()
    },
    // login() persists the token before updating reactive state. Clear stale
    // account data synchronously when the session or access gate changes.
    { immediate: true, flush: 'sync' },
  )

  return { items, loading, error, loaded, clearTeamDirectory, refreshTeamDirectory }
})

const defaultTeamDirectoryStore = useTeamDirectoryStore(appPinia)

export const teamDirectory = readonly(defaultTeamDirectoryStore)

export function clearTeamDirectory(): void {
  defaultTeamDirectoryStore.clearTeamDirectory()
}

export function refreshTeamDirectory(): Promise<void> {
  return defaultTeamDirectoryStore.refreshTeamDirectory()
}

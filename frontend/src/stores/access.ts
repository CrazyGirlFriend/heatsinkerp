import { computed, onScopeDispose, readonly, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { accessApi, AccessError } from '@/services/accessApi'
import { notifySiteAccessRequired, onSiteAccessRequired } from '@/services/siteAccessEvents'
import { appPinia } from './pinia'

export { accessHttpClient } from '@/services/accessApi'
export { SITE_ACCESS_REQUIRED_EVENT, notifySiteAccessRequired } from '@/services/siteAccessEvents'
export { appPinia } from './pinia'

type AccessStatus = 'unknown' | 'checking' | 'unlocked' | 'locked' | 'error'

export const useAccessStore = defineStore('access', () => {
  const status = ref<AccessStatus>('unknown')
  const enabled = ref(true)
  const loading = ref(false)
  const error = ref('')
  const canEnterSite = computed(() => status.value === 'unlocked')

  let pendingCheck: Promise<boolean> | null = null
  let revision = 0

  /** Access is server-owned. Nothing in local/session storage is used to unlock it. */
  function checkSiteAccess(force = false): Promise<boolean> {
    if (pendingCheck) return pendingCheck
    if (!force && status.value !== 'unknown' && status.value !== 'checking')
      return Promise.resolve(canEnterSite.value)
    const checkRevision = revision
    status.value = 'checking'
    error.value = ''
    pendingCheck = (async () => {
      try {
        const result = await accessApi.status()
        if (checkRevision !== revision) return false
        enabled.value = result.enabled
        status.value = !result.enabled || result.unlocked ? 'unlocked' : 'locked'
        return canEnterSite.value
      } catch (requestError) {
        if (checkRevision !== revision) return false
        status.value = 'error'
        error.value = requestError instanceof Error ? requestError.message : '访问验证失败，请重试'
        return false
      } finally {
        pendingCheck = null
      }
    })()
    return pendingCheck
  }

  async function unlockSite(password: string): Promise<boolean> {
    if (loading.value) return false
    loading.value = true
    error.value = ''
    try {
      await accessApi.unlock(password)
      // Verify that the browser accepted the server cookie before revealing any page.
      const unlocked = await checkSiteAccess(true)
      if (!unlocked && status.value !== 'error')
        error.value = '访问验证尚未生效，请允许本站 Cookie 后重试'
      return unlocked
    } catch (requestError) {
      status.value =
        requestError instanceof AccessError && [401, 422, 429].includes(requestError.status)
          ? 'locked'
          : 'error'
      error.value = requestError instanceof Error ? requestError.message : '访问验证失败，请重试'
      return false
    } finally {
      loading.value = false
    }
  }

  function lockSiteAccess(): void {
    revision += 1
    status.value = 'locked'
    enabled.value = true
    error.value = '访问验证已过期，请重新输入访问口令'
  }

  onScopeDispose(onSiteAccessRequired(lockSiteAccess))

  return {
    status,
    enabled,
    loading,
    error,
    canEnterSite,
    checkSiteAccess,
    unlockSite,
    notifySiteAccessRequired,
  }
})

const defaultAccessStore = useAccessStore(appPinia)
const accessRefs = storeToRefs(defaultAccessStore)
let defaultPendingCheck: Promise<boolean> | null = null

// Keep the existing module API while pages migrate to useAccessStore() at
// their own pace. State remains readonly to callers, as it was previously.
export const accessState = readonly(defaultAccessStore)
export const canEnterSite = accessRefs.canEnterSite

export function checkSiteAccess(force = false): Promise<boolean> {
  // Pinia wraps actions to support subscriptions, which otherwise changes a
  // returned Promise's identity. Preserve the legacy concurrent-call contract
  // at the compatibility boundary as well as inside the store action.
  if (defaultPendingCheck) return defaultPendingCheck
  const check = defaultAccessStore.checkSiteAccess(force)
  defaultPendingCheck = check
  void check.finally(() => {
    if (defaultPendingCheck === check) defaultPendingCheck = null
  })
  return check
}

export function unlockSite(password: string): Promise<boolean> {
  return defaultAccessStore.unlockSite(password)
}

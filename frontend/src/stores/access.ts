import { computed, readonly, ref } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import axios, { type AxiosInstance, type Method } from 'axios'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
export const SITE_ACCESS_REQUIRED_EVENT = 'heatsink-site-access-required'

type AccessStatus = 'unknown' | 'checking' | 'unlocked' | 'locked' | 'error'

interface ServerAccessStatus {
  enabled: boolean
  unlocked: boolean
}

class AccessError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
  }
}

interface AccessRequestOptions {
  method?: Method
  body?: unknown
}

// The access gate deliberately uses its own tiny Axios client. Importing the
// authenticated shared client here would create httpClient -> access ->
// httpClient, because that client calls notifySiteAccessRequired on HTTP 423.
export const accessHttpClient: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/access`,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  },
})

async function accessRequest(path: string, options: AccessRequestOptions = {}): Promise<unknown> {
  try {
    const response = await accessHttpClient.request<unknown>({
      url: path,
      method: options.method || 'GET',
      data: options.body,
    })
    return response.status === 204 ? null : response.data
  } catch (requestError) {
    if (!axios.isAxiosError(requestError) || !requestError.response) {
      throw new AccessError('无法连接服务器，访问验证尚未完成，请检查网络后重试')
    }
    const body: unknown = requestError.response.data
    const status = requestError.response.status
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
    throw new AccessError(
      typeof detail === 'string' ? detail : status === 429 ? '尝试次数过多，请稍后重试' : '访问验证失败，请重试',
      status,
    )
  }
}

function validateStatus(value: unknown): ServerAccessStatus {
  if (!value || typeof value !== 'object' || !('enabled' in value) || !('unlocked' in value)
    || typeof value.enabled !== 'boolean' || typeof value.unlocked !== 'boolean') {
    throw new AccessError('服务器未返回有效的访问状态，请重试')
  }
  return { enabled: value.enabled, unlocked: value.unlocked }
}

/**
 * Shared application Pinia. Compatibility exports below and the Vue app use
 * this same instance, so router guards are safe even before app.mount().
 * Tests can still pass a fresh Pinia to any use*Store function.
 */
export const appPinia = createPinia()

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
    if (!force && status.value !== 'unknown' && status.value !== 'checking') return Promise.resolve(canEnterSite.value)
    const checkRevision = revision
    status.value = 'checking'
    error.value = ''
    pendingCheck = (async () => {
      try {
        const result = validateStatus(await accessRequest('/status'))
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
      await accessRequest('/unlock', { method: 'POST', body: { password } })
      // Verify that the browser accepted the server cookie before revealing any page.
      const unlocked = await checkSiteAccess(true)
      if (!unlocked && status.value !== 'error') error.value = '访问验证尚未生效，请允许本站 Cookie 后重试'
      return unlocked
    } catch (requestError) {
      status.value = requestError instanceof AccessError && [401, 422, 429].includes(requestError.status) ? 'locked' : 'error'
      error.value = requestError instanceof Error ? requestError.message : '访问验证失败，请重试'
      return false
    } finally {
      loading.value = false
    }
  }

  function notifySiteAccessRequired(): void {
    revision += 1
    status.value = 'locked'
    enabled.value = true
    error.value = '访问验证已过期，请重新输入访问口令'
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SITE_ACCESS_REQUIRED_EVENT))
  }

  return { status, enabled, loading, error, canEnterSite, checkSiteAccess, unlockSite, notifySiteAccessRequired }
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

export function notifySiteAccessRequired(): void {
  defaultAccessStore.notifySiteAccessRequired()
}

import { computed, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import {
  adminApi,
  AUTH_SESSION_STORAGE_KEY,
  normalizeAccount,
  type Account,
  type AuthSession,
  type LoginPayload,
  type UserRole,
} from '@/services/adminApi'
import { appPinia } from '@/stores/access'

function localStorageValue(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function isExpired(session: AuthSession): boolean {
  if (!session.expires_at) return false
  const expiresAt = Date.parse(session.expires_at)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function parseStoredSession(): AuthSession | null {
  const storage = localStorageValue()
  const serialized = storage?.getItem(AUTH_SESSION_STORAGE_KEY)
  if (!serialized) return null
  try {
    const raw = JSON.parse(serialized) as Partial<AuthSession> & {
      accessToken?: string
      token?: string
      tokenType?: string
    }
    const accessToken = raw.access_token || raw.accessToken || raw.token
    if (!accessToken || !raw.user) {
      storage?.removeItem(AUTH_SESSION_STORAGE_KEY)
      return null
    }
    const session: AuthSession = {
      access_token: accessToken,
      token_type: raw.token_type || raw.tokenType || 'Bearer',
      expires_at: raw.expires_at,
      user: normalizeAccount(raw.user),
    }
    if (isExpired(session) || !session.user.active) {
      storage?.removeItem(AUTH_SESSION_STORAGE_KEY)
      return null
    }
    return session
  } catch {
    storage?.removeItem(AUTH_SESSION_STORAGE_KEY)
    return null
  }
}

function persistSession(session: AuthSession | null): void {
  const storage = localStorageValue()
  if (!storage) return
  if (session) storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
  else storage.removeItem(AUTH_SESSION_STORAGE_KEY)
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(parseStoredSession())
  const initialized = ref(true)
  const loading = ref(false)
  const error = ref('')
  const currentUserError = ref('')
  let profileRequestVersion = 0

  const currentUser = computed<Account | null>(() => session.value?.user ?? null)
  const isAuthenticated = computed(() => Boolean(session.value && !isExpired(session.value)))
  const isAdmin = computed(() => currentUser.value?.role === 'ADMIN')
  const isTeamAccount = computed(() => currentUser.value?.role === 'TEAM')

  function hasRole(required: UserRole | UserRole[]): boolean {
    const roles = Array.isArray(required) ? required : [required]
    return Boolean(currentUser.value && roles.includes(currentUser.value.role))
  }

  function canAccess(required?: UserRole | UserRole[]): boolean {
    return isAuthenticated.value && (!required || hasRole(required))
  }

  function restoreSession(): AuthSession | null {
    ++profileRequestVersion
    const restored = parseStoredSession()
    session.value = restored
    initialized.value = true
    if (!restored) persistSession(null)
    return restored
  }

  async function login(payload: LoginPayload): Promise<Account> {
    loading.value = true
    error.value = ''
    try {
      const authenticated = await adminApi.login({
        username: payload.username.trim(),
        password: payload.password,
      })
      if (!authenticated.user.active) throw new Error('账号已停用，请联系管理员')
      // Persist first: reactive login watchers may immediately issue authorized
      // requests (team directory / initial page data).
      persistSession(authenticated)
      session.value = authenticated
      currentUserError.value = ''
      initialized.value = true
      return authenticated.user
    } catch (loginError) {
      const accessLocked = loginError instanceof Error && 'status' in loginError && loginError.status === 423
      if (!accessLocked) {
        session.value = null
        persistSession(null)
      }
      error.value = loginError instanceof Error ? loginError.message : '登录失败，请稍后重试'
      throw loginError
    } finally {
      loading.value = false
    }
  }

  function clearSession(): void {
    ++profileRequestVersion
    session.value = null
    error.value = ''
    currentUserError.value = ''
    initialized.value = true
    persistSession(null)
  }

  async function refreshCurrentUser(): Promise<Account | null> {
    if (!session.value || isExpired(session.value)) {
      clearSession()
      return null
    }
    const token = session.value.access_token
    const version = ++profileRequestVersion
    try {
      const user = await adminApi.currentUser()
      if (version !== profileRequestVersion || session.value?.access_token !== token) return currentUser.value
      if (!user.active) {
        clearSession()
        return null
      }
      session.value = { ...session.value, user }
      currentUserError.value = ''
      persistSession(session.value)
      return user
    } catch (refreshError) {
      if (version !== profileRequestVersion || session.value?.access_token !== token) return currentUser.value
      currentUserError.value = refreshError instanceof Error ? refreshError.message : '账号信息刷新失败'
      if (refreshError instanceof Error && 'status' in refreshError
        && (refreshError as { status?: number }).status === 401) clearSession()
      throw refreshError
    }
  }

  async function logout(): Promise<void> {
    loading.value = true
    try {
      if (session.value) await adminApi.logout().catch(() => undefined)
    } finally {
      clearSession()
      loading.value = false
    }
  }

  return {
    session,
    initialized,
    loading,
    error,
    currentUserError,
    currentUser,
    isAuthenticated,
    isAdmin,
    isTeamAccount,
    hasRole,
    canAccess,
    login,
    logout,
    clearSession,
    restoreSession,
    refreshCurrentUser,
  }
})

const defaultAuthStore = useAuthStore(appPinia)
const authRefs = storeToRefs(defaultAuthStore)

// Compatibility exports keep existing pages and router guards stable while
// exposing useAuthStore() as the canonical Pinia API for new code.
export const authState = defaultAuthStore
export const currentUser = authRefs.currentUser
export const isAuthenticated = authRefs.isAuthenticated
export const isAdmin = authRefs.isAdmin
export const isTeamAccount = authRefs.isTeamAccount

export function hasRole(required: UserRole | UserRole[]): boolean {
  return defaultAuthStore.hasRole(required)
}

export function canAccess(required?: UserRole | UserRole[]): boolean {
  return defaultAuthStore.canAccess(required)
}

export function restoreSession(): AuthSession | null {
  return defaultAuthStore.restoreSession()
}

export function login(payload: LoginPayload): Promise<Account> {
  return defaultAuthStore.login(payload)
}

export function refreshCurrentUser(): Promise<Account | null> {
  return defaultAuthStore.refreshCurrentUser()
}

export function clearSession(): void {
  defaultAuthStore.clearSession()
}

export function logout(): Promise<void> {
  return defaultAuthStore.logout()
}

if (typeof window !== 'undefined') {
  window.addEventListener('heatsink-auth-expired', clearSession)
}

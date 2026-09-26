import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { currentUser } from '@/stores/auth'

export const useSidebarStore = defineStore('sidebar', () => {
  const compact = ref(false)
  const opened = ref<string[]>([])
  const page = ref('')
  let storageKey = ''

  // Preferences belong to the signed-in account, never to its permissions.
  watch(() => currentUser.value ? `${currentUser.value.id}:${currentUser.value.role}` : '', (account) => {
    storageKey = ''
    compact.value = false; opened.value = []; page.value = ''
    if (!account) return
    const key = `heatsink-sidebar:${account}`
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null')
      if (saved && typeof saved === 'object') {
        compact.value = saved.compact === true
        opened.value = Array.isArray(saved.opened) ? saved.opened.filter((item: unknown) => typeof item === 'string' && /^(factory|teams|materials|settings|team-\d+)$/.test(item)) : []
        page.value = typeof saved.page === 'string' ? saved.page : ''
      }
    } catch { /* Storage may be unavailable; navigation still works in memory. */ }
    storageKey = key
  }, { immediate: true, flush: 'sync' })

  watch([compact, opened, page], () => {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify({ compact: compact.value, opened: opened.value, page: page.value })) }
    catch { /* Private browsing must not prevent navigation. */ }
  }, { deep: true, flush: 'sync' })

  return { compact, opened, page }
})

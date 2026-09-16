import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { InventoryConnection } from '@/services/inventoryStream'
import { subscribeSharedInventoryChanges } from '@/services/inventoryChanges'

export function useLiveRefresh(refresh: () => Promise<void>, options: {
  enabled?: () => boolean
  busy?: () => boolean
} = {}) {
  const mounted = ref(false), hidden = ref(true)
  const state = ref<InventoryConnection>('connecting'), failure = ref('')
  const enabled = computed(() => mounted.value && !hidden.value && (options.enabled?.() ?? true))
  const busy = computed(() => options.busy?.() ?? false)
  let stop: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let queued = false, running = false, epoch = 0

  function schedule() {
    if (!enabled.value || !queued || running || busy.value || timer) return
    timer = setTimeout(() => { timer = undefined; void drain() }, 100)
  }
  async function drain() {
    if (!enabled.value || busy.value || running || !queued) return
    queued = false; running = true
    const current = epoch
    try {
      await refresh()
      if (current === epoch) failure.value = ''
    } catch {
      if (current === epoch) failure.value = '同步失败，当前保留上次数据'
    } finally {
      running = false
      schedule()
    }
  }
  function request() { if (enabled.value) { queued = true; schedule() } }
  watch(busy, schedule)
  watch(enabled, (active) => {
    ++epoch; stop?.(); stop = undefined
    clearTimeout(timer); timer = undefined; queued = false
    if (!active) return
    const current = epoch
    state.value = 'connecting'
    stop = subscribeSharedInventoryChanges({
      onData() { if (current === epoch) request() },
      onState(value) { if (current === epoch) state.value = value },
    })
  }, { flush: 'sync' })
  function visibility() { hidden.value = document.hidden }
  onMounted(() => { visibility(); mounted.value = true; document.addEventListener('visibilitychange', visibility) })
  onBeforeUnmount(() => { mounted.value = false; document.removeEventListener('visibilitychange', visibility) })
  const message = computed(() => !enabled.value ? '' : failure.value || (state.value === 'reconnecting'
    ? '实时连接中断，正在重连；当前保留上次数据' : state.value === 'expired' ? '登录已失效，请重新登录' : ''))
  return { message, request }
}

import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { processRouteApi } from '@/services/processRouteApi'
import { showToast } from '@/stores/toast'
import type { ProcessRoute } from '@/types/processRoute'

export function useProcessRouteView() {
  const route = shallowRef<ProcessRoute | null>(null)
  const loading = ref(false)
  let generation = 0
  function close() {
    ++generation
    route.value = null
    loading.value = false
  }
  async function open(id: number) {
    const request = ++generation
    route.value = null
    loading.value = true
    try {
      const result = await processRouteApi.detail(id)
      if (request === generation) route.value = result
    } catch (error) {
      if (request === generation)
        showToast(error instanceof Error ? error.message : '工艺读取失败', 'error')
    } finally {
      if (request === generation) loading.value = false
    }
  }
  onBeforeUnmount(close)
  return { route, loading, open, close }
}

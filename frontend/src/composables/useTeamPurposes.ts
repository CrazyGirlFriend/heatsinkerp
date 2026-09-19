import { onBeforeUnmount, ref, watch } from 'vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamPurpose } from '@/types/teamBusiness'

export function useTeamPurposes(teamId: () => number | null) {
  const items = ref<TeamPurpose[]>([]), loading = ref(false), error = ref('')
  let epoch = 0
  async function refresh() {
    const id = teamId(), current = ++epoch
    items.value = []; error.value = ''; loading.value = Boolean(id)
    if (!id) return
    try { const result = await teamMaterialApi.purposes(id); if (current === epoch) items.value = result }
    catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '用途加载失败' }
    finally { if (current === epoch) loading.value = false }
  }
  watch(teamId, refresh, { immediate: true })
  onBeforeUnmount(() => { ++epoch })
  return { items, loading, error, refresh }
}

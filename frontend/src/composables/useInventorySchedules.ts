import { onScopeDispose, ref, type Ref } from 'vue'
import { loadInventorySchedules } from '@/utils/inventorySchedule'
import type { InventoryScheduleSummary } from '@/types/productionSchedule'

export function useInventorySchedules<T extends { delivery_schedule?: InventoryScheduleSummary }>(
  rows: Ref<T[]>,
  teamId: () => number,
  kind: 'groups' | 'sources',
  identify: (row: T) => { id: number; materialType?: string | null },
) {
  const loading = ref(false),
    error = ref('')
  let version = 0

  function reset() {
    ++version
    loading.value = false
    error.value = ''
  }
  onScopeDispose(reset)

  async function withSchedules(items: T[], id = teamId()) {
    const summaries = await loadInventorySchedules(id, items.map(identify), kind)
    return items.map((row) => ({ ...row, delivery_schedule: summaries[identify(row).id] }))
  }

  async function load() {
    const request = ++version
    loading.value = true
    error.value = ''
    try {
      const items = await withSchedules(rows.value)
      if (request === version) rows.value = items
    } catch {
      if (request === version) error.value = '交货排期加载失败，库存仍可查看。'
    } finally {
      if (request === version) loading.value = false
    }
  }

  return { loading, error, load, reset, withSchedules }
}

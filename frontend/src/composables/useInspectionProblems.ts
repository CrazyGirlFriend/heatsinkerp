import { onBeforeUnmount, ref } from 'vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamDirectoryItem } from '@/types/teamBusiness'

export function useInspectionProblems(teamId: () => number, errorMessage: string) {
  const problems = ref<TeamDirectoryItem[]>([])
  const loading = ref(false)
  const error = ref('')
  let generation = 0

  async function load() {
    const token = ++generation
    loading.value = true
    error.value = ''
    try {
      const result = await teamMaterialApi.inspectionProblems(teamId())
      if (token === generation) problems.value = result.filter((problem) => problem.active)
    } catch (failure) {
      if (token === generation)
        error.value = failure instanceof Error ? failure.message : errorMessage
    } finally {
      if (token === generation) loading.value = false
    }
  }

  onBeforeUnmount(() => ++generation)
  return { problems, loading, error, load }
}

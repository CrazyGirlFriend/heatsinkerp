import { computed, inject, type ComputedRef, type InjectionKey } from 'vue'

export type WorkspaceAppearance = 'glass' | 'watermelon'
export const workspaceAppearanceKey: InjectionKey<ComputedRef<WorkspaceAppearance>> =
  Symbol('workspace-appearance')

export function useWatermelonAppearance() {
  const appearance = inject(
    workspaceAppearanceKey,
    computed(() => 'glass'),
  )
  return computed(() => appearance.value === 'watermelon')
}

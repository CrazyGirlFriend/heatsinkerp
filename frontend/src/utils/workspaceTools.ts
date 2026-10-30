import type { ComputedRef, InjectionKey, Ref } from 'vue'

export interface WorkspaceTools {
  fullscreen: Ref<boolean>
  fullscreenBusy: Ref<boolean>
  canFullscreen: ComputedRef<boolean>
  exportable: ComputedRef<boolean>
  settings: ComputedRef<boolean>
  toggleFullscreen: () => Promise<void>
  export: () => void
  openSettings: () => void
}

export const workspaceToolsKey: InjectionKey<WorkspaceTools> = Symbol('workspaceTools')

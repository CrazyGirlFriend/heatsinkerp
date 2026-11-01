import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue'

export interface WorkspaceExportAction {
  open: () => void
  disabled: boolean
}

export interface WorkspaceTools {
  fullscreen: Ref<boolean>
  fullscreenBusy: Ref<boolean>
  canFullscreen: ComputedRef<boolean>
  exportable: ComputedRef<boolean>
  tableExport?: ShallowRef<WorkspaceExportAction | null>
  registerExport?: (owner: symbol, action: WorkspaceExportAction | null) => void
  settings: ComputedRef<boolean>
  toggleFullscreen: () => Promise<void>
  export: () => void
  openSettings: () => void
}

export const workspaceToolsKey: InjectionKey<WorkspaceTools> = Symbol('workspaceTools')
export const workspaceToolbarExportKey: InjectionKey<
  NonNullable<WorkspaceTools['registerExport']>
> = Symbol('workspaceToolbarExport')

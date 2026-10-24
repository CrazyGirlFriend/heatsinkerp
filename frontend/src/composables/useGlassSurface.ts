import { onBeforeUnmount, watch } from 'vue'
import type { GlassSurfaceCleanup } from '@/utils/glassDialog'

let runtime: Promise<typeof import('@/utils/glassDialog')> | undefined
function loadRuntime() {
  runtime ??= import('@/utils/glassDialog').catch((error) => {
    runtime = undefined
    throw error
  })
  return runtime
}

export function useGlassSurface(
  root: () => HTMLElement | null | undefined,
  visible: () => boolean,
) {
  let generation = 0
  let release: GlassSurfaceCleanup | undefined
  function cancelPending() {
    ++generation
    release?.freeze?.()
  }
  function stop() {
    cancelPending()
    release?.()
    release = undefined
  }
  async function start() {
    stop()
    const current = generation
    const target = root()
    if (!target || !visible() || !target.isConnected) return
    try {
      const { enhanceGlassDialog } = await loadRuntime()
      if (current !== generation || !visible() || !target.isConnected || root() !== target) return
      release = enhanceGlassDialog(target)
    } catch {
      // Optical effects are optional; the existing DOM and form actions remain usable.
    }
  }
  watch(visible, (open) => {
    // Keep the established material intact until the exit transition finishes.
    if (!open) cancelPending()
  })
  onBeforeUnmount(stop)
  return { start, cancelPending, stop }
}

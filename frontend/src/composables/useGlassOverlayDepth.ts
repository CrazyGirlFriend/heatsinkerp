import { computed, inject, nextTick, provide, ref } from 'vue'

export function useGlassOverlayDepth(
  root: () => HTMLElement | null | undefined,
  modal: () => boolean = () => true,
) {
  const parentDepth = inject(
    'app-glass-surface-depth',
    computed(() => 0),
  )
  const hasBackgroundModal = ref(false)
  const depth = computed(() => Math.max(parentDepth.value, Number(hasBackgroundModal.value)))
  provide(
    'app-glass-surface-depth',
    computed(() => depth.value + Number(modal())),
  )

  function sync() {
    const surface = root()
    const ownOverlay = surface?.closest<HTMLElement>('.el-overlay')
    if (!modal() || !surface || !ownOverlay) {
      hasBackgroundModal.value = false
      return
    }
    const ownZIndex = Number.parseFloat(getComputedStyle(ownOverlay).zIndex)
    hasBackgroundModal.value = [
      ...document.querySelectorAll<HTMLElement>('.app-glass-surface'),
    ].some((candidate) => {
      if (candidate === surface || surface.contains(candidate)) return false
      const overlay = candidate.closest<HTMLElement>('.el-overlay')
      if (!overlay || overlay === ownOverlay || !overlay.classList.contains('app-glass-overlay'))
        return false
      for (const element of [candidate, overlay]) {
        const style = getComputedStyle(element)
        if (
          element.hidden ||
          element.getAttribute('aria-hidden') === 'true' ||
          !element.getClientRects().length ||
          style.display === 'none' ||
          ['hidden', 'collapse'].includes(style.visibility)
        )
          return false
      }
      const candidateZIndex = Number.parseFloat(getComputedStyle(overlay).zIndex)
      return (
        !Number.isFinite(ownZIndex) ||
        !Number.isFinite(candidateZIndex) ||
        candidateZIndex < ownZIndex
      )
    })
  }

  return {
    nested: computed(() => modal() && depth.value > 0),
    opening: () => nextTick(sync),
    sync,
    reset: () => {
      hasBackgroundModal.value = false
    },
  }
}

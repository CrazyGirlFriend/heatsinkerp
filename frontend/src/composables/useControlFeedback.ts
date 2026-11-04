import { onScopeDispose, watch, type Ref } from 'vue'

// Keep the real control element: form submission, focus and keyboard semantics stay native.
export function useControlFeedback(element: Ref<HTMLElement | undefined>, enabled: Ref<boolean>) {
  const stop = watch(
    [element, enabled],
    ([node, active], _, cleanup) => {
      if (!node || !active) return
      let animation: Animation | undefined
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
      function press() {
        if (
          reduced?.matches ||
          node!.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')
        )
          return
        animation?.cancel()
        animation = node!.animate?.([{ scale: 1 }, { scale: 0.97 }], {
          duration: 90,
          fill: 'forwards',
        })
      }
      function release() {
        if (!animation) return
        animation.cancel()
        animation = reduced?.matches
          ? undefined
          : node!.animate?.([{ scale: 0.97 }, { scale: 1.008, offset: 0.55 }, { scale: 1 }], {
              duration: 240,
              easing: 'ease-out',
            })
      }
      function keydown(event: KeyboardEvent) {
        if (!event.repeat && [' ', 'Enter'].includes(event.key)) press()
      }
      node.addEventListener('pointerdown', press)
      node.addEventListener('pointerleave', release)
      node.addEventListener('pointerup', release)
      node.addEventListener('pointercancel', release)
      node.addEventListener('keydown', keydown)
      node.addEventListener('keyup', release)
      node.addEventListener('blur', release)
      cleanup(() => {
        animation?.cancel()
        node.removeEventListener('pointerdown', press)
        node.removeEventListener('pointerleave', release)
        node.removeEventListener('pointerup', release)
        node.removeEventListener('pointercancel', release)
        node.removeEventListener('keydown', keydown)
        node.removeEventListener('keyup', release)
        node.removeEventListener('blur', release)
      })
    },
    { flush: 'post' },
  )
  onScopeDispose(stop)
}

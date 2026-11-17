import { computed } from 'vue'
import { useGlassOverlayDepth } from './useGlassOverlayDepth'
import { useGlassSurface } from './useGlassSurface'
import { useWatermelonAppearance } from './useWorkspaceAppearance'

export function useAppOverlay(
  root: () => HTMLElement | null | undefined,
  props: { modelValue?: boolean; modalClass?: string; modal?: boolean },
  emit: (event: 'open' | 'opened' | 'close' | 'closed') => void,
) {
  const watermelon = useWatermelonAppearance()
  const modal = () => props.modal ?? true
  const overlay = useGlassOverlayDepth(root, modal)
  const glass = useGlassSurface(root, () => Boolean(props.modelValue) && !watermelon.value)
  const overlayClass = computed(() =>
    [
      modal() ? (watermelon.value ? 'wm-dialog-overlay' : 'app-glass-overlay') : '',
      overlay.nested.value ? 'app-glass-overlay--nested' : '',
      props.modalClass,
    ]
      .filter(Boolean)
      .join(' '),
  )
  const events = {
    open() {
      void overlay.opening()
      emit('open')
    },
    opened() {
      overlay.sync()
      if (!watermelon.value) void glass.start()
      emit('opened')
    },
    close() {
      glass.cancelPending()
      emit('close')
    },
    closed() {
      glass.stop()
      overlay.reset()
      emit('closed')
    },
  }
  return { watermelon, overlayClass, events }
}

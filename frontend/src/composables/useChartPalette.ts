import { computed, onBeforeUnmount, ref } from 'vue'
import { useWatermelonAppearance } from './useWorkspaceAppearance'

export interface ChartPalette {
  surface: string
  mutedSurface: string
  text: string
  muted: string
  border: string
}

// Canvas renderers need resolved colors; CSS variables alone cannot theme their labels.
export function useChartPalette() {
  const watermelon = useWatermelonAppearance()
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  const dark = ref(query?.matches ?? false)
  const update = () => {
    dark.value = query?.matches ?? false
  }
  query?.addEventListener('change', update)
  onBeforeUnmount(() => query?.removeEventListener('change', update))
  return computed<ChartPalette | undefined>(() => {
    if (!watermelon.value) return undefined
    const fallback = dark.value
      ? ['#101010', '#161616', '#f4f4f5', '#a1a1aa', '#303030']
      : ['#fff', '#fafafa', '#18181b', '#71717a', '#e4e4e7']
    const style = getComputedStyle(document.documentElement)
    const color = (name: string, index: number) =>
      style.getPropertyValue(`--wm-${name}`).trim() || fallback[index]!
    return {
      surface: color('bg', 0),
      mutedSurface: color('muted-surface', 1),
      text: color('text', 2),
      muted: color('muted', 3),
      border: color('border', 4),
    }
  })
}

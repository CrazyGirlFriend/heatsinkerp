import { onBeforeUnmount, onUpdated, shallowRef, watch } from 'vue'

export function useNativeTableFreeze() {
  const table = shallowRef<HTMLTableElement | null>(null)
  let observer: ResizeObserver | undefined
  function update() {
    if (!table.value) return
    const offsets: number[] = []
    let left = 0
    for (const cell of table.value.tHead?.rows[0]?.cells || []) {
      offsets.push(left)
      left += cell.getBoundingClientRect().width
    }
    for (const row of table.value.rows) {
      for (const cell of row.cells) {
        const index = cell.dataset.fixedColumn
        if (index !== undefined)
          cell.style.setProperty('--fixed-column-left', `${offsets[Number(index)] || 0}px`)
        else cell.style.removeProperty('--fixed-column-left')
      }
    }
  }
  watch(
    table,
    (value) => {
      observer?.disconnect()
      if (value && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(update)
        observer.observe(value)
      }
      update()
    },
    { flush: 'post' },
  )
  onUpdated(update)
  onBeforeUnmount(() => observer?.disconnect())
  return table
}

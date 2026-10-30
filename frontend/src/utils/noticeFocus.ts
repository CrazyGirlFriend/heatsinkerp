/** A brief destination cue; never animate the whole dialog or move the document layout. */
export function focusNoticeTarget(element: HTMLElement) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({
    block: element.getBoundingClientRect().height > window.innerHeight / 2 ? 'start' : 'center',
    inline: 'nearest',
    behavior: reduced ? 'instant' : 'smooth',
  })
  const previousTabindex = element.getAttribute('tabindex')
  element.setAttribute('tabindex', '-1')
  element.focus({ preventScroll: true })
  element.classList.add('notice-destination')
  const surfaces = element.tagName === 'TR' ? Array.from(element.children) : [element]
  const animations = reduced
    ? []
    : surfaces.map((surface) =>
        surface.animate(
          [
            { backgroundColor: '#fff1c7' },
            { backgroundColor: '#fff1c7', offset: 0.25 },
            { backgroundColor: 'transparent' },
          ],
          { duration: 2400, easing: 'ease-out' },
        ),
      )
  const cleanup = () => {
    clearTimeout(timer)
    animations.forEach((animation) => animation.cancel())
    element.classList.remove('notice-destination')
    if (previousTabindex === null) element.removeAttribute('tabindex')
    else element.setAttribute('tabindex', previousTabindex)
  }
  const timer = setTimeout(cleanup, 2800)
  return cleanup
}
export function noticeOpened(key: string) {
  window.dispatchEvent(new CustomEvent('business-notice-opened', { detail: key }))
}
export function noticeFailed(key: string, error: unknown) {
  window.dispatchEvent(
    new CustomEvent('business-notice-failed', {
      detail: { key, message: error instanceof Error ? error.message : '消息内容打开失败' },
    }),
  )
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusNoticeTarget } from './noticeFocus'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
describe('notification destination cue', () => {
  it('focuses and scrolls the target, highlights cells, then cleans up', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    document.body.innerHTML = '<table><tbody><tr><td>第 2 批</td><td>60</td></tr></tbody></table>'
    const row = document.querySelector('tr')!
    row.scrollIntoView = vi.fn()
    const cancel = vi.fn()
    const animate = vi.fn(() => ({ cancel }))
    for (const cell of row.children)
      (cell as HTMLElement).animate = animate as unknown as HTMLElement['animate']
    const stop = focusNoticeTarget(row)
    expect(document.activeElement).toBe(row)
    expect(row.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    })
    expect(animate).toHaveBeenCalledTimes(2)
    expect(row.classList.contains('notice-destination')).toBe(true)
    stop()
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(row.hasAttribute('tabindex')).toBe(false)
    expect(row.className).toBe('')
  })
  it('respects reduced motion and restores the original focus attribute', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const el = document.createElement('div')
    el.setAttribute('tabindex', '0')
    document.body.append(el)
    el.scrollIntoView = vi.fn()
    el.animate = vi.fn()
    focusNoticeTarget(el)
    expect(el.animate).not.toHaveBeenCalled()
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }))
    vi.advanceTimersByTime(2800)
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.classList.contains('notice-destination')).toBe(false)
  })
})

// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AnimatedMetric from './AnimatedMetric.vue'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('starts at the actual value and interpolates updates from the previous value, never from zero', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.push(callback); return frames.length }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  const wrapper = mount(AnimatedMetric, { props: { value: 100, animate: true, precision: 0 } })
  try {
    expect(wrapper.text()).toBe('100')
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    await wrapper.setProps({ value: 200 })
    expect(wrapper.text()).toBe('100')
    frames[0]!(1350); await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('188')
    expect(wrapper.attributes('aria-label')).toBe('200')
    await wrapper.setProps({ animate: false })
    expect(wrapper.text()).toBe('200')
    expect(cancelAnimationFrame).toHaveBeenCalled()
  } finally { wrapper.unmount() }
})
it('keeps unknown values explicit and cancels unfinished frames on unmount', async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 12))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const wrapper = mount(AnimatedMetric, { props: { value: null, animate: true, precision: 3 } })
  expect(wrapper.text()).toBe('—')
  await wrapper.setProps({ value: 1.125 })
  expect(wrapper.text()).toBe('1.125')
  await wrapper.setProps({ value: 2.125 })
  wrapper.unmount()
  expect(cancelAnimationFrame).toHaveBeenCalledWith(12)
})
it('settles exactly after an increase or decrease, while identical refresh values do not restart animation', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.push(callback); return frames.length }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  const wrapper = mount(AnimatedMetric, { props: { value: 100, animate: true, precision: 3 } })
  try {
    await wrapper.setProps({ value: 80.125 })
    frames[0]!(1350); await wrapper.vm.$nextTick()
    expect(Number(wrapper.text())).toBeGreaterThan(80.125)
    expect(Number(wrapper.text())).toBeLessThan(100)
    frames[1]!(1700); await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('80.125')
    const calls = vi.mocked(requestAnimationFrame).mock.calls.length
    await wrapper.setProps({ value: 80.125 })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(calls)
    await wrapper.setProps({ value: 101.375 })
    frames[2]!(1700); await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('101.375')
  } finally { wrapper.unmount() }
})

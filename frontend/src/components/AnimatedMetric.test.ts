// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AnimatedMetric from './AnimatedMetric.vue'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('starts at the actual value and interpolates updates from the previous value, never from zero', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback) => {
      frames.push(callback)
      return frames.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  const wrapper = mount(AnimatedMetric, { props: { value: 100, animate: true, precision: 0 } })
  try {
    expect(wrapper.text()).toBe('100')
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    await wrapper.setProps({ value: 200 })
    expect(wrapper.text()).toBe('100')
    frames[0]!(1350)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('188')
    expect(wrapper.attributes('aria-label')).toBe('200')
    await wrapper.setProps({ animate: false })
    expect(wrapper.text()).toBe('200')
    expect(cancelAnimationFrame).toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
it('keeps unknown values explicit and cancels unfinished frames on unmount', async () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 12),
  )
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
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback) => {
      frames.push(callback)
      return frames.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  const wrapper = mount(AnimatedMetric, { props: { value: 100, animate: true, precision: 3 } })
  try {
    await wrapper.setProps({ value: 80.125 })
    frames[0]!(1350)
    await wrapper.vm.$nextTick()
    expect(Number(wrapper.text())).toBeGreaterThan(80.125)
    expect(Number(wrapper.text())).toBeLessThan(100)
    frames[1]!(1700)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('80.125')
    const calls = vi.mocked(requestAnimationFrame).mock.calls.length
    await wrapper.setProps({ value: 80.125 })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(calls)
    await wrapper.setProps({ value: 101.375 })
    frames[2]!(1700)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('101.375')
  } finally {
    wrapper.unmount()
  }
})

it('rolls only changed digits, preserves their places across a carry, and uses the latest target immediately', async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  const wrapper = mount(AnimatedMetric, {
    props: { value: 98, animate: true, precision: 6, mode: 'roll' },
  })
  try {
    const tens = wrapper.get('[data-place="integer-2"] .metric-character').element
    const onesPlace = wrapper.get('[data-place="integer-1"]').element
    await wrapper.setProps({ value: 99 })
    expect(wrapper.get('[data-place="integer-2"] .metric-character').element).toBe(tens)
    await wrapper.setProps({ value: 100 })
    expect(wrapper.get('[data-place="integer-1"]').element).toBe(onesPlace)
    expect(wrapper.text()).toBe('100')
    await wrapper.setProps({ value: 99.000123 })
    expect(wrapper.text()).toBe('99.000123')
    expect(wrapper.attributes('aria-label')).toBe('99.000123')
    expect(wrapper.get('transition-stub').attributes('name')).toBe('metric-roll-down')
    await wrapper.setProps({ value: 1200.125 })
    expect(wrapper.text()).toBe('1,200.125')
    expect(wrapper.get('transition-stub').attributes('name')).toBe('metric-roll-up')
    expect(wrapper.get('.metric-digits').attributes('aria-hidden')).toBe('true')
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
it('shows unknown and non-finite metrics as unknown instead of rolling invalid digits', async () => {
  const wrapper = mount(AnimatedMetric, {
    props: { value: null, animate: true, precision: 6, mode: 'roll' },
  })
  try {
    expect(wrapper.text()).toBe('—')
    await wrapper.setProps({ value: 0.000123 })
    expect(wrapper.text()).toBe('0.000123')
    expect(wrapper.get('transition-stub').attributes('css')).toBe('false')
    await wrapper.setProps({ value: Number.NaN })
    expect(wrapper.text()).toBe('—')
    await wrapper.setProps({ value: Infinity })
    expect(wrapper.attributes('aria-label')).toBe('—')
  } finally {
    wrapper.unmount()
  }
})
it('honors changes to reduced motion immediately and releases its listener and unfinished count animation', async () => {
  const preference = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => preference),
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 42),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const wrapper = mount(AnimatedMetric, { props: { value: 10, animate: true, precision: 6 } })
  const change = preference.addEventListener.mock.calls[0]![1]
  try {
    await wrapper.setProps({ value: 15 })
    expect(wrapper.text()).toBe('10')
    change({ matches: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('15')
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
    await wrapper.setProps({ mode: 'roll', value: 30 })
    expect(wrapper.text()).toBe('30')
    expect(wrapper.get('transition-stub').attributes('css')).toBe('false')
    change({ matches: false })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ value: 31 })
    expect(wrapper.get('transition-stub').attributes('css')).toBe('true')
    change({ matches: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('31')
    expect(wrapper.get('transition-stub').attributes('css')).toBe('false')
  } finally {
    wrapper.unmount()
  }
  expect(preference.removeEventListener).toHaveBeenCalledWith('change', change)
})

it('interrupts older rolls instead of stacking outgoing digits or queuing obsolete values', async () => {
  vi.useFakeTimers()
  const wrapper = mount(AnimatedMetric, {
    props: { value: 1, animate: true, precision: 6, mode: 'roll' },
    global: { stubs: { transition: false } },
  })
  try {
    await wrapper.setProps({ value: 2 })
    await wrapper.setProps({ value: 3 })
    expect(wrapper.findAll('.metric-character').map((node) => node.text())).toEqual(['2', '3'])
    await wrapper.setProps({ value: 1 })
    expect(wrapper.findAll('.metric-character').map((node) => node.text())).toEqual(['3', '1'])
    expect(wrapper.attributes('aria-label')).toBe('1')
    await vi.advanceTimersByTimeAsync(400)
    expect(wrapper.text()).toBe('1')
    expect(wrapper.findAll('.metric-character')).toHaveLength(1)
    await wrapper.setProps({ value: 5 })
    await wrapper.setProps({ animate: false })
    expect(wrapper.text()).toBe('5')
    expect(wrapper.findAll('.metric-character')).toHaveLength(1)
  } finally {
    wrapper.unmount()
    vi.useRealTimers()
  }
})

it('replaces sign and separator positions immediately when crossing zero or a digit boundary', async () => {
  vi.useFakeTimers()
  const wrapper = mount(AnimatedMetric, {
    props: { value: 10, animate: true, precision: 6, mode: 'roll' },
    global: { stubs: { transition: false } },
  })
  try {
    await wrapper.setProps({ value: -1 })
    expect(wrapper.get('[data-place="integer-2"]').text()).toBe('-')
    await vi.advanceTimersByTimeAsync(400)
    expect(wrapper.text()).toBe('-1')
    await wrapper.setProps({ value: 1000 })
    await wrapper.setProps({ value: -999 })
    expect(wrapper.get('[data-place="integer-4"]').text()).toBe('-')
    await vi.advanceTimersByTimeAsync(400)
    expect(wrapper.text()).toBe('-999')
  } finally {
    wrapper.unmount()
    vi.useRealTimers()
  }
})

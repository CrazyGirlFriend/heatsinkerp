// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElCalendar, ElPopover } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleDateRange from './ScheduleDateRange.vue'

let wrapper: VueWrapper
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T17:00:00Z'))
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
})
async function open() {
  const popover = wrapper.getComponent(ElPopover)
  popover.vm.$emit('update:visible', true)
  await flushPromises()
}
async function render() {
  wrapper = mount(ScheduleDateRange, {
    props: { modelValue: ['2026-10-19', '2026-10-25'] },
    global: {
      stubs: {
        ElPopover: {
          props: ['visible'],
          template: '<div><slot name="reference"/><slot/></div>',
        },
      },
    },
  })
  await open()
}
async function button(text: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
}
async function pick(date: string) {
  await wrapper.get(`.range-day[aria-label="${date}"]`).trigger('click')
}
describe('schedule date range popover', () => {
  it('previews a range and only applies after both dates have been selected', async () => {
    await render()
    expect(wrapper.get('.schedule-date-trigger').text()).toContain('2026/10/19 — 2026/10/25')
    await pick('2026-10-20')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(
      wrapper.get('.date-range-footer .el-button--primary').attributes('disabled'),
    ).toBeDefined()
    await pick('2026-10-30')
    expect(wrapper.get('.date-range-footer').text()).toContain('共 11 天')
    await button('应用')
    expect(wrapper.emitted('update:modelValue')).toEqual([[['2026-10-20', '2026-10-30']]])
  })
  it('orders reversed selections and allows a single day', async () => {
    await render()
    await pick('2026-10-28')
    await pick('2026-10-20')
    await button('应用')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['2026-10-20', '2026-10-28']])
    await open()
    await pick('2026-10-23')
    await pick('2026-10-23')
    await button('应用')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([['2026-10-23', '2026-10-23']])
  })
  it('selects a range across months in one calendar', async () => {
    await render()
    await pick('2026-10-20')
    await wrapper.get('[aria-label="下个月"]').trigger('click')
    await pick('2026-11-05')
    await button('应用')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['2026-10-20', '2026-11-05']])
  })
  it('uses factory-local shortcut dates and stages each shortcut until applied', async () => {
    await render()
    const cases = [
      ['本周', '2026-10-19', '2026-10-25'],
      ['下周', '2026-10-26', '2026-11-01'],
      ['本月', '2026-10-01', '2026-10-31'],
      ['4 周', '2026-10-19', '2026-11-15'],
      ['12 周', '2026-10-19', '2027-01-10'],
    ]
    for (const [index, [label, from, to]] of cases.entries()) {
      await open()
      await button(label!)
      expect(wrapper.emitted('update:modelValue')?.length || 0).toBe(index)
      await button('应用')
      expect(wrapper.emitted('update:modelValue')?.[index]).toEqual([[from, to]])
    }
  })
  it('does not overwrite a quick selection when the opening animation finishes', async () => {
    await render()
    await button('12 周')
    wrapper.getComponent(ElPopover).vm.$emit('show')
    await flushPromises()
    expect(wrapper.get('.date-range-footer').text()).toContain('共 84 天')
    await button('应用')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['2026-10-19', '2027-01-10']])
  })
  it('jumps to the ending month and discards cancellation and Escape', async () => {
    await render()
    await button('12 周')
    await wrapper.get('[aria-label="结束日期"]').trigger('click')
    expect(day(wrapper.getComponent(ElCalendar).props('modelValue')!)).toBe('2027-01-10')
    await button('取消')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await open()
    expect(wrapper.get('.date-range-edges').text()).toContain('2026/10/25')
    await pick('2026-10-20')
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.getComponent(ElPopover).props('visible')).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
function day(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

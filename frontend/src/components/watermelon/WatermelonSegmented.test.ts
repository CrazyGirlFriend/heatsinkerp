// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import WatermelonSegmented from './WatermelonSegmented.vue'

let wrapper: VueWrapper | undefined
const options = [
  { value: 'first', label: '第一项' },
  { value: 'second', label: '第二项', disabled: true },
  { value: 'third', label: '第三项' },
]
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})

describe('WatermelonSegmented', () => {
  it('exposes the supplied group name and emits changes without selecting disabled options', async () => {
    wrapper = mount(WatermelonSegmented, {
      props: { label: '报表视图', options, modelValue: 'first' },
      attachTo: document.body,
    })
    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('报表视图')
    const buttons = wrapper.findAll('button')
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['third']])
    expect(wrapper.emitted('change')).toEqual([['third']])
    await wrapper.setProps({ modelValue: 'third' })
    expect(buttons[2]!.attributes('aria-pressed')).toBe('true')
  })

  it('moves focus and selection with arrows, Home and End while skipping disabled choices', async () => {
    wrapper = mount(WatermelonSegmented, {
      props: { label: '报表视图', options, modelValue: 'first' },
      attachTo: document.body,
    })
    const buttons = wrapper.findAll<HTMLButtonElement>('button')
    buttons[0]!.element.focus()
    await buttons[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(buttons[2]!.element)
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['third'])
    await wrapper.setProps({ modelValue: 'third' })
    await buttons[2]!.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(buttons[0]!.element)
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['first'])
    await wrapper.setProps({ modelValue: 'first' })
    await buttons[0]!.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(buttons[2]!.element)
    await wrapper.setProps({ modelValue: 'third' })
    await buttons[2]!.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0]!.element)
  })
})

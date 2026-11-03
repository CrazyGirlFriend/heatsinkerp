// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import WatermelonSearch from './WatermelonSearch.vue'
import WatermelonSwitch from './WatermelonSwitch.vue'

let wrapper: VueWrapper | undefined
afterEach(() => wrapper?.unmount())

describe('Watermelon input components', () => {
  it('searches on Enter once and does not submit while confirming Chinese input', async () => {
    wrapper = mount(WatermelonSearch, { props: { label: '搜索人员' } })
    const input = wrapper.get('input')
    await input.setValue('张')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.emitted('search')).toBeUndefined()
    await input.trigger('keydown', { key: 'Enter', isComposing: false })
    expect(wrapper.emitted('search')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([['张']])
  })

  it('clears the model before notifying a new search', async () => {
    wrapper = mount(WatermelonSearch, { props: { label: '搜索订单', modelValue: 'P001' } })
    await wrapper.get('[aria-label="清空搜索"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.emitted('search')).toHaveLength(1)
    await wrapper.setProps({ disabled: true })
    await wrapper.get('[aria-label="搜索订单"][type="button"]').trigger('click')
    expect(wrapper.emitted('search')).toHaveLength(1)
  })

  it('exposes a labeled switch and blocks changes while disabled', async () => {
    wrapper = mount(WatermelonSwitch, {
      props: { label: '接收通知', modelValue: true, disabled: true },
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({ disabled: false })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    await wrapper.setProps({ modelValue: false })
    expect(wrapper.get('button').attributes('aria-checked')).toBe('false')
    expect(wrapper.get('button').attributes('aria-label')).toBe('接收通知')
  })
})

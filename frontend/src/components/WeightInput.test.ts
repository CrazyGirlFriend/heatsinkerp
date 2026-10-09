// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { ElInputNumber } from 'element-plus'
import { describe, expect, it } from 'vitest'
import WeightInput from './WeightInput.vue'

describe('measured weight units', () => {
  it('switches the display to grams without changing saved kilograms, and preserves milligrams', async () => {
    const wrapper = mount(WeightInput, { props: { modelValue: .000123, ariaLabel: '转料重量' } })
    try {
      await wrapper.get('select').setValue('g')
      expect(wrapper.getComponent(ElInputNumber).props('modelValue')).toBe(.123)
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', .125)
      expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([.000125])
      wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', undefined)
      expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([undefined])
    } finally { wrapper.unmount() }
  })
})

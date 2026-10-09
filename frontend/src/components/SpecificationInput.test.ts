// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ElInputNumber, ElSelect } from 'element-plus'
import SpecificationInput from './SpecificationInput.vue'

describe('shape assisted specifications', () => {
  it('loads old free-form specifications without rewriting them', () => {
    const wrapper = mount(SpecificationInput, {
      props: { modelValue: '按图纸 002-A', label: '规格' },
    })
    expect(wrapper.get('input[aria-label="规格"]').element).toHaveProperty('value', '按图纸 002-A')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
  it('generates dimensions and rejects incomplete sizes and inverted rings', async () => {
    const wrapper = mount(SpecificationInput, { props: { modelValue: '', label: '规格' } })
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'ring')
    wrapper.getComponent(ElSelect).vm.$emit('change', 'ring')
    await wrapper.vm.$nextTick()
    for (const [i, value] of [30, 20, 5].entries())
      wrapper.findAllComponents(ElInputNumber)[i]!.vm.$emit('update:modelValue', value)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['Φ30 × Φ20 × 5 mm'])
    expect(wrapper.emitted('validity-change')!.at(-1)).toEqual([true])
    wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 40)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('validity-change')!.at(-1)).toEqual([false])
    expect(wrapper.text()).toContain('外径须大于内径')
    wrapper.unmount()
  })
})

// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import MaterialAmount from './MaterialAmount.vue'
import AnimatedMetric from './AnimatedMetric.vue'

it('preserves static formatting by default and only enables rolling where requested', async () => {
  const wrapper = mount(MaterialAmount, { props: { quantity: 1234, weight: 0.000123 } })
  try {
    expect(wrapper.text()).toBe('1,234件0.000123kg')
    expect(wrapper.findComponent(AnimatedMetric).exists()).toBe(false)
    await wrapper.setProps({ animate: true, quantity: 1235, weight: 0.000124 })
    expect(wrapper.text()).toBe('1,235件0.000124kg')
    expect(wrapper.findAllComponents(AnimatedMetric)).toHaveLength(2)
    await wrapper.setProps({ weightOnly: true })
    expect(wrapper.text()).toBe('0.000124kg')
    await wrapper.setProps({ weight: -0.5 })
    expect(wrapper.text()).toBe('-0.5kg重量差异')
    expect(wrapper.classes()).toContain('material-amount--shortage')
    await wrapper.setProps({ weight: undefined })
    expect(wrapper.text()).toBe('—kg')
  } finally {
    wrapper.unmount()
  }
})

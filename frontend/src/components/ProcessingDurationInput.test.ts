// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import { formatProcessingMinutes, validProcessingMinutes } from '@/utils/processingDuration'

it('edits hours and minutes as one duration, preserving the other part', async () => {
  const wrapper = mount(ProcessingDurationInput, {
    props: {
      modelValue: 95,
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
    },
  })
  try {
    const [hours, minutes] = wrapper.findAllComponents(AppNumberInput)
    expect(hours!.props('modelValue')).toBe(1)
    expect(minutes!.props('modelValue')).toBe(35)
    hours!.vm.$emit('update:modelValue', 2)
    await wrapper.vm.$nextTick()
    expect(wrapper.props('modelValue')).toBe(155)
    minutes!.vm.$emit('update:modelValue', 15)
    await wrapper.vm.$nextTick()
    expect(wrapper.props('modelValue')).toBe(135)
    hours!.vm.$emit('update:modelValue', undefined)
    await wrapper.vm.$nextTick()
    expect(wrapper.props('modelValue')).toBe(15)
    minutes!.vm.$emit('update:modelValue', undefined)
    await wrapper.vm.$nextTick()
    expect(wrapper.props('modelValue')).toBeUndefined()
  } finally {
    wrapper.unmount()
  }
})

it('distinguishes unknown time from invalid zero and formats mixed durations', () => {
  expect(validProcessingMinutes(undefined)).toBe(true)
  expect(validProcessingMinutes(0)).toBe(false)
  expect(validProcessingMinutes(-1)).toBe(false)
  expect(validProcessingMinutes(1.5)).toBe(false)
  expect(validProcessingMinutes(95)).toBe(true)
  expect(formatProcessingMinutes(null)).toBe('—')
  expect(formatProcessingMinutes(95)).toBe('1 小时 35 分钟')
})

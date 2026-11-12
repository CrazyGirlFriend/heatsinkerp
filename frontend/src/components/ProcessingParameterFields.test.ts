// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { ElFormItem } from 'element-plus'
import ProcessingParameterFields from './ProcessingParameterFields.vue'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import { processingParameterPayload } from '@/config/processingParameters'

it('separates anneal temperatures and durations and keeps zero temperature', async () => {
  const fields = [
    'furnace_no',
    'temperature_requirement',
    'actual_temperature_c',
    'holding_minutes',
  ]
  const wrapper = mount(ProcessingParameterFields, {
    props: {
      fields,
      modelValue: {},
      totalMinutes: 95,
      submitted: true,
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
    },
  })
  try {
    await wrapper.get('input[aria-label="炉号"]').setValue(' 02炉 ')
    await wrapper.get('input[aria-label="工艺温度要求"]').setValue('900–950 °C')
    wrapper
      .findAllComponents(AppNumberInput)
      .find((c) => c.find('input[aria-label="实际温度（°C）"]').exists())!
      .vm.$emit('update:modelValue', 0)
    await flushPromises()
    const holding = wrapper.getComponent(ProcessingDurationInput)
    expect(holding.props('label')).toBe('保温')
    holding.vm.$emit('update:modelValue', 100)
    await flushPromises()
    const holdingField = () =>
      wrapper.findAllComponents(ElFormItem).find((c) => c.props('label') === '保温时长')!
    expect(holdingField().props('error')).toBe('保温时长不能超过本次加工时长')
    expect(holding.props('invalid')).toBe(true)
    holding.vm.$emit('update:modelValue', 60)
    await flushPromises()
    expect(holdingField().props('error')).toBeUndefined()
    expect(holding.props('invalid')).toBe(false)
    expect(processingParameterPayload(wrapper.props('modelValue')!, fields)).toEqual({
      furnace_no: '02炉',
      temperature_requirement: '900–950 °C',
      actual_temperature_c: 0,
      holding_minutes: 60,
    })
    await wrapper.setProps({ fields: ['machine_no'] })
    expect(wrapper.find('input[aria-label="炉号"]').exists()).toBe(false)
    expect(processingParameterPayload(wrapper.props('modelValue')!, ['machine_no'])).toEqual({
      machine_no: null,
    })
    await wrapper.setProps({ fields: [] })
    expect(wrapper.find('.processing-parameter-fields').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

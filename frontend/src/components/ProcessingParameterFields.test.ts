// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ElFormItem } from 'element-plus'
import ProcessingParameterFields from './ProcessingParameterFields.vue'
import AppSelect from './AppSelect.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import {
  processingParameterErrors,
  processingParameterPayload,
} from '@/config/processingParameters'

it('separates anneal temperatures and durations and keeps zero temperature', async () => {
  const lookup = vi
    .spyOn(teamMaterialApi, 'equipment')
    .mockResolvedValue([{ id: 3, team_id: 2, name: '02炉', active: true, version: 1 }])
  const fields = [
    'furnace_no',
    'temperature_requirement',
    'actual_temperature_c',
    'holding_minutes',
  ]
  const wrapper = mount(ProcessingParameterFields, {
    props: {
      teamId: 2,
      fields,
      modelValue: {},
      totalMinutes: 95,
      submitted: true,
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
    },
  })
  try {
    expect(wrapper.text()).not.toContain('选填')
    expect(wrapper.findAllComponents(ElFormItem).every((field) => field.props('required'))).toBe(
      true,
    )
    expect(processingParameterErrors({}, fields)).toEqual({
      furnace_no: '请选择炉号',
      temperature_requirement: '请填写工艺温度要求',
      actual_temperature_c: '请填写实际温度（°C）',
      holding_minutes: '请填写保温时长',
    })
    await flushPromises()
    wrapper.getComponent(AppSelect).vm.$emit('update:modelValue', 3)
    await flushPromises()
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
      equipment_id: 3,
      furnace_no: '02炉',
      temperature_requirement: '900–950 °C',
      actual_temperature_c: 0,
      holding_minutes: 60,
    })
    await wrapper.setProps({ fields: ['machine_no'] })
    expect(processingParameterErrors({ machine_no: '  ' }, ['machine_no'])).toEqual({
      machine_no: '请选择机台号',
    })
    expect(wrapper.find('input[aria-label="炉号"]').exists()).toBe(false)
    expect(processingParameterPayload(wrapper.props('modelValue')!, ['machine_no'])).toEqual({
      equipment_id: null,
      machine_no: null,
    })
    await wrapper.setProps({ fields: [] })
    expect(wrapper.find('.processing-parameter-fields').exists()).toBe(false)
  } finally {
    wrapper.unmount()
    lookup.mockRestore()
  }
})

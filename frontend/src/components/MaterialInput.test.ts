// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MaterialInput from './MaterialInput.vue'
import { materialSuggestions, type MaterialSuggestion } from '@/services/materialInputApi'
vi.mock('@/services/materialInputApi', () => ({ materialSuggestions: vi.fn() }))

describe('material input suggestions', () => {
  it('fills an exactly entered serial without selecting a dropdown item', async () => {
    const item = { value: 'YS-007', details: { material_name: '材料2' }, source_batch_no: 'TL7' }
    vi.mocked(materialSuggestions).mockResolvedValue([item])
    const wrapper = mount(MaterialInput, {
      props: { modelValue: '', field: 'serial_no', label: '流水号' },
    })
    const input = wrapper.getComponent({ name: 'ElAutocomplete' })
    const fetch = input.props('fetchSuggestions') as (
      query: string,
      callback: (items: MaterialSuggestion[]) => void,
    ) => Promise<void>
    input.vm.$emit('update:modelValue', 'YS-00')
    await wrapper.setProps({ modelValue: 'YS-00' })
    await fetch('YS-00', vi.fn())
    expect(wrapper.emitted('selected')).toBeUndefined()
    input.vm.$emit('update:modelValue', 'YS-007')
    await wrapper.setProps({ modelValue: 'YS-007' })
    await fetch('YS-007', vi.fn())
    expect(wrapper.emitted('selected')).toEqual([[item]])
    await fetch('YS-007', vi.fn())
    expect(wrapper.emitted('selected')).toHaveLength(1)
    wrapper.unmount()
  })
  it('does not fill on focus alone or when another field has an exact suggestion', async () => {
    const item = { value: 'YS-007', details: { material_name: '材料2' }, source_batch_no: 'TL7' }
    vi.mocked(materialSuggestions).mockResolvedValue([item])
    const wrapper = mount(MaterialInput, {
      props: { modelValue: 'YS-007', field: 'serial_no', label: '流水号' },
    })
    const input = wrapper.getComponent({ name: 'ElAutocomplete' })
    const fetch = input.props('fetchSuggestions') as (
      query: string,
      callback: (items: MaterialSuggestion[]) => void,
    ) => Promise<void>
    await fetch('YS-007', vi.fn())
    expect(wrapper.emitted('selected')).toBeUndefined()
    await wrapper.setProps({ field: 'material_name', modelValue: '' })
    input.vm.$emit('update:modelValue', 'YS-007')
    await wrapper.setProps({ modelValue: 'YS-007' })
    await fetch('YS-007', vi.fn())
    expect(wrapper.emitted('selected')).toBeUndefined()
    wrapper.unmount()
  })
  it('discards responses for an earlier query and after the input is closed', async () => {
    const requests: ((items: MaterialSuggestion[]) => void)[] = []
    vi.mocked(materialSuggestions).mockImplementation(
      () => new Promise((resolve) => requests.push(resolve)),
    )
    const wrapper = mount(MaterialInput, {
      props: { modelValue: 'YS-0', field: 'serial_no', label: '流水号' },
    })
    const first = vi.fn(),
      second = vi.fn()
    const fetch = wrapper.getComponent({ name: 'ElAutocomplete' }).props('fetchSuggestions') as (
      query: string,
      callback: (items: MaterialSuggestion[]) => void,
    ) => Promise<void>
    const old = fetch('YS-0', first)
    await wrapper.setProps({ modelValue: 'YS-1' })
    const next = fetch('YS-1', second)
    requests[0]!([{ value: 'YS-007', details: {}, source_batch_no: 'TL1' }])
    await old
    expect(first).not.toHaveBeenCalled()
    requests[1]!([{ value: 'YS-017', details: {}, source_batch_no: 'TL2' }])
    await next
    expect(second).toHaveBeenCalledWith([expect.objectContaining({ value: 'YS-017' })])
    const closed = fetch('YS-1', second)
    await wrapper.setProps({ disabled: true })
    requests[2]!([])
    await closed
    expect(second).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('keeps direct entry available when suggestions fail', async () => {
    vi.mocked(materialSuggestions).mockRejectedValue(new Error('offline'))
    const wrapper = mount(MaterialInput, {
      props: { modelValue: '', field: 'serial_no', label: '流水号' },
    })
    const callback = vi.fn()
    const fetch = wrapper.getComponent({ name: 'ElAutocomplete' }).props('fetchSuggestions') as (
      query: string,
      callback: (items: MaterialSuggestion[]) => void,
    ) => Promise<void>
    await fetch('YS', callback)
    await flushPromises()
    expect(callback).toHaveBeenCalledWith([])
    expect(wrapper.text()).toContain('可直接输入')
    await wrapper.get('input').setValue('YS-NEW')
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['YS-NEW'])
    wrapper.unmount()
  })
})

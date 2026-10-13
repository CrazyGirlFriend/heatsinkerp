// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ElDatePicker, ElPopover } from 'element-plus'
import TableColumnFilter from './TableColumnFilter.vue'
import { invalidNumberRange } from '@/utils/numberFilterRange'
let wrapper: VueWrapper
const popover = { template: '<div><slot name="reference"/><slot/></div>' }
afterEach(() => wrapper?.unmount())
async function open() {
  wrapper.getComponent(ElPopover).vm.$emit('show')
  await flushPromises()
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((item) => item.text() === text)!
    .trigger('click')
}
describe('table column filters', () => {
  it('cancels drafts, trims on apply and clears only when requested', async () => {
    wrapper = mount(TableColumnFilter, {
      props: { label: '流水号', value: 'YS-001' },
      global: { stubs: { ElPopover: popover } },
    })
    await open()
    expect(wrapper.get('button[aria-label="筛选流水号"]').classes()).toContain('is-filtered')
    await wrapper.get('input').setValue(' UNSENT ')
    await click('取消')
    expect(wrapper.emitted('apply')).toBeUndefined()
    await open()
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('YS-001')
    await wrapper.get('input').setValue(' YS-002 ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')?.[0]).toEqual(['YS-002', ''])
    await click('清除')
    expect(wrapper.emitted('apply')?.[1]).toEqual(['', ''])
  })
  it('keeps checked choices when searching the option list', async () => {
    wrapper = mount(TableColumnFilter, {
      props: {
        label: '来源',
        kind: 'select',
        value: '1',
        options: [
          { value: '1', label: '库房' },
          { value: '2', label: '轧制' },
        ],
      },
      global: { stubs: { ElPopover: popover } },
    })
    await open()
    await wrapper.get('input[aria-label="查找来源选项"]').setValue('轧')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')?.[0]).toEqual(['1,2', ''])
  })
  it('blocks reversed numeric ranges but permits a zero boundary', async () => {
    wrapper = mount(TableColumnFilter, {
      props: { label: '数量', kind: 'number', integer: true },
      global: { stubs: { ElPopover: popover } },
    })
    await open()
    await wrapper.get('input[aria-label="数量最小值"]').setValue('20')
    await wrapper.get('input[aria-label="数量最大值"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    await wrapper.get('input[aria-label="数量最小值"]').setValue('0')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')?.[0]).toEqual(['0', '10'])
  })
  it('blocks reversed dates and normalizes cleared dates', async () => {
    wrapper = mount(TableColumnFilter, {
      props: { label: '日期', kind: 'date', value: '2026-10-13', end: '2026-10-12' },
      global: { stubs: { ElPopover: popover } },
    })
    await open()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.findAllComponents(ElDatePicker)[0]!.vm.$emit('update:modelValue', null)
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')?.[0]).toEqual(['', '2026-10-12'])
  })
  it.each(['-1', 'NaN', 'Infinity', '1e3', '0.1234567', '100000000000'])(
    'rejects invalid weights %s',
    (value) => {
      expect(invalidNumberRange(value, '')).toBe(true)
    },
  )
  it('validates integer quantities and six-decimal weights', () => {
    expect(invalidNumberRange('1.5', '', true)).toBe(true)
    expect(invalidNumberRange('2147483648', '', true)).toBe(true)
    expect(invalidNumberRange('0.000001', '99999999999.999999')).toBe(false)
  })
})

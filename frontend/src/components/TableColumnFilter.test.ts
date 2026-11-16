// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElDatePicker, ElPopover } from 'element-plus'
import TableColumnFilter from './TableColumnFilter.vue'
import { invalidNumberRange } from '@/utils/numberFilterRange'
let wrapper: VueWrapper
const popover = { template: '<div><slot name="reference"/><slot/></div>' }
afterEach(() => wrapper?.unmount())
async function open() {
  wrapper.getComponent(ElPopover).vm.$emit('update:visible', true)
  await flushPromises()
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((item) => item.text() === text)!
    .trigger('click')
}
describe('table column filters', () => {
  it('does not overwrite input entered before the opening animation finishes', async () => {
    wrapper = mount(TableColumnFilter, {
      props: { label: '流水号', value: '691236-50' },
      global: { stubs: { ElPopover: popover } },
    })
    wrapper.getComponent(ElPopover).vm.$emit('update:visible', true)
    await flushPromises()
    await wrapper.get('input').setValue('691236-51')
    wrapper.getComponent(ElPopover).vm.$emit('show')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')?.[0]).toEqual(['691236-51', ''])
  })
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

it('loads real values beyond the table page, selects blanks and preserves comma-containing values', async () => {
  const loadOptions = vi
    .fn()
    .mockResolvedValueOnce({ values: [null, '铜,钼'], has_more: true, next_offset: 2 })
    .mockResolvedValueOnce({ values: ['钢'], has_more: false, next_offset: 3 })
  wrapper = mount(TableColumnFilter, {
    props: { label: '材质', loadOptions },
    global: { stubs: { ElPopover: popover } },
  })
  await open()
  expect(loadOptions).toHaveBeenCalledWith('', 0)
  expect(wrapper.text()).toContain('(空白)')
  await click('加载更多')
  await flushPromises()
  expect(loadOptions).toHaveBeenLastCalledWith('', 2)
  await click('取消全选')
  await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
  await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[0]).toEqual([
    '',
    '',
    { operator: 'in', values: [null, '铜,钼'] },
  ])
})

it('selects the entire result using exclusions and clears back to all values', async () => {
  wrapper = mount(TableColumnFilter, {
    props: {
      label: '材质',
      loadOptions: async () => ({ values: ['铜', '钢'], has_more: true, next_offset: 2 }),
    },
    global: { stubs: { ElPopover: popover } },
  })
  await open()
  await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[0]).toEqual(['', '', { operator: 'not_in', values: ['钢'] }])
  await open()
  await click('全选')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[1]).toEqual(['', ''])
})

it('offers blank and comparison conditions without leaking a stale range endpoint', async () => {
  wrapper = mount(TableColumnFilter, {
    props: { label: '数量', kind: 'number', value: '1', end: '20' },
    global: { stubs: { ElPopover: popover } },
  })
  await open()
  await wrapper.get('select[aria-label="数量筛选条件"]').setValue('gt')
  await wrapper.get('input[aria-label="数量最小值"]').setValue('10')
  expect(wrapper.find('input[aria-label="数量最大值"]').exists()).toBe(false)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[0]).toEqual(['10', '', { operator: 'gt' }])
  await open()
  await wrapper.get('select[aria-label="数量筛选条件"]').setValue('blank')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[1]).toEqual(['', '', { operator: 'blank' }])
})

it('selects a whole calendar month including its last day', async () => {
  wrapper = mount(TableColumnFilter, {
    props: { label: '日期', kind: 'date' },
    global: { stubs: { ElPopover: popover } },
  })
  await open()
  await wrapper.get('select[aria-label="日期选择方式"]').setValue('month')
  wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', '2024-02-01')
  await flushPromises()
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[0]).toEqual([
    '2024-02-01',
    '2024-02-29',
    { operator: 'between' },
  ])
})

it('keeps loading errors visible instead of offering current-page values', async () => {
  wrapper = mount(TableColumnFilter, {
    props: {
      label: '材质',
      loadOptions: async () => {
        throw new Error('读取失败')
      },
    },
    global: { stubs: { ElPopover: popover } },
  })
  await open()
  expect(wrapper.get('[role="alert"]').text()).toContain('读取失败')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')).toBeUndefined()
  await click('条件筛选')
  await wrapper.get('input[aria-label="材质筛选内容"]').setValue('铜')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('apply')?.[0]).toEqual(['铜', ''])
})

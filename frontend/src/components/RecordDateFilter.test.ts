// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPopover, ElRadioGroup } from 'element-plus'
import RecordDateFilter from './RecordDateFilter.vue'
let wrapper: VueWrapper
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-11T17:00:00Z')) })
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })
async function render(value = { from: '', to: '' }) {
  wrapper = mount(RecordDateFilter, { props: { modelValue: value, label: '流转日期' }, global: { stubs: { ElPopover: { template: '<div><slot name="reference"/><slot/></div>' } } } })
  wrapper.getComponent(ElPopover).vm.$emit('show'); await wrapper.vm.$nextTick()
}
async function click(text: string) { await wrapper.findAll('button').find(b => b.text() === text)!.trigger('click') }
describe('compact calendar', () => {
  it('keeps dates hidden behind one labelled button and applies a selected day', async () => {
    await render()
    expect(wrapper.get('.record-date-trigger').attributes('aria-label')).toBe('流转日期：不限')
    await wrapper.get('[aria-label="2026-09-12"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await click('确定')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([{ from: '2026-09-12', to: '2026-09-12' }])
  })
  it('uses factory-local today and yesterday rather than UTC day', async () => {
    await render(); await click('今天'); await click('确定')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([{ from: '2026-09-12', to: '2026-09-12' }])
    await click('昨天'); await click('确定')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([{ from: '2026-09-11', to: '2026-09-11' }])
  })
  it('orders reversed range clicks, clears, and restores committed state on reopen', async () => {
    await render({ from: '2026-09-10', to: '2026-09-12' })
    wrapper.getComponent(ElRadioGroup).vm.$emit('update:modelValue', 'range')
    await wrapper.get('[aria-label="2026-09-18"]').trigger('click')
    await wrapper.get('[aria-label="2026-09-13"]').trigger('click'); await click('确定')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([{ from: '2026-09-13', to: '2026-09-18' }])
    await click('清空')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([{ from: '', to: '' }])
    wrapper.getComponent(ElPopover).vm.$emit('show'); await wrapper.vm.$nextTick()
    expect(wrapper.get('[aria-label="2026-09-10"]').attributes('aria-pressed')).toBe('true')
  })
})

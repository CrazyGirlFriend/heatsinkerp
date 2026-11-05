// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import AppDisclosure from './AppDisclosure.vue'

it('preserves edits while collapsed and excludes hidden fields from keyboard access', async () => {
  const wrapper = mount(AppDisclosure, {
    slots: { summary: '其他信息', default: '<input aria-label="备注" />' },
  })
  try {
    const trigger = wrapper.get('button')
    const content = wrapper.get('.app-disclosure-content')
    expect(trigger.attributes('aria-controls')).toBe(content.attributes('id'))
    expect(content.attributes('inert')).toBeDefined()
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(content.attributes('inert')).toBeUndefined()
    await wrapper.get('input').setValue('保留已填写内容')
    await trigger.trigger('click')
    expect(content.attributes('inert')).toBeDefined()
    await trigger.trigger('click')
    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('保留已填写内容')
  } finally {
    wrapper.unmount()
  }
})

it('can reveal a collapsed invalid field through its controlled open state', async () => {
  const wrapper = mount(AppDisclosure, { props: { open: false }, slots: { summary: '尺寸' } })
  try {
    await wrapper.setProps({ open: true })
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.app-disclosure-content').attributes('aria-hidden')).toBe('false')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  } finally {
    wrapper.unmount()
  }
})

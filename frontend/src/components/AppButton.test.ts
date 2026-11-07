// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { h, nextTick, ref } from 'vue'
import AppButton from './AppButton.vue'

describe('shared business button', () => {
  it('preserves a custom trigger while exposing focus and blocking busy clicks', async () => {
    const click = vi.fn()
    const wrapper = mount(AppButton, {
      props: { unstyled: true, loading: true },
      attrs: { class: 'route-node', 'aria-label': '查看工序', onClick: click },
      slots: { default: '<svg aria-hidden="true" />' },
      attachTo: document.body,
    })
    try {
      expect(wrapper.element.tagName).toBe('BUTTON')
      expect(wrapper.classes()).toEqual(['route-node'])
      expect(wrapper.get('svg').element.parentElement).toBe(wrapper.element)
      await wrapper.trigger('click')
      expect(click).not.toHaveBeenCalled()
      await wrapper.setProps({ loading: false })
      const exposed = wrapper.vm as unknown as { ref: HTMLButtonElement }
      exposed.ref.focus()
      expect(document.activeElement).toBe(wrapper.element)
      await wrapper.trigger('click')
      expect(click).toHaveBeenCalledOnce()
      expect(wrapper.attributes('aria-label')).toBe('查看工序')
    } finally {
      wrapper.unmount()
    }
  })
  it('keeps native submission, focus restoration and the accessible label', async () => {
    const submit = vi.fn((event: Event) => event.preventDefault())
    const wrapper = mount(
      {
        render: () =>
          h(
            'form',
            { onSubmit: submit },
            h(AppButton, { nativeType: 'submit', 'aria-label': '保存计划' }, () => '保存'),
          ),
      },
      { attachTo: document.body },
    )
    try {
      const button = wrapper.getComponent(AppButton)
      const exposed = button.vm as unknown as { ref: HTMLButtonElement }
      exposed.ref.focus()
      expect(document.activeElement).toBe(wrapper.get('button').element)
      await wrapper.get('button').trigger('click')
      expect(submit).toHaveBeenCalledOnce()
      expect(wrapper.get('button').attributes('aria-label')).toBe('保存计划')
    } finally {
      wrapper.unmount()
    }
  })
  it('blocks repeated clicks while saving and retains the label', async () => {
    const click = vi.fn()
    const loading = ref(true)
    const wrapper = mount({
      render: () => h(AppButton, { loading: loading.value, onClick: click }, () => '保存计划'),
    })
    try {
      await wrapper.get('button').trigger('click')
      expect(click).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('保存计划')
      loading.value = false
      await nextTick()
      await wrapper.get('button').trigger('click')
      expect(click).toHaveBeenCalledOnce()
    } finally {
      wrapper.unmount()
    }
  })
})

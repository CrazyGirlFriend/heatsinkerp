// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WatermelonButton from './WatermelonButton.vue'
import WatermelonDialog from './WatermelonDialog.vue'
import WatermelonPagination from './WatermelonPagination.vue'

vi.mock('motion-v', async () => {
  const { defineComponent, h, ref } = await import('vue')
  const element = (tag: string) =>
    defineComponent({
      props: ['initial', 'animate', 'transition', 'whilePress', 'whileHover', 'layoutId'],
      setup(_, { attrs, slots }) {
        return () => h(tag, attrs, slots.default?.())
      },
    })
  return {
    motion: { button: element('button'), div: element('div'), span: element('span') },
    useReducedMotion: () => ref(false),
  }
})

let wrapper: VueWrapper | undefined
const dialogPrototype = HTMLDialogElement.prototype
const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, 'close')
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
  this.querySelector<HTMLElement>('input, button')?.focus()
})
const close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open')
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  showModal.mockClear()
  close.mockClear()
  Object.defineProperty(dialogPrototype, 'showModal', { configurable: true, value: showModal })
  Object.defineProperty(dialogPrototype, 'close', { configurable: true, value: close })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  if (originalShowModal) Object.defineProperty(dialogPrototype, 'showModal', originalShowModal)
  else Reflect.deleteProperty(dialogPrototype, 'showModal')
  if (originalClose) Object.defineProperty(dialogPrototype, 'close', originalClose)
  else Reflect.deleteProperty(dialogPrototype, 'close')
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function opener() {
  const button = document.createElement('button')
  document.body.appendChild(button)
  button.focus()
  return button
}
function mountDialog(modelValue = false) {
  wrapper = mount(WatermelonDialog, {
    props: {
      title: '编辑资料',
      modelValue,
      'onUpdate:modelValue': (value: boolean) => wrapper?.setProps({ modelValue: value }),
    },
    slots: { default: '<input aria-label="名称" />' },
    attachTo: document.body,
  })
  return wrapper
}

describe('Watermelon shared primitives', () => {
  it('emits a button click once and blocks clicks while disabled or loading', async () => {
    const onClick = vi.fn()
    wrapper = mount(WatermelonButton, { props: { onClick }, slots: { default: '保存' } })
    const button = wrapper.get('button')
    await button.trigger('click')
    expect(onClick).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ disabled: true })
    button.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ disabled: false, loading: true })
    button.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.wm-button-spinner').exists()).toBe(true)
  })

  it('uses a configurable pagination label and prevents disabled or out-of-range changes', async () => {
    wrapper = mount(WatermelonPagination, {
      props: { currentPage: 1, pageSize: 10, total: 50 },
    })
    expect(wrapper.get('nav').attributes('aria-label')).toBe('分页')
    const previous = wrapper.get('button[aria-label="上一页"]')
    previous.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('current-change')).toBeUndefined()
    await wrapper.get('button[aria-label="下一页"]').trigger('click')
    expect(wrapper.emitted('current-change')).toEqual([[2]])
    await wrapper.setProps({ currentPage: 5, label: '订单分页' })
    expect(wrapper.get('nav').attributes('aria-label')).toBe('订单分页')
    expect(wrapper.get('[aria-current="page"]').attributes('aria-label')).toBe('第 5 页')
    wrapper
      .get('button[aria-label="下一页"]')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.setProps({ disabled: true })
    wrapper
      .get('button[aria-label="第 3 页"]')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('current-change')).toEqual([[2]])
  })

  it('opens an initially true dialog and restores the opening control after closing', async () => {
    const trigger = opener()
    mountDialog(true)
    await flushPromises()
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!
    expect(dialog.open).toBe(true)
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(dialog.contains(document.activeElement)).toBe(true)
    await wrapper!.setProps({ modelValue: false })
    await vi.advanceTimersByTimeAsync(160)
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the original focus target when a dialog reopens during its closing animation', async () => {
    const trigger = opener()
    mountDialog(true)
    await flushPromises()
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!
    await wrapper!.setProps({ modelValue: false })
    await vi.advanceTimersByTimeAsync(80)
    await wrapper!.setProps({ modelValue: true })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(200)
    expect(dialog.open).toBe(true)
    expect(showModal).toHaveBeenCalledTimes(1)
    await wrapper!.setProps({ modelValue: false })
    await vi.advanceTimersByTimeAsync(160)
    expect(document.activeElement).toBe(trigger)
    expect(dialog.open).toBe(false)
  })

  it('respects Escape and backdrop dismissal options', async () => {
    mountDialog(true)
    await flushPromises()
    await wrapper!.setProps({ closeOnPressEscape: false, closeOnClickModal: false })
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    dialog.click()
    await flushPromises()
    expect(cancel.defaultPrevented).toBe(true)
    expect(wrapper!.emitted('update:modelValue')).toBeUndefined()
    expect(dialog.open).toBe(true)
    await wrapper!.setProps({ closeOnPressEscape: true })
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(160)
    expect(wrapper!.emitted('update:modelValue')).toEqual([[false]])
    expect(dialog.open).toBe(false)
  })

  it('closes and clears pending animation timers on unmount', async () => {
    const trigger = opener()
    mountDialog(true)
    await flushPromises()
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!
    await wrapper!.setProps({ modelValue: false })
    wrapper!.unmount()
    wrapper = undefined
    expect(dialog.open).toBe(false)
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await vi.advanceTimersByTimeAsync(500)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not open a dialog whose initial mount was immediately removed', async () => {
    mountDialog(true)
    wrapper!.unmount()
    wrapper = undefined
    await flushPromises()
    expect(showModal).not.toHaveBeenCalled()
    expect(document.querySelector('dialog')).toBeNull()
  })
})

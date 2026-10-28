// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, expect, it } from 'vitest'
import ProductionSchedulesPage from './ProductionSchedulesPage.vue'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())

it('keeps fullscreen when Escape returns focus from a dialog, then allows the page to exit fullscreen', async () => {
  wrapper = mount(ProductionSchedulesPage, {
    attachTo: document.body,
    global: {
      stubs: {
        PageBackButton: true,
        ScheduleTaskBoard: {
          template: '<div><slot name="heading"/><slot name="view-actions"/></div>',
        },
      },
    },
  })
  await wrapper.get('button').trigger('click')
  expect(wrapper.classes()).toContain('production-schedules-page--fullscreen')
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const input = document.createElement('input')
  dialog.append(input)
  document.body.append(dialog)
  try {
    input.focus()
    input.addEventListener(
      'keydown',
      () => (wrapper.get('button').element as HTMLButtonElement).focus(),
      { once: true },
    )
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    )
    await nextTick()
    expect(wrapper.classes()).toContain('production-schedules-page--fullscreen')
    wrapper
      .get('button')
      .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.classes()).not.toContain('production-schedules-page--fullscreen')
  } finally {
    dialog.remove()
  }
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WatermelonFilter from './WatermelonFilter.vue'

const wrappers: VueWrapper[] = []
const options = [
  { value: '', label: '全部' },
  { value: 'new', label: '待处理' },
  { value: 'archived', label: '已归档', disabled: true },
  { value: 'done', label: '已完成' },
]
function render(value = 'new') {
  const wrapper = mount(WatermelonFilter, {
    props: { modelValue: value, options, title: '处理状态' },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}
function menu() {
  return document.querySelector<HTMLElement>('[role="menu"]')!
}
function key(value: string) {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('WatermelonFilter', () => {
  it('focuses the selected option, skips disabled choices, and returns focus on Escape', async () => {
    const wrapper = render()
    const trigger = wrapper.get<HTMLButtonElement>('.wm-filter-trigger')
    await trigger.trigger('click')
    await flushPromises()
    expect(menu().getAttribute('aria-label')).toBe('处理状态')
    expect(document.activeElement?.textContent).toContain('待处理')
    key('ArrowDown')
    expect(document.activeElement?.textContent).toContain('已完成')
    key('Home')
    expect(document.activeElement?.textContent).toContain('全部')
    key('End')
    expect(document.activeElement?.textContent).toContain('已完成')
    key('Escape')
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
  })

  it('emits generic values including the empty choice and blocks disabled options', async () => {
    const wrapper = render()
    await wrapper.get('.wm-filter-trigger').trigger('click')
    await flushPromises()
    const choices = [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    choices
      .find((choice) => choice.disabled)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('change')).toBeUndefined()
    choices[0]!.click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    expect(wrapper.emitted('change')).toEqual([['']])
  })

  it('closes when its trigger is clicked again after focus returns to the trigger', async () => {
    const wrapper = render()
    const trigger = wrapper.get<HTMLButtonElement>('.wm-filter-trigger')
    await trigger.trigger('click')
    await flushPromises()
    trigger.element.focus()
    await flushPromises()
    await trigger.trigger('click')
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('keeps instances separate and closes when focus or a pointer leaves the menu', async () => {
    const parent = mount(
      {
        components: { WatermelonFilter },
        setup: () => ({ options }),
        template:
          '<div><WatermelonFilter :options="options" model-value="new" /><WatermelonFilter :options="options" model-value="done" /></div>',
      },
      { attachTo: document.body },
    )
    wrappers.push(parent)
    const [first, second] = parent.findAllComponents(WatermelonFilter)
    const firstTrigger = first!.get('.wm-filter-trigger')
    const secondTrigger = second!.get('.wm-filter-trigger')
    expect(firstTrigger.attributes('aria-controls')).not.toBe(
      secondTrigger.attributes('aria-controls'),
    )
    await firstTrigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(firstTrigger.attributes('aria-expanded')).toBe('true')
    secondTrigger.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(firstTrigger.attributes('aria-expanded')).toBe('false')
    await secondTrigger.trigger('click')
    await flushPromises()
    ;(firstTrigger.element as HTMLButtonElement).focus()
    await flushPromises()
    expect(secondTrigger.attributes('aria-expanded')).toBe('false')
  })

  it('keeps its popover inside an enclosing native dialog', async () => {
    const parent = mount(
      {
        components: { WatermelonFilter },
        setup: () => ({ options }),
        template: '<dialog open><WatermelonFilter :options="options" model-value="new" /></dialog>',
      },
      { attachTo: document.body },
    )
    wrappers.push(parent)
    await parent.get('.wm-filter-trigger').trigger('click')
    await flushPromises()
    expect(parent.get('dialog').element.contains(menu())).toBe(true)
    expect(document.activeElement?.textContent).toContain('待处理')
  })

  it('positions from the measured panel dimensions within a short viewport', async () => {
    vi.stubGlobal('innerWidth', 360)
    vi.stubGlobal('innerHeight', 220)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('wm-filter-panel') ? 264 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('wm-filter-panel') ? 196 : 0
    })
    const wrapper = render()
    const trigger = wrapper.get<HTMLButtonElement>('.wm-filter-trigger')
    vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({
      x: 280,
      y: 120,
      left: 280,
      top: 120,
      right: 360,
      bottom: 158,
      width: 80,
      height: 38,
      toJSON: () => ({}),
    })
    await trigger.trigger('click')
    await flushPromises()
    const panel = document.querySelector<HTMLElement>('.wm-filter-panel')!
    expect(panel.style.left).toBe('84px')
    expect(panel.style.top).toBe('12px')
  })
})

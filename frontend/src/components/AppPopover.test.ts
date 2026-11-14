// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import AppPopover from './AppPopover.vue'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
import TableColumnFilter from './TableColumnFilter.vue'

const wrappers: VueWrapper[] = []
const hosts: HTMLElement[] = []
function host() {
  const element = document.createElement('div')
  document.body.append(element)
  hosts.push(element)
  return element
}
const global = {
  // Exercise the real transition hooks: the panel is released after its exit animation.
  stubs: { transition: false },
  provide: { [workspaceAppearanceKey as symbol]: computed(() => 'watermelon') },
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  for (const element of hosts.splice(0)) element.remove()
  localStorage.clear()
})

describe('shared popover lifecycle', () => {
  it('creates only the opened row panel, releases it on close, and can reopen it', async () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    const content = defineComponent({
      setup() {
        onMounted(mounted)
        onUnmounted(unmounted)
        return () => h('p', { class: 'row-preview' }, '工序要求')
      },
    })
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          Array.from({ length: 20 }, (_, index) =>
            h(
              AppPopover,
              {
                trigger: 'click',
                showAfter: 0,
                hideAfter: 0,
              },
              {
                reference: () => h('button', `工序 ${index}`),
                default: () => h(content),
              },
            ),
          ),
      }),
      { attachTo: host(), global },
    )
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.findAll('button')).toHaveLength(20)
    expect(mounted).not.toHaveBeenCalled()
    const button = wrapper.findAll('button')[0]!
    for (let count = 1; count <= 2; count++) {
      await button.trigger('click')
      await vi.waitFor(() => expect(mounted).toHaveBeenCalledTimes(count))
      expect(document.querySelectorAll('.row-preview')).toHaveLength(1)
      expect(document.querySelector('.wm-control-menu')).not.toBeNull()
      await button.trigger('click')
      await vi.waitFor(() => expect(unmounted).toHaveBeenCalledTimes(count))
      expect(document.querySelector('.row-preview')).toBeNull()
    }
  })

  it.each(['hover', 'focus'] as const)('keeps %s previews accessible', async (trigger) => {
    const wrapper = mount(AppPopover, {
      attachTo: host(),
      global,
      attrs: { trigger, showAfter: 0, hideAfter: 0 },
      slots: {
        reference: () => h('button', '查看要求'),
        default: () => h('p', { class: 'accessible-preview' }, '尺寸要求'),
      },
    })
    wrappers.push(wrapper)
    await wrapper.get('button').trigger(trigger === 'hover' ? 'mouseenter' : 'focus')
    await vi.waitFor(() => expect(document.querySelector('.accessible-preview')).not.toBeNull())
    await wrapper.get('button').trigger(trigger === 'hover' ? 'mouseleave' : 'blur')
    await vi.waitFor(() => expect(document.querySelector('.accessible-preview')).toBeNull())
  })

  it('honors explicit retention when a caller needs to keep child state', async () => {
    const visible = ref(false)
    const retained = defineComponent({
      setup: () => () =>
        h(
          AppPopover,
          { persistent: true, visible: visible.value },
          {
            reference: () => h('button', '打开'),
            default: () => h('input', { class: 'retained-draft' }),
          },
        ),
    })
    const wrapper = mount(retained, {
      attachTo: host(),
      global,
    })
    wrappers.push(wrapper)
    await flushPromises()
    const input = document.querySelector<HTMLInputElement>('.retained-draft')!
    expect(input).not.toBeNull()
    input.value = '未提交草稿'
    visible.value = true
    await flushPromises()
    visible.value = false
    await flushPromises()
    expect(document.querySelector('.retained-draft')).toBe(input)
    expect(input.value).toBe('未提交草稿')
  })

  it('preserves applied column choices when a virtual-anchor panel is recreated', async () => {
    const anchor = document.createElement('button')
    host().append(anchor)
    const wrapper = mount(InventoryColumnSettings, {
      attachTo: host(),
      global,
      props: {
        storageKey: null,
        showTrigger: false,
        columns: [{ key: 'quantity', label: '数量', defaultVisible: true }],
      },
    })
    wrappers.push(wrapper)
    const open = () =>
      (wrapper.vm as unknown as { open: (element: HTMLElement) => void }).open(anchor)
    expect(document.querySelector('.column-settings')).toBeNull()
    open()
    await vi.waitFor(() => expect(document.querySelector('.column-settings')).not.toBeNull())
    document.querySelector<HTMLInputElement>('.column-settings input')!.click()
    await flushPromises()
    Array.from(document.querySelectorAll<HTMLButtonElement>('.column-settings button'))
      .find((button) => button.textContent?.trim() === '应用')!
      .click()
    await vi.waitFor(() => expect(document.querySelector('.column-settings')).toBeNull())
    expect(wrapper.emitted('change')?.at(-1)).toEqual([[{ key: 'quantity', visible: false }]])
    open()
    await vi.waitFor(() => expect(document.querySelector('.column-settings')).not.toBeNull())
    expect(document.querySelector<HTMLInputElement>('.column-settings input')!.checked).toBe(false)
  })

  it('restores a column filter and input focus after closing an unsaved draft', async () => {
    const wrapper = mount(TableColumnFilter, {
      attachTo: host(),
      global,
      props: { label: '流水号', value: '691236-50' },
    })
    wrappers.push(wrapper)
    const trigger = wrapper.get('button')
    for (let count = 0; count < 2; count++) {
      await trigger.trigger('click')
      await vi.waitFor(() => {
        const input = document.querySelector<HTMLInputElement>('.table-column-filter-form input')
        expect(input?.value).toBe('691236-50')
        expect(document.activeElement).toBe(input)
      })
      const input = document.querySelector<HTMLInputElement>('.table-column-filter-form input')!
      input.value = '未应用'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await vi.waitFor(() => expect(document.querySelector('.table-column-filter-form')).toBeNull())
    }
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('recreates the calendar with the applied range after a cancelled selection', async () => {
    const wrapper = mount(ScheduleDateRange, {
      attachTo: host(),
      global,
      props: { modelValue: ['2026-11-09', '2026-11-15'] },
    })
    wrappers.push(wrapper)
    for (let count = 0; count < 2; count++) {
      await wrapper.get('button').trigger('click')
      await vi.waitFor(() =>
        expect(document.querySelector('.date-range-footer')?.textContent).toContain('共 7 天'),
      )
      document.querySelector<HTMLButtonElement>('.range-day[aria-label="2026-11-10"]')!.click()
      await flushPromises()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await vi.waitFor(() => expect(document.querySelector('.date-range-footer')).toBeNull())
    }
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

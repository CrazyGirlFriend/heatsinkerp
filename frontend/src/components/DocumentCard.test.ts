// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import DocumentCard from './DocumentCard.vue'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

it('loads an offscreen preview only when visible, keeps it mounted and disconnects on cleanup', async () => {
  let intersect!: (entries: { isIntersecting: boolean }[]) => void
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  const mounted = vi.fn()
  wrapper = mount(DocumentCard, {
    props: { lazy: true, title: '图纸' },
    slots: { default: defineComponent({ mounted, template: '<div>PDF 预览</div>' }) },
  })
  expect(observe).toHaveBeenCalledOnce()
  expect(mounted).not.toHaveBeenCalled()
  intersect([{ isIntersecting: false }])
  await flushPromises()
  expect(mounted).not.toHaveBeenCalled()
  intersect([{ isIntersecting: true }])
  await flushPromises()
  expect(mounted).toHaveBeenCalledOnce()
  expect(wrapper.text()).toContain('PDF 预览')
  expect(disconnect).toHaveBeenCalledOnce()
  intersect([{ isIntersecting: false }])
  await flushPromises()
  expect(wrapper.text()).toContain('PDF 预览')
  wrapper.unmount()
  expect(disconnect).toHaveBeenCalledTimes(2)
})

it('keeps existing cards eager unless lazy loading is requested', () => {
  const observer = vi.fn()
  vi.stubGlobal('IntersectionObserver', observer)
  wrapper = mount(DocumentCard, { slots: { default: '<div>附件</div>' } })
  expect(wrapper.text()).toBe('附件')
  expect(observer).not.toHaveBeenCalled()
})

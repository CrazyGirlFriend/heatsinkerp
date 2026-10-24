// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DocumentViewer from './DocumentViewer.vue'
let wrapper: VueWrapper
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
it('shows only the file and compact controls, without a business dialog or another browser page', async () => {
  wrapper = mount(DocumentViewer, {
    attachTo: document.body,
    props: { title: '图纸', pdf: 'blob:pdf' },
  })
  await flushPromises()
  const viewer = document.querySelector('.document-viewer')!
  expect(viewer.querySelector('.el-dialog')).toBeNull()
  expect(viewer.querySelector('iframe')!.getAttribute('src')).toBe(
    'blob:pdf#toolbar=0&navpanes=0&view=Fit',
  )
  ;(viewer.querySelector('button[aria-label="放大文件"]') as HTMLButtonElement).click()
  await flushPromises()
  expect(viewer.querySelector('iframe')!.getAttribute('src')).toContain('zoom=125')
  ;(viewer.querySelector('button[aria-label="缩小文件"]') as HTMLButtonElement).click()
  await flushPromises()
  expect(viewer.querySelector('iframe')!.getAttribute('src')).toContain('zoom=100')
  ;(viewer.querySelector('button[aria-label="适合窗口"]') as HTMLButtonElement).click()
  await flushPromises()
  expect(viewer.querySelector('iframe')!.getAttribute('src')).toContain('view=Fit')
  ;(viewer.querySelector('button[aria-label="关闭放大预览"]') as HTMLButtonElement).click()
  expect(wrapper.emitted('close')).toHaveLength(1)
})
it('retains Word isolation and releases the active viewer with Escape', async () => {
  wrapper = mount(DocumentViewer, {
    attachTo: document.body,
    props: { title: '工艺原稿', html: '<main id="original-pages">原文</main>' },
  })
  await flushPromises()
  const frame = document.querySelector('.document-viewer iframe')!
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  expect(frame.getAttribute('srcdoc')).toContain('原文')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
  expect(wrapper.emitted('close')).toHaveLength(1)
})

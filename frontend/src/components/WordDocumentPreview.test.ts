// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WordDocumentPreview from './WordDocumentPreview.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'

const render = vi.hoisted(() => vi.fn())
vi.mock('docx-preview', () => ({ renderAsync: render }))
let wrapper: VueWrapper | undefined
const blob = { arrayBuffer: async () => new ArrayBuffer(4) } as Blob
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(processRouteApi, 'source').mockResolvedValue(blob)
  vi.spyOn(processRouteApi, 'download').mockResolvedValue(undefined)
  render.mockImplementation(async (_data, body: HTMLElement, style: HTMLElement) => {
    body.innerHTML =
      '<div class="docx-original-wrapper"><section class="docx-original" style="width:600pt"><table><tr><td>原件表格及公差 ±0.05</td></tr></table><a href="https://invalid.example" target="_top">原文链接文字</a></section></div>'
    style.innerHTML = '<style>.docx-original td{border:1px solid black}</style>'
    return {}
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  render.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('renders retained Word bytes with its original table and styles only inside an isolated frame', async () => {
  wrapper = mount(WordDocumentPreview, { props: { route: routeFixture } })
  await flushPromises()
  expect(processRouteApi.source).toHaveBeenCalledWith(routeFixture.id, expect.any(AbortSignal))
  expect(render).toHaveBeenCalledWith(
    expect.any(ArrayBuffer),
    expect.any(HTMLElement),
    expect.any(HTMLElement),
    expect.objectContaining({
      ignoreWidth: false,
      ignoreFonts: false,
      renderHeaders: true,
      renderFooters: true,
      renderAltChunks: false,
      useBase64URL: true,
    }),
  )
  const frame = wrapper.get('iframe')
  expect(frame.attributes('sandbox')).toBe('')
  expect(frame.attributes('referrerpolicy')).toBe('no-referrer')
  const html = frame.attributes('srcdoc')!
  expect(html).toContain('原件表格及公差 ±0.05')
  expect(html).toContain('<table>')
  expect(html).toContain('border:1px solid black')
  expect(html).toContain("default-src 'none'")
  expect(html).not.toContain('href="https://invalid.example"')
  expect(html).not.toContain('target="_top"')
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('原件表格及公差')
  await wrapper.get('select').setValue('0.75')
  expect(wrapper.get('iframe').attributes('srcdoc')).toContain('zoom:0.75')
  await wrapper.get('button').trigger('click')
  expect(processRouteApi.download).toHaveBeenCalledWith(routeFixture)
})
it('keeps a clear retry state when the authenticated source cannot be read', async () => {
  vi.mocked(processRouteApi.source).mockRejectedValueOnce(new Error('unavailable'))
  wrapper = mount(WordDocumentPreview, { props: { route: routeFixture } })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('预览暂时失败')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '重试')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(render).toHaveBeenCalledOnce()
})
it('aborts reads and ignores a delayed source after closing the preview', async () => {
  let resolve!: (value: Blob) => void
  vi.mocked(processRouteApi.source).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  wrapper = mount(WordDocumentPreview, { props: { route: routeFixture } })
  const signal = vi.mocked(processRouteApi.source).mock.calls[0]![1]!
  wrapper.unmount()
  wrapper = undefined
  resolve(blob)
  await flushPromises()
  expect(signal.aborted).toBe(true)
  expect(render).not.toHaveBeenCalled()
})

it('keeps the frame observed during an asynchronous first load and fits the page after a narrow resize', async () => {
  let finish!: (value: Blob) => void
  let resize!: ResizeObserverCallback
  const created = vi.fn(),
    observe = vi.fn(),
    disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
        created()
      }
      observe = observe
      disconnect = disconnect
    },
  )
  vi.mocked(processRouteApi.source).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  wrapper = mount(WordDocumentPreview, { props: { route: routeFixture } })
  const originalFrame = wrapper.get('iframe').element
  expect(wrapper.get('iframe').classes()).toContain('word-original-frame--hidden')
  expect(observe).toHaveBeenCalledWith(originalFrame)
  finish(blob)
  await flushPromises()
  expect(wrapper.get('iframe').element).toBe(originalFrame)
  expect(wrapper.get('iframe').classes()).not.toContain('word-original-frame--hidden')
  resize(
    [{ target: originalFrame, contentRect: { width: 320 } } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  )
  await flushPromises()
  expect(wrapper.get('iframe').attributes('srcdoc')).toContain('zoom:0.37')
  resize(
    [{ target: originalFrame, contentRect: { width: 480 } } as unknown as ResizeObserverEntry],
    {} as ResizeObserver,
  )
  await flushPromises()
  expect(wrapper.get('iframe').attributes('srcdoc')).toContain('zoom:0.57')
  await wrapper.setProps({ route: { ...routeFixture, id: 99 } })
  await flushPromises()
  expect(wrapper.get('iframe').element).toBe(originalFrame)
  expect(created).toHaveBeenCalledOnce()
  expect(observe).toHaveBeenCalledOnce()
  wrapper.unmount()
  wrapper = undefined
  expect(disconnect).toHaveBeenCalledOnce()
})

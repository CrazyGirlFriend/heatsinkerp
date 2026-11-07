// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OrderDocumentPreview from './OrderDocumentPreview.vue'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'

let wrapper: VueWrapper
const pdf = new Blob(['%PDF-original-layout'], { type: 'application/pdf' })
beforeEach(() => {
  vi.spyOn(productionScheduleApi, 'previewOrder').mockResolvedValue(pdf)
  vi.spyOn(productionScheduleApi, 'orderPreview').mockResolvedValue(pdf)
  vi.spyOn(processRouteApi, 'orderPreview').mockResolvedValue(pdf)
  let index = 0
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => `blob:order-${++index}`)
      static revokeObjectURL = vi.fn()
    },
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function render(props: { routeId: number; taskId?: number; file?: File }) {
  wrapper = mount(OrderDocumentPreview, {
    props,
    global: { stubs: { DocumentViewer: true } },
  })
}

it('previews the uploaded original file and opens the same layout without rebuilding its cells', async () => {
  const file = new File(['original-xlsx-bytes'], '订单.xlsx')
  render({ routeId: 8, file })
  expect(wrapper.get('[role="status"]').text()).toBe('正在加载订单原件…')
  await flushPromises()
  expect(productionScheduleApi.previewOrder).toHaveBeenCalledWith(file, expect.any(AbortSignal))
  expect(productionScheduleApi.orderPreview).not.toHaveBeenCalled()
  expect(processRouteApi.orderPreview).not.toHaveBeenCalled()
  expect(wrapper.get('iframe').attributes('src')).toBe('blob:order-1#toolbar=0&navpanes=0&view=Fit')
  expect(wrapper.find('table').exists()).toBe(false)
  await wrapper.get('button[aria-label="放大订单表"]').trigger('click')
  const viewer = wrapper.getComponent(DocumentViewer)
  expect(viewer.props('pdf')).toBe('blob:order-1')
  expect(viewer.props('html')).toBeUndefined()
  expect(viewer.props('initialZoom')).toBe(100)
  viewer.vm.$emit('close')
  await flushPromises()
  expect(wrapper.findComponent(DocumentViewer).exists()).toBe(false)
})

it('loads the saved dispatch original rather than a legacy engineering order', async () => {
  render({ routeId: 8, taskId: 42 })
  await flushPromises()
  expect(productionScheduleApi.orderPreview).toHaveBeenCalledWith(42, expect.any(AbortSignal))
  expect(processRouteApi.orderPreview).not.toHaveBeenCalled()
  await wrapper.setProps({ routeId: 9 })
  await flushPromises()
  expect(productionScheduleApi.orderPreview).toHaveBeenCalledOnce()
})

it('can still read the original file retained with a legacy engineering route', async () => {
  render({ routeId: 8 })
  await flushPromises()
  expect(processRouteApi.orderPreview).toHaveBeenCalledWith(8, expect.any(AbortSignal))
  expect(productionScheduleApi.orderPreview).not.toHaveBeenCalled()
})

it('does not substitute a different order after a failed read and allows retrying', async () => {
  vi.mocked(productionScheduleApi.orderPreview).mockRejectedValueOnce(new Error('unavailable'))
  render({ routeId: 8, taskId: 42 })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('订单原件预览失败')
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(processRouteApi.orderPreview).not.toHaveBeenCalled()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.find('iframe').exists()).toBe(true)
})

it('aborts a previous request and ignores its result after switching order files', async () => {
  let finish!: (value: Blob) => void
  vi.mocked(productionScheduleApi.previewOrder).mockReturnValueOnce(
    new Promise((resolve) => (finish = resolve)),
  )
  const first = new File(['first'], '第一份.xlsx')
  render({ routeId: 8, file: first })
  const signal = vi.mocked(productionScheduleApi.previewOrder).mock.calls[0]![1]!
  const second = new File(['second'], '第二份.xlsx')
  await wrapper.setProps({ file: second })
  await flushPromises()
  expect(signal.aborted).toBe(true)
  expect(productionScheduleApi.previewOrder).toHaveBeenLastCalledWith(
    second,
    expect.any(AbortSignal),
  )
  finish(pdf)
  await flushPromises()
  expect(URL.createObjectURL).toHaveBeenCalledOnce()
  expect(wrapper.get('iframe').attributes('src')).toContain('blob:order-1')
})

it('releases old preview URLs and closes the viewer when changing the order', async () => {
  render({ routeId: 8, taskId: 42 })
  await flushPromises()
  await wrapper.get('button[aria-label="放大订单表"]').trigger('click')
  await wrapper.setProps({ taskId: 43 })
  await flushPromises()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:order-1')
  expect(wrapper.findComponent(DocumentViewer).exists()).toBe(false)
  const signal = vi.mocked(productionScheduleApi.orderPreview).mock.calls.at(-1)![1]!
  wrapper.unmount()
  expect(signal.aborted).toBe(true)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:order-2')
})

it('does not allocate a preview after unmounting while the request is pending', async () => {
  let finish!: (value: Blob) => void
  vi.mocked(productionScheduleApi.orderPreview).mockReturnValueOnce(
    new Promise((resolve) => (finish = resolve)),
  )
  render({ routeId: 8, taskId: 42 })
  wrapper.unmount()
  finish(pdf)
  await flushPromises()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('previews a warehouse original with its supplied loader and opens that same document', async () => {
  const loadPreview = vi.fn().mockResolvedValue(pdf)
  wrapper = mount(OrderDocumentPreview, {
    props: { routeId: 0, loadPreview },
    global: { stubs: { DocumentViewer: true } },
  })
  await flushPromises()
  expect(loadPreview).toHaveBeenCalledWith(expect.any(AbortSignal))
  expect(productionScheduleApi.previewOrder).not.toHaveBeenCalled()
  expect(productionScheduleApi.orderPreview).not.toHaveBeenCalled()
  expect(processRouteApi.orderPreview).not.toHaveBeenCalled()
  await wrapper.get('[aria-label="放大订单表"]').trigger('click')
  expect(wrapper.getComponent(DocumentViewer).props('pdf')).toBe('blob:order-1')
  const signal = loadPreview.mock.calls[0]![0] as AbortSignal
  wrapper.unmount()
  expect(signal.aborted).toBe(true)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:order-1')
})

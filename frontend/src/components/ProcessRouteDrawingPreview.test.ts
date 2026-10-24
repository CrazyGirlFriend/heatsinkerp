// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Preview from './ProcessRouteDrawingPreview.vue'
import { processRouteApi } from '@/services/processRouteApi'
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(processRouteApi, 'previewDrawing').mockResolvedValue(
    new Blob(['preview'], { type: 'application/pdf' }),
  )
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:pdf-preview'),
      revokeObjectURL: vi.fn(),
    }),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('previews a local drawing without saving it and opens a simple in-place viewer', async () => {
  const download = vi.spyOn(processRouteApi, 'drawing')
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const file = new File(['%PDF'], '图纸.pdf', { type: 'application/pdf' })
  wrapper = mount(Preview, { props: { routeId: 0, file } })
  await flushPromises()
  expect(download).not.toHaveBeenCalled()
  expect(processRouteApi.previewDrawing).toHaveBeenCalledWith(file, expect.any(AbortSignal))
  expect(wrapper.get('iframe').attributes('src')).toBe(
    'blob:pdf-preview#toolbar=0&navpanes=0&view=Fit',
  )
  ;(wrapper.vm as unknown as { open: () => void }).open()
  await flushPromises()
  expect(document.querySelector('.document-viewer')).not.toBeNull()
  expect(document.querySelector('.document-viewer .el-dialog')).toBeNull()
  expect(open).not.toHaveBeenCalled()
  wrapper.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-preview')
})
it('downloads the retained original instead of the direction-adjusted preview', async () => {
  const original = new Blob(['original'])
  const get = vi
    .spyOn(processRouteApi, 'drawing')
    .mockImplementation(async (_route, _id, _signal, preview) =>
      preview ? new Blob(['upright-preview']) : original,
    )
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  wrapper = mount(Preview, {
    props: { routeId: 8, drawing: { id: 1, filename: '图纸.pdf', size_bytes: 100 } },
  })
  await flushPromises()
  expect(get).toHaveBeenCalledWith(8, 1, expect.any(AbortSignal), true)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(get).toHaveBeenLastCalledWith(8, 1, expect.any(AbortSignal))
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(original)
  expect(click).toHaveBeenCalledOnce()
})
it('aborts a stale file fetch and does not retain an object URL after closing', async () => {
  let resolve!: (blob: Blob) => void
  const download = vi.spyOn(processRouteApi, 'drawing').mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  wrapper = mount(Preview, {
    props: { routeId: 8, drawing: { id: 1, filename: '图纸.pdf', size_bytes: 100 } },
  })
  const signal = download.mock.calls[0]![2]!
  wrapper.unmount()
  expect(signal.aborted).toBe(true)
  resolve(new Blob(['pdf']))
  await flushPromises()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

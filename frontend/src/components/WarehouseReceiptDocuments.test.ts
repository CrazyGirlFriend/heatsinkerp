// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WarehouseReceiptDocuments from './WarehouseReceiptDocuments.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import OrderDocumentPreview from './OrderDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import type { ReceiptDocument, ReceiptDocumentKind } from '@/types/warehouseReceiptDocuments'

let wrapper: VueWrapper
const stubs = {
  WordDocumentPreview: true,
  OrderDocumentPreview: true,
  ProcessRouteDrawingPreview: true,
}
const document = (kind: ReceiptDocumentKind, id = 1): ReceiptDocument => ({
  id,
  kind,
  filename: `${kind}.${kind === 'process' ? 'docx' : kind === 'order' ? 'xlsx' : 'pdf'}`,
  size_bytes: 100,
  sha256: 'digest',
  parsed: kind === 'order' ? orderFixture : {},
})
beforeEach(() => {
  vi.spyOn(processRouteApi, 'dispatchOrder').mockResolvedValue(null)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
function render(props: Partial<InstanceType<typeof WarehouseReceiptDocuments>['$props']> = {}) {
  wrapper = mount(WarehouseReceiptDocuments, {
    props: { teamId: 1, documents: [], editable: true, ...props },
    global: { stubs },
  })
}
async function selectFiles(kind: ReceiptDocumentKind, files: File[]) {
  const section = wrapper.get(`[data-document-kind="${kind}"]`)
  await section
    .findAll('button')
    .find((button) => ['上传', '上传图纸', '替换'].includes(button.text()))!
    .trigger('click')
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
}

it('inherits engineering originals, drawings and the serial-specific dispatch order', async () => {
  vi.mocked(processRouteApi.dispatchOrder).mockResolvedValue({
    task_id: 52,
    document: orderFixture,
  })
  const route = { ...routeFixture, drawings: [{ id: 4, filename: '加工.pdf', size_bytes: 100 }] }
  render({ route, serialNo: 'S-001' })
  await flushPromises()
  expect(wrapper.getComponent(WordDocumentPreview).props('route')).toEqual(route)
  expect(wrapper.getComponent(ProcessRouteDrawingPreview).props('drawing')).toEqual(
    route.drawings[0],
  )
  expect(wrapper.getComponent(OrderDocumentPreview).props('taskId')).toBe(52)
  expect(wrapper.emitted('inherited-order')?.at(-1)).toEqual([orderFixture])
  expect(wrapper.get('[data-document-kind="process"]').text()).not.toContain('替换')
  expect(wrapper.get('[data-document-kind="order"]').text()).not.toContain('替换')
})

it('does not copy a different engineering order when the selected serial has no dispatch order', async () => {
  render({
    route: {
      ...routeFixture,
      source_data: { ...routeFixture.source_data, order_document: orderFixture },
    },
    serialNo: 'OTHER',
  })
  await flushPromises()
  expect(wrapper.findComponent(OrderDocumentPreview).exists()).toBe(false)
  expect(wrapper.get('[data-document-kind="order"]').text()).toContain('未上传订单表')
  expect(wrapper.emitted('inherited-order')?.at(-1)).toEqual([null])
})

it('uses the original engineering order only when its serial matches and no dispatch order exists', async () => {
  const route = {
    ...routeFixture,
    source_data: { ...routeFixture.source_data, order_document: orderFixture },
  }
  const download = vi.spyOn(processRouteApi, 'downloadOrder').mockResolvedValue(undefined)
  render({ route, serialNo: 'S-001' })
  await flushPromises()
  expect(wrapper.getComponent(OrderDocumentPreview).props('routeId')).toBe(route.id)
  expect(wrapper.getComponent(OrderDocumentPreview).props('taskId')).toBeUndefined()
  expect(wrapper.emitted('inherited-order')?.at(-1)).toEqual([orderFixture])
  await wrapper
    .get('[data-document-kind="order"]')
    .findAll('button')
    .find((button) => button.text() === '下载原件')!
    .trigger('click')
  expect(download).toHaveBeenCalledWith(route)
})

it('clears inherited order data immediately and ignores a late result after switching serials', async () => {
  let finish!: (value: { task_id: number; document: typeof orderFixture }) => void
  vi.mocked(processRouteApi.dispatchOrder).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  render({ route: routeFixture, serialNo: 'FIRST' })
  await wrapper.setProps({ serialNo: 'SECOND' })
  await flushPromises()
  finish({ task_id: 52, document: orderFixture })
  await flushPromises()
  expect(wrapper.findComponent(OrderDocumentPreview).exists()).toBe(false)
  expect(wrapper.emitted('inherited-order')?.at(-1)).toEqual([null])
})

it('uploads a missing original without a serial or route and returns its parsed fields for confirmation', async () => {
  const result = document('order')
  const upload = vi.spyOn(warehouseReceiptDocumentApi, 'upload').mockResolvedValue(result)
  render()
  const file = new File(['original'], '订单.xlsx')
  await selectFiles('order', [file])
  await flushPromises()
  expect(upload).toHaveBeenCalledWith(1, 'order', file)
  expect(wrapper.emitted('uploaded')).toEqual([[result]])
  expect(wrapper.emitted('busy')).toEqual([[false], [true], [false]])
})

it('keeps the active upload when its parent disables the form while waiting', async () => {
  let finish!: (value: ReceiptDocument) => void
  vi.spyOn(warehouseReceiptDocumentApi, 'upload').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  render()
  await selectFiles('process', [new File(['original'], '工艺.docx')])
  await wrapper.setProps({ disabled: true })
  const result = document('process')
  finish(result)
  await flushPromises()
  expect(wrapper.emitted('uploaded')).toEqual([[result]])
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([false])
})

it('uploads multiple supplemental drawings sequentially without changing the published route', async () => {
  const upload = vi
    .spyOn(warehouseReceiptDocumentApi, 'upload')
    .mockResolvedValueOnce(document('drawing', 1))
    .mockResolvedValueOnce(document('drawing', 2))
  const attach = vi.spyOn(processRouteApi, 'uploadDrawing')
  render({ route: routeFixture })
  await selectFiles('drawing', [new File(['1'], '第一张.pdf'), new File(['2'], '第二张.pdf')])
  await flushPromises()
  expect(upload).toHaveBeenCalledTimes(2)
  expect(wrapper.emitted('uploaded')).toHaveLength(2)
  expect(attach).not.toHaveBeenCalled()
})

it('loads saved supplemental originals through their own file endpoint', async () => {
  const docs = [document('process', 1), document('drawing', 2), document('order', 3)]
  const file = vi
    .spyOn(warehouseReceiptDocumentApi, 'file')
    .mockResolvedValue(new Blob(['original']))
  render({ documents: docs, editable: false })
  const signal = new AbortController().signal
  await wrapper.getComponent(WordDocumentPreview).props('loadSource')!(signal)
  await wrapper.getComponent(ProcessRouteDrawingPreview).props('loadPreview')!(signal)
  await wrapper.getComponent(OrderDocumentPreview).props('loadPreview')!(signal)
  expect(file.mock.calls).toEqual([
    [1, signal],
    [2, signal, true],
    [3, signal, true],
  ])
  expect(wrapper.getComponent(WordDocumentPreview).props('route').filename).toBe('process.docx')
  expect(
    wrapper.findAll('button').some((button) => ['上传', '替换', '移除'].includes(button.text())),
  ).toBe(false)
})

it('does not display another shared serial’s uploaded order in read-only details', async () => {
  render({
    documents: [document('order')],
    route: routeFixture,
    serialNo: 'OTHER',
    editable: false,
  })
  await flushPromises()
  expect(wrapper.findComponent(OrderDocumentPreview).exists()).toBe(false)
  expect(processRouteApi.dispatchOrder).toHaveBeenCalledWith(routeFixture.id, 'OTHER')
})

it('ignores an upload response after the team changes', async () => {
  let finish!: (value: ReceiptDocument) => void
  vi.spyOn(warehouseReceiptDocumentApi, 'upload').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  render()
  await selectFiles('process', [new File(['original'], '工艺.docx')])
  await wrapper.setProps({ teamId: 2 })
  finish(document('process'))
  await flushPromises()
  expect(wrapper.emitted('uploaded')).toBeUndefined()
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([false])
})

it('remains busy until the current serial’s inherited order has loaded, ignoring an earlier request', async () => {
  let finishFirst!: (value: null) => void
  let finishSecond!: (value: { task_id: number; document: typeof orderFixture }) => void
  vi.mocked(processRouteApi.dispatchOrder)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishSecond = resolve
      }),
    )
  render({ route: routeFixture, serialNo: 'FIRST' })
  await flushPromises()
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([true])
  await wrapper.setProps({ serialNo: 'SECOND' })
  finishFirst(null)
  await flushPromises()
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([true])
  expect(wrapper.emitted('busy')).toEqual([[false], [true]])
  finishSecond({ task_id: 52, document: orderFixture })
  await flushPromises()
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([false])
})

// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElSelect } from 'element-plus'
import SerialRouteAttachments from './SerialRouteAttachments.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import WarehouseReceiptDocuments from './WarehouseReceiptDocuments.vue'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import type { ReceiptDocument } from '@/types/warehouseReceiptDocuments'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
let wrapper: VueWrapper
const stubs = { ProcessRouteAttachments: true }
beforeEach(() => {
  vi.spyOn(processRouteApi, 'dispatchOrder').mockResolvedValue(null)
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(
    normalizeMaterialTransfer({ serial_no: '' }),
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('switches serial-specific attachments and keeps the bound version', async () => {
  const detail = vi
    .spyOn(processRouteApi, 'detail')
    .mockImplementation(async (id) => ({ ...routeFixture, id }))
  const resolve = vi.spyOn(processRouteApi, 'resolve')
  wrapper = mount(SerialRouteAttachments, {
    props: {
      items: [
        { serialNo: 'A', routeId: 8 },
        { serialNo: 'B', routeId: 9 },
      ],
    },
    global: { stubs },
  })
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(8)
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'B:9')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(9)
  expect(detail).toHaveBeenCalledTimes(2)
  expect(resolve).not.toHaveBeenCalled()
  await wrapper.setProps({
    items: [
      { serialNo: 'A', routeId: 8 },
      { serialNo: 'B', routeId: 9 },
    ],
  })
  await flushPromises()
  expect(detail).toHaveBeenCalledTimes(2)
})
it('ignores a late response after changing serials', async () => {
  let finish!: (value: typeof routeFixture) => void
  vi.spyOn(processRouteApi, 'resolve').mockImplementation((serial) =>
    serial === 'A'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ ...routeFixture, id: 9 }),
  )
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [{ serialNo: 'A' }] },
    global: { stubs },
  })
  await wrapper.setProps({ items: [{ serialNo: 'B' }] })
  await flushPromises()
  finish({ ...routeFixture, id: 8 })
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(9)
})
it('uses supplied documents without loading another route', async () => {
  const resolve = vi.spyOn(processRouteApi, 'resolve')
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [{ serialNo: 'S-001', route: routeFixture }] },
    global: { stubs },
  })
  await flushPromises()
  expect(resolve).not.toHaveBeenCalled()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(routeFixture.id)
})

it.each(['missing', 'failed'])(
  'does not reuse an engineering order when this order is %s',
  async (state) => {
    const route = {
      ...routeFixture,
      source_data: { ...routeFixture.source_data, order_document: orderFixture },
    }
    if (state === 'failed')
      vi.mocked(processRouteApi.dispatchOrder).mockRejectedValueOnce(new Error('订单表读取失败'))
    wrapper = mount(SerialRouteAttachments, {
      props: { items: [{ serialNo: 'ORDER-NEW', route }] },
      global: { stubs },
    })
    await flushPromises()
    const attachments = wrapper.getComponent(ProcessRouteAttachments)
    expect(attachments.props('route')).toEqual(route)
    expect(attachments.props('orderDocument')).toBeNull()
    expect(processRouteApi.dispatchOrder).toHaveBeenCalledWith(route.id, 'ORDER-NEW')
  },
)

it('loads the independent order document alongside the bound engineering attachments', async () => {
  const document = { ...orderFixture, serial_no: 'ORDER-NEW' }
  vi.mocked(processRouteApi.dispatchOrder).mockResolvedValue({ task_id: 51, document })
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [{ serialNo: 'ORDER-NEW', route: routeFixture }] },
    global: { stubs },
  })
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route')).toEqual(routeFixture)
  expect(wrapper.getComponent(ProcessRouteAttachments).props('orderDocument')).toEqual(document)
  expect(wrapper.getComponent(ProcessRouteAttachments).props('orderTaskId')).toBe(51)
})

it('keeps process and drawing previews available when the order request fails, and retries', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(routeFixture)
  vi.mocked(processRouteApi.dispatchOrder).mockRejectedValueOnce(new Error('订单表读取失败'))
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [{ serialNo: 'S-001', routeId: routeFixture.id }] },
    global: { stubs },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('订单表读取失败')
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route')).toEqual(routeFixture)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('订单表读取失败')
  expect(processRouteApi.dispatchOrder).toHaveBeenCalledTimes(2)
})

it('switches the original order preview and download with the processing form serial', async () => {
  vi.mocked(processRouteApi.dispatchOrder).mockImplementation(async (_, serial) => ({
    task_id: serial === 'ORDER-A' ? 51 : 52,
    document: { ...orderFixture, serial_no: serial, filename: `${serial}.xlsx` },
  }))
  vi.spyOn(productionScheduleApi, 'orderPreview').mockResolvedValue(new Blob(['original-pdf']))
  const legacy = vi.spyOn(processRouteApi, 'orderPreview')
  const download = vi.spyOn(productionScheduleApi, 'downloadOrder').mockResolvedValue(undefined)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:team-order-original')
      static revokeObjectURL = vi.fn()
    },
  )
  wrapper = mount(SerialRouteAttachments, {
    props: {
      items: [
        { serialNo: 'ORDER-A', route: routeFixture },
        { serialNo: 'ORDER-B', route: routeFixture },
      ],
    },
    global: {
      stubs: { WordDocumentPreview: true, ProcessRouteDrawingPreview: true, DocumentViewer: true },
    },
  })
  await flushPromises()
  expect(productionScheduleApi.orderPreview).toHaveBeenLastCalledWith(51, expect.any(AbortSignal))
  await wrapper.get('[aria-label="放大订单表"]').trigger('click')
  expect(wrapper.getComponent(DocumentViewer).props('pdf')).toBe('blob:team-order-original')
  expect(wrapper.getComponent(DocumentViewer).props('html')).toBeUndefined()
  expect(wrapper.find('.route-attachment-rail table').exists()).toBe(false)
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', `ORDER-B:${routeFixture.id}`)
  await flushPromises()
  expect(productionScheduleApi.orderPreview).toHaveBeenLastCalledWith(52, expect.any(AbortSignal))
  expect(wrapper.findComponent(DocumentViewer).exists()).toBe(false)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:team-order-original')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '下载原件')!
    .trigger('click')
  expect(download).toHaveBeenCalledWith(52, 'ORDER-B.xlsx')
  expect(legacy).not.toHaveBeenCalled()
})

it('shows persisted receipt originals even when the receipt has no serial or process route', async () => {
  const documents: ReceiptDocument[] = [
    {
      id: 12,
      kind: 'drawing',
      filename: '来料图纸.pdf',
      size_bytes: 100,
      sha256: 'digest',
      parsed: {},
    },
  ]
  const list = vi
    .spyOn(warehouseReceiptDocumentApi, 'forTransfer')
    .mockResolvedValue({ items: documents })
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [], batchNo: 'TL-RECEIPT' },
    global: { stubs: { WarehouseReceiptDocuments: true } },
  })
  await flushPromises()
  expect(list).toHaveBeenCalledWith('TL-RECEIPT')
  const attachments = wrapper.getComponent(WarehouseReceiptDocuments)
  expect(attachments.props('documents')).toEqual(documents)
  expect(attachments.props('editable')).toBe(false)
  expect(wrapper.text()).not.toContain('填写流水号后显示附件')
})

it('does not show another batch’s files when a previous document request finishes late', async () => {
  let finish!: (value: { items: ReceiptDocument[] }) => void
  vi.spyOn(warehouseReceiptDocumentApi, 'forTransfer')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValueOnce({ items: [] })
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [], batchNo: 'TL-FIRST' },
    global: { stubs: { WarehouseReceiptDocuments: true } },
  })
  await wrapper.setProps({ batchNo: 'TL-SECOND' })
  await flushPromises()
  finish({
    items: [
      {
        id: 12,
        kind: 'drawing',
        filename: '旧图纸.pdf',
        size_bytes: 100,
        sha256: 'digest',
        parsed: {},
      },
    ],
  })
  await flushPromises()
  expect(wrapper.getComponent(WarehouseReceiptDocuments).props('documents')).toEqual([])
})

it('does not infer an unbound saved receipt’s engineering route from its serial', async () => {
  const resolve = vi.spyOn(processRouteApi, 'resolve')
  vi.spyOn(warehouseReceiptDocumentApi, 'forTransfer').mockResolvedValue({ items: [] })
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [{ serialNo: 'UNBOUND' }], batchNo: 'TL-UNBOUND' },
    global: { stubs: { WarehouseReceiptDocuments: true } },
  })
  await flushPromises()
  expect(resolve).not.toHaveBeenCalled()
  expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')).toBeUndefined()
  expect(wrapper.text()).not.toContain('资料读取失败')
})

it('loads the bound route from the selected batch instead of guessing from a serial', async () => {
  vi.mocked(materialTransferApi.get).mockResolvedValue(
    normalizeMaterialTransfer({ serial_no: 'ORDER-A', process_route: { id: 8 } }),
  )
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, id: 8 })
  const resolve = vi.spyOn(processRouteApi, 'resolve')
  vi.spyOn(warehouseReceiptDocumentApi, 'forTransfer').mockResolvedValue({ items: [] })
  wrapper = mount(SerialRouteAttachments, {
    props: { items: [{ serialNo: '', batchNo: 'TL-A' }] },
    global: { stubs: { WarehouseReceiptDocuments: true } },
  })
  await flushPromises()
  expect(materialTransferApi.get).toHaveBeenCalledWith('TL-A')
  expect(resolve).not.toHaveBeenCalled()
  expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')?.id).toBe(8)
  expect(wrapper.getComponent(WarehouseReceiptDocuments).props('serialNo')).toBe('ORDER-A')
})

it('keeps separate batches of the same serial selectable and ignores stale originals', async () => {
  let finish!: (value: { items: ReceiptDocument[] }) => void
  vi.spyOn(warehouseReceiptDocumentApi, 'forTransfer')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValueOnce({ items: [] })
  vi.mocked(materialTransferApi.get).mockImplementation(async (batch) =>
    normalizeMaterialTransfer({
      serial_no: 'ORDER-A',
      process_route: { id: batch === 'TL-A' ? 8 : 9 },
    }),
  )
  vi.spyOn(processRouteApi, 'detail').mockImplementation(async (id) => ({ ...routeFixture, id }))
  wrapper = mount(SerialRouteAttachments, {
    props: {
      items: [
        { serialNo: 'ORDER-A', batchNo: 'TL-A' },
        { serialNo: 'ORDER-A', batchNo: 'TL-B' },
      ],
    },
    global: { stubs: { WarehouseReceiptDocuments: true } },
  })
  await flushPromises()
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'ORDER-A::TL-B')
  await flushPromises()
  finish({
    items: [
      { id: 12, kind: 'drawing', filename: '旧批次.pdf', size_bytes: 10, sha256: '', parsed: {} },
    ],
  })
  await flushPromises()
  const documents = wrapper.getComponent(WarehouseReceiptDocuments)
  expect(documents.props('route')?.id).toBe(9)
  expect(documents.props('documents')).toEqual([])
  expect(warehouseReceiptDocumentApi.forTransfer).toHaveBeenLastCalledWith('TL-B')
})

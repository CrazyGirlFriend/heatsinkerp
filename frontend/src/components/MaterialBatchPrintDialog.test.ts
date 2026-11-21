// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MaterialBatchPrintDialog from './MaterialBatchPrintDialog.vue'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import { materialTransferApi } from '@/services/materialTransferApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
let wrapper: VueWrapper
const items = dispatchFixture().items
beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined)
  vi.spyOn(materialTransferApi, 'get').mockImplementation(async (code) => ({
    ...items.find((row) => row.batch_no === code)!,
    quantity: 7,
  }))
  wrapper = mount(MaterialBatchPrintDialog, {
    props: { modelValue: true, items },
    global: {
      stubs: {
        ElDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        MaterialBatchPrintSheet: true,
        teleport: true,
      },
    },
  })
})
afterEach(() => {
  wrapper.unmount()
  vi.restoreAllMocks()
  expect(document.body.classList.contains('material-batches-printing')).toBe(false)
})
async function print() {
  await wrapper
    .findAll('button')
    .find((b) => b.text().includes('打印 2'))!
    .trigger('click')
  await flushPromises()
}
it('refreshes each selected batch before printing and cleans up print mode', async () => {
  vi.mocked(window.print).mockImplementation(() => {
    expect(document.body.classList.contains('material-batches-printing')).toBe(true)
    expect(
      wrapper
        .findAllComponents(MaterialBatchPrintSheet)[1]!
        .props('items')
        .every((row) => row.quantity === 7),
    ).toBe(true)
  })
  await print()
  expect(materialTransferApi.get).toHaveBeenCalledTimes(2)
  expect(window.print).toHaveBeenCalledOnce()
})
it('excludes internal rework allocations from batch previews and print counts', async () => {
  await wrapper.setProps({
    items: [...items, { ...items[0]!, batch_no: 'REWORK-1', entry_kind: 'rework_split' }],
  })
  expect(wrapper.getComponent(MaterialBatchPrintSheet).props('items')).toEqual(items)
  await print()
  expect(materialTransferApi.get).toHaveBeenCalledTimes(2)
  expect(window.print).toHaveBeenCalledOnce()
})
it('loads every lot of the selected warehouse document for preview and reprint', async () => {
  const document = items.map((item) => ({ ...item, warehouse_dispatch_id: 51 }))
  const load = vi.spyOn(materialTransferApi, 'warehouseDocument').mockResolvedValue(document)
  await wrapper.setProps({ items: [document[0]!] })
  await flushPromises()
  expect(wrapper.getComponent(MaterialBatchPrintSheet).props('items')).toEqual(document)
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes('打印 1 张转料单'))!
    .trigger('click')
  await flushPromises()
  expect(load.mock.calls).toEqual([[51], [51]])
  expect(window.print).toHaveBeenCalledOnce()
})
it('prints only the selected target group when an old submission contains independent transfers', async () => {
  const rows = dispatchFixture(3).items.map((row, index) => ({
    ...row,
    warehouse_dispatch_id: 51,
    warehouse_document_no: index < 2 ? 'KF-51-1' : 'KF-51-3',
  }))
  vi.spyOn(materialTransferApi, 'warehouseDocument').mockResolvedValue(rows)
  await wrapper.setProps({ items: [rows[1]!] })
  await flushPromises()
  expect(wrapper.getComponent(MaterialBatchPrintSheet).props('items')).toEqual(rows.slice(0, 2))
})
it('reports a missing warehouse lot instead of printing a partial selection', async () => {
  const rows = items.map((row) => ({ ...row, warehouse_dispatch_id: 51 }))
  vi.spyOn(materialTransferApi, 'warehouseDocument').mockResolvedValue(rows.slice(1))
  await wrapper.setProps({ items: rows })
  await flushPromises()
  expect(wrapper.text()).toContain('转料单已变化')
  expect(window.print).not.toHaveBeenCalled()
})
it('does not print stale or partial data when a batch reload fails', async () => {
  vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('批次读取失败'))
  await print()
  expect(window.print).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('批次读取失败')
})
it('suppresses an in-flight print after closing the preview', async () => {
  let finish!: (row: (typeof items)[number]) => void
  vi.mocked(materialTransferApi.get).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await print()
  await wrapper.setProps({ modelValue: false })
  finish(items[0]!)
  await flushPromises()
  expect(window.print).not.toHaveBeenCalled()
})

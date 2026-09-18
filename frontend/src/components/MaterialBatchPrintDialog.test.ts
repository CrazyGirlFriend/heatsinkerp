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
  vi.spyOn(materialTransferApi, 'get').mockImplementation(async code => ({ ...items.find(row => row.batch_no === code)!, quantity: 7 }))
  wrapper = mount(MaterialBatchPrintDialog, { props: { modelValue: true, items }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' }, MaterialBatchPrintSheet: true, teleport: true } } })
})
afterEach(() => { wrapper.unmount(); vi.restoreAllMocks(); expect(document.body.classList.contains('material-batches-printing')).toBe(false) })
async function print() { await wrapper.findAll('button').find(b => b.text().includes('打印 2'))!.trigger('click'); await flushPromises() }
it('refreshes each selected batch before printing and cleans up print mode', async () => {
  vi.mocked(window.print).mockImplementation(() => {
    expect(document.body.classList.contains('material-batches-printing')).toBe(true)
    expect(wrapper.findAllComponents(MaterialBatchPrintSheet)[1]!.props('items').every(row => row.quantity === 7)).toBe(true)
  })
  await print()
  expect(materialTransferApi.get).toHaveBeenCalledTimes(2)
  expect(window.print).toHaveBeenCalledOnce()
})
it('does not print stale or partial data when a batch reload fails', async () => {
  vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('批次读取失败'))
  await print()
  expect(window.print).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('批次读取失败')
})
it('suppresses an in-flight print after closing the preview', async () => {
  let finish!: (row: typeof items[number]) => void
  vi.mocked(materialTransferApi.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await print(); await wrapper.setProps({ modelValue: false }); finish(items[0]!); await flushPromises()
  expect(window.print).not.toHaveBeenCalled()
})

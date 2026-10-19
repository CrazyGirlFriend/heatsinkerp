// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElCheckboxGroup, ElRadioGroup } from 'element-plus'
import TableExportDialog from './TableExportDialog.vue'
import * as exports from '@/utils/tableExport'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
const source = () => ({
  title: '检验 · 库存明细',
  total: 101,
  fields: [
    { key: 'serial', label: '流水号' },
    { key: 'weight', label: '重量 (kg)' },
    { key: 'other', label: '规格', selected: false },
  ],
  load: vi.fn().mockResolvedValue([{ serial: '0001', weight: 3.2, other: '20×30' }]),
})
function render(data = source()) {
  wrapper = mount(TableExportDialog, { props: { source: data }, attachTo: document.body })
  return data
}
const button = (text: string) =>
  wrapper.findAllComponents({ name: 'ElButton' }).find((button) => button.text() === text)!
describe('export field picker', () => {
  it('shows the full filtered count, supports field choice and downloads only those fields', async () => {
    const create = vi.spyOn(exports, 'createExportWorkbook').mockResolvedValue(new Blob())
    const download = vi.spyOn(exports, 'downloadExportWorkbook').mockImplementation(() => undefined)
    const data = render()
    await flushPromises()
    expect(document.body.textContent).toContain('当前筛选 · 全部 101 条')
    expect(wrapper.getComponent(ElCheckboxGroup).props('modelValue')).toEqual(['serial', 'weight'])
    wrapper.getComponent(ElCheckboxGroup).vm.$emit('update:modelValue', ['serial'])
    await flushPromises()
    await button('导出 Excel').trigger('click')
    await flushPromises()
    expect(data.load).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(
      [expect.objectContaining({ key: 'serial' })],
      [{ serial: '0001', weight: 3.2, other: '20×30' }],
    )
    expect(download).toHaveBeenCalledWith(expect.any(Blob), '检验 · 库存明细')
    expect(wrapper.emitted('close')).toEqual([[]])
  })
  it('disables empty field selection, and leaves fetch errors visible for retry', async () => {
    const data = render()
    data.load.mockRejectedValue(new Error('无权访问'))
    await flushPromises()
    wrapper.getComponent(ElCheckboxGroup).vm.$emit('update:modelValue', [])
    await flushPromises()
    expect(button('导出 Excel').attributes('disabled')).toBeDefined()
    wrapper.getComponent(ElCheckboxGroup).vm.$emit('update:modelValue', ['serial'])
    await flushPromises()
    await button('导出 Excel').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('无权访问')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
  it('asks for a narrower filter before loading an oversized export', async () => {
    const data = render({ ...source(), total: 100_000_000 })
    await flushPromises()
    await button('导出 Excel').trigger('click')
    await flushPromises()
    expect(data.load).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('单次最多导出 10,000 条')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
  it('cancels an in-flight export and never downloads its late response', async () => {
    let finish!: (value: Record<string, string>[]) => void
    const data = source()
    data.load.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const create = vi.spyOn(exports, 'createExportWorkbook')
    render(data)
    await flushPromises()
    await button('导出 Excel').trigger('click')
    await flushPromises()
    const signal = data.load.mock.calls[0]![0] as AbortSignal
    await button('取消导出').trigger('click')
    await flushPromises()
    expect(signal.aborted).toBe(true)
    finish([{ serial: '0001' }])
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})

it('switches export content, resets fields and exports the selected worker summary', async () => {
  const create = vi.spyOn(exports, 'createExportWorkbook').mockResolvedValue(new Blob())
  const download = vi.spyOn(exports, 'downloadExportWorkbook').mockImplementation(() => undefined)
  const detail = source()
  const grouped = {
    title: '按加工人汇总',
    total: 2,
    fields: [
      { key: 'person', label: '加工人' },
      { key: 'quantity', label: '完成件数' },
    ],
    load: vi.fn().mockResolvedValue([
      { person: '张师傅', quantity: 100 },
      { person: '李师傅', quantity: 20 },
    ]),
  }
  wrapper = mount(TableExportDialog, {
    props: { source: detail, variants: [grouped] },
    attachTo: document.body,
  })
  await flushPromises()
  wrapper.getComponent(ElRadioGroup).vm.$emit('update:modelValue', 1)
  await flushPromises()
  expect(document.body.textContent).toContain('当前筛选 · 全部 2 条')
  expect(wrapper.getComponent(ElCheckboxGroup).props('modelValue')).toEqual(['person', 'quantity'])
  wrapper.getComponent(ElCheckboxGroup).vm.$emit('update:modelValue', ['quantity'])
  await button('导出 Excel').trigger('click')
  await flushPromises()
  expect(detail.load).not.toHaveBeenCalled()
  expect(grouped.load).toHaveBeenCalledOnce()
  expect(create).toHaveBeenCalledWith(
    [{ key: 'quantity', label: '完成件数' }],
    [
      { person: '张师傅', quantity: 100 },
      { person: '李师傅', quantity: 20 },
    ],
  )
  expect(download).toHaveBeenCalledWith(expect.any(Blob), '按加工人汇总')
})

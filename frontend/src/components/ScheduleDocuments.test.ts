// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElOption, ElSelect } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ScheduleDocuments from './ScheduleDocuments.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import type { ProcessRoute } from '@/types/processRoute'

let wrapper: VueWrapper
let route: ProcessRoute
beforeEach(() => {
  route = structuredClone(routeFixture)
  route.source_data.order_document = structuredClone(orderFixture)
  route.drawings = [{ id: 31, filename: '零件.pdf', size_bytes: 100 }]
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(route)
  vi.spyOn(processRouteApi, 'orderPreview').mockResolvedValue(new Blob(['pdf']))
  vi.spyOn(productionScheduleApi, 'orderPreview').mockResolvedValue(new Blob(['pdf']))
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:order-original')
      static revokeObjectURL = vi.fn()
    },
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function render(routeIds: (number | null)[] = [8, 8, null]) {
  wrapper = mount(ScheduleDocuments, {
    props: { serialNo: 'S-001', routeIds },
    slots: {
      default:
        '<table aria-label="排期内容"><tbody><tr><td>第1批 · 100件</td></tr></tbody></table>',
    },
    global: {
      stubs: {
        DocumentViewer: true,
        WordDocumentPreview: {
          name: 'WordDocumentPreview',
          props: { route: Object, thumbnail: Boolean },
          template: '<div>原稿预览</div>',
        },
        ProcessRouteDrawingPreview: {
          name: 'ProcessRouteDrawingPreview',
          props: { routeId: Number, drawing: Object, thumbnail: Boolean },
          template: '<div>图纸预览</div>',
        },
      },
    },
  })
}
async function click(label: string) {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
  await flushPromises()
}
it('preloads three document kinds beside the schedule with no duplicate serial-info entry', async () => {
  render()
  await flushPromises()
  expect(processRouteApi.detail).toHaveBeenCalledTimes(1)
  expect(processRouteApi.detail).toHaveBeenCalledWith(8)
  const layout = wrapper.get('.schedule-documents--layout')
  expect(layout.element.firstElementChild?.getAttribute('aria-label')).toBe('排期附件缩略图')
  expect(layout.element.lastElementChild?.getAttribute('class')).toBe('schedule-document-content')
  expect(wrapper.get('[aria-label="排期内容"]').text()).toContain('第1批 · 100件')
  expect(wrapper.findAll('.route-attachment-card')).toHaveLength(3)
  expect(wrapper.text()).not.toContain('流水号信息')
  expect(wrapper.find('[aria-label="排期资料分类"]').exists()).toBe(false)
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route')).toEqual(route)
  expect(wrapper.getComponent({ name: 'WordDocumentPreview' }).props('thumbnail')).toBe(true)
  expect(wrapper.getComponent({ name: 'ProcessRouteDrawingPreview' }).props()).toMatchObject({
    routeId: 8,
    drawing: route.drawings![0],
    thumbnail: true,
  })
})
it('previews the dispatch original layout and downloads its unchanged source file', async () => {
  const order = { ...orderFixture, filename: '调度提供.xlsx', serial_no: 'S-001' }
  const download = vi.spyOn(productionScheduleApi, 'downloadOrder').mockResolvedValue(undefined)
  const task = vi.spyOn(productionScheduleApi, 'task')
  render()
  await wrapper.setProps({ taskId: 42, orderDocument: order })
  await flushPromises()
  expect(task).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('调度提供.xlsx')
  expect(wrapper.text()).not.toContain(orderFixture.filename)
  await wrapper.get('button[aria-label="放大订单表"]').trigger('click')
  expect(productionScheduleApi.orderPreview).toHaveBeenCalledWith(42, expect.any(AbortSignal))
  expect(wrapper.getComponent(DocumentViewer).props('pdf')).toBe('blob:order-original')
  expect(wrapper.getComponent(DocumentViewer).props('html')).toBeUndefined()
  expect(wrapper.find('.route-order-thumbnail table').exists()).toBe(false)
  await click('下载原件')
  expect(download).toHaveBeenCalledWith(42, '调度提供.xlsx')
})
it('keeps distinct route versions selectable without changing the dispatch order', async () => {
  const second = { ...route, id: 9, title: '关联的返工工艺' }
  vi.mocked(processRouteApi.detail).mockImplementation(async (id) => (id === 8 ? route : second))
  render([8, 9, 8])
  await wrapper.setProps({ orderDocument: { ...orderFixture, filename: '调度订单.xlsx' } })
  await flushPromises()
  expect(processRouteApi.detail).toHaveBeenCalledTimes(2)
  expect(
    wrapper
      .getComponent(ElSelect)
      .findAllComponents(ElOption)
      .map((item) => item.props('label')),
  ).toEqual(['S-001', 'S-001'])
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 9)
  await flushPromises()
  expect(wrapper.getComponent({ name: 'WordDocumentPreview' }).props('route').id).toBe(9)
  expect(wrapper.text()).toContain('调度订单.xlsx')
})
it('shows missing associations and files without substituting another route', async () => {
  render([])
  await flushPromises()
  expect(wrapper.text()).toContain('未关联工艺')
  expect(processRouteApi.detail).not.toHaveBeenCalled()
  route.filename = ''
  route.drawings = []
  route.source_data.order_document = undefined
  await wrapper.setProps({ routeIds: [8] })
  await flushPromises()
  expect(wrapper.findAll('.route-attachment-card--missing')).toHaveLength(3)
  expect(wrapper.find('[aria-label="放大订单表"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="排期内容"]').exists()).toBe(true)
})
it('allows retrying a failed read without hiding schedule contents', async () => {
  vi.mocked(processRouteApi.detail).mockRejectedValueOnce(new Error('读取失败'))
  render()
  await flushPromises()
  expect(wrapper.text()).toContain('读取失败')
  expect(wrapper.find('[aria-label="排期内容"]').exists()).toBe(true)
  await click('重新加载')
  expect(wrapper.findComponent({ name: 'ProcessRouteDrawingPreview' }).exists()).toBe(true)
})
it('does not substitute a legacy engineering order when the task has no order', async () => {
  render()
  await wrapper.setProps({ orderDocument: null })
  await flushPromises()
  expect(wrapper.find('button[aria-label="放大订单表"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('未上传')
})
it('discards thumbnail requests for a previous serial', async () => {
  let finish!: (value: ProcessRoute) => void
  vi.mocked(processRouteApi.detail).mockImplementation((id) =>
    id === 8
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ ...route, id, title: '另一工艺' }),
  )
  render()
  await wrapper.setProps({ serialNo: 'S-002', routeIds: [9] })
  await flushPromises()
  finish(route)
  await flushPromises()
  expect(wrapper.getComponent({ name: 'WordDocumentPreview' }).props('route').id).toBe(9)
})
it('loads the saved dispatch order when editing from a list without document metadata', async () => {
  const task = vi
    .spyOn(productionScheduleApi, 'task')
    .mockResolvedValue({ order_document: { ...orderFixture, filename: '已保存.xlsx' } } as never)
  render()
  await wrapper.setProps({ taskId: 17 })
  await flushPromises()
  expect(task).toHaveBeenCalledWith(17)
  expect(wrapper.text()).toContain('已保存.xlsx')
})

it('keeps selected engineering files visible when only the order serial changes', async () => {
  render()
  await wrapper.setProps({ serialNo: '' })
  await flushPromises()
  vi.mocked(processRouteApi.detail).mockClear()
  await wrapper.setProps({ serialNo: 'ORDER-OTHER', routeIds: [route.id] })
  await flushPromises()
  expect(processRouteApi.detail).not.toHaveBeenCalled()
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(route.id)
})

it('shows animated thumbnail placeholders until the selected engineering files arrive', async () => {
  let finish!: (value: ProcessRoute) => void
  vi.mocked(processRouteApi.detail).mockReturnValueOnce(
    new Promise((resolve) => (finish = resolve)),
  )
  render()
  expect(wrapper.get('[aria-label="排期附件缩略图"]').attributes('aria-busy')).toBe('true')
  expect(wrapper.get('[role="status"]').text()).toBe('加载工艺资料…')
  expect(wrapper.findAll('.schedule-document-skeleton')).toHaveLength(2)
  finish(route)
  await flushPromises()
  expect(wrapper.get('[aria-label="排期附件缩略图"]').attributes('aria-busy')).toBe('false')
  expect(wrapper.findAll('.schedule-document-skeleton')).toHaveLength(0)
  expect(wrapper.getComponent(ProcessRouteAttachments).props('route').id).toBe(route.id)
})

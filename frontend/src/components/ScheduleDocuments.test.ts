// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSelect, ElTabs } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ScheduleDocuments from './ScheduleDocuments.vue'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import type { ProcessRoute } from '@/types/processRoute'

let wrapper: VueWrapper
let route: ProcessRoute
beforeEach(() => {
  route = structuredClone(routeFixture)
  route.engineering_employee_name = '张工'
  route.source_data.order_document = structuredClone(orderFixture)
  route.source_data.receipt_fields = {
    serial_no: { label: '流水号', value: 'S-001', source_row: '1:1', source_label: '流水号' },
    material: { label: '材质', value: 'Mo70Cu30', source_row: '1:1', source_label: '材质' },
  }
  route.drawings = [
    { id: 31, filename: '零件.pdf', size_bytes: 100 },
    { id: 32, filename: '装配.pdf', size_bytes: 100 },
  ]
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(route)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
function render(routeIds: (number | null)[] = [8, 8, null]) {
  wrapper = mount(ScheduleDocuments, {
    props: { serialNo: 'S-001', routeIds },
    global: {
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
        ProcessRouteSteps: true,
        DocumentViewer: true,
        WordDocumentPreview: {
          name: 'WordDocumentPreview',
          props: ['route'],
          template: '<div>原稿预览</div>',
        },
        ProcessRouteDrawingPreview: {
          name: 'ProcessRouteDrawingPreview',
          props: ['routeId', 'drawing'],
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
it('loads only the bound process version on demand and shows its serial fields', async () => {
  render()
  expect(processRouteApi.detail).not.toHaveBeenCalled()
  await click('流水号信息')
  expect(processRouteApi.detail).toHaveBeenCalledTimes(1)
  expect(processRouteApi.detail).toHaveBeenCalledWith(8)
  expect(wrapper.text()).toContain('Mo70Cu30')
  expect(wrapper.text()).toContain('张工')
  expect(wrapper.findComponent({ name: 'ProcessRouteSteps' }).props('route')).toEqual(route)
})
it('opens the original document and drawings for the same bound route', async () => {
  render()
  await click('工艺原件')
  expect(wrapper.getComponent(ElTabs).props('modelValue')).toBe('word')
  expect(wrapper.findComponent({ name: 'WordDocumentPreview' }).props('route')).toEqual(route)
  await click('关闭')
  await click('图纸')
  const preview = wrapper.findComponent({ name: 'ProcessRouteDrawingPreview' })
  expect(preview.props()).toMatchObject({ routeId: 8, drawing: route.drawings![0] })
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 32)
  await flushPromises()
  expect(preview.props('drawing')).toEqual(route.drawings![1])
  expect(wrapper.text()).not.toContain('上传')
  await click('关闭')
  const download = vi.spyOn(processRouteApi, 'downloadOrder').mockResolvedValue(undefined)
  await click('订单表')
  expect(wrapper.getComponent(ElTabs).props('modelValue')).toBe('order')
  expect(wrapper.text()).toContain(orderFixture.filename)
  expect(wrapper.findAll('.route-order-thumbnail tr')).toHaveLength(orderFixture.headers.length)
  await wrapper.get('button[aria-label="放大订单表"]').trigger('click')
  expect(wrapper.getComponent(DocumentViewer).props('html')).toContain(orderFixture.filename)
  await click('下载原件')
  expect(download).toHaveBeenCalledWith(route)
})
it('keeps distinct route versions selectable when a task has more than one', async () => {
  const second = { ...route, id: 9, title: '关联的返工工艺' }
  vi.mocked(processRouteApi.detail).mockImplementation(async (id) => (id === 8 ? route : second))
  render([8, 9, 8])
  await click('工艺原件')
  expect(processRouteApi.detail).toHaveBeenCalledTimes(2)
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 9)
  await flushPromises()
  expect(wrapper.findComponent({ name: 'WordDocumentPreview' }).props('route').id).toBe(9)
})
it('shows missing associations and files without substituting another route', async () => {
  render([])
  await click('工艺原件')
  expect(wrapper.text()).toContain('未关联工艺')
  expect(processRouteApi.detail).not.toHaveBeenCalled()
  await wrapper.setProps({ routeIds: [8] })
  route.filename = ''
  route.drawings = []
  route.source_data.order_document = undefined
  await click('工艺原件')
  expect(wrapper.text()).toContain('暂无工艺原件')
  await click('关闭')
  await click('图纸')
  expect(wrapper.text()).toContain('暂无图纸')
  await click('关闭')
  await click('订单表')
  expect(wrapper.text()).toContain('未上传')
  expect(wrapper.find('[aria-label="放大订单表"]').exists()).toBe(false)
})
it('allows retrying a failed read', async () => {
  vi.mocked(processRouteApi.detail).mockRejectedValueOnce(new Error('读取失败'))
  render()
  await click('图纸')
  expect(wrapper.text()).toContain('读取失败')
  await click('重新加载')
  expect(wrapper.findComponent({ name: 'ProcessRouteDrawingPreview' }).exists()).toBe(true)
})

it('preloads left thumbnails and uses the dispatch order instead of the legacy engineering order', async () => {
  render()
  const order = { ...orderFixture, filename: '调度提供.xlsx', serial_no: 'S-001' }
  const { productionScheduleApi } = await import('@/services/productionScheduleApi')
  const download = vi.spyOn(productionScheduleApi, 'downloadOrder').mockResolvedValue(undefined)
  await wrapper.setProps({ thumbnails: true, taskId: 42, orderDocument: order, routeIds: [8] })
  await flushPromises()
  expect(wrapper.find('[aria-label="排期附件缩略图"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('调度提供.xlsx')
  expect(wrapper.text()).not.toContain(orderFixture.filename)
  await wrapper.get('button[aria-label="放大订单表"]').trigger('click')
  expect(wrapper.getComponent(DocumentViewer).props('html')).toContain('调度提供.xlsx')
  await click('下载原件')
  expect(download).toHaveBeenCalledWith(42, '调度提供.xlsx')
  await wrapper.setProps({ orderDocument: null })
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
  await wrapper.setProps({ thumbnails: true, routeIds: [8] })
  await wrapper.setProps({ serialNo: 'S-002', routeIds: [9] })
  await flushPromises()
  finish(route)
  await flushPromises()
  expect(wrapper.findComponent({ name: 'WordDocumentPreview' }).props('route').id).toBe(9)
})

it('loads the saved dispatch order when editing from a list without document metadata', async () => {
  const { productionScheduleApi } = await import('@/services/productionScheduleApi')
  const task = vi
    .spyOn(productionScheduleApi, 'task')
    .mockResolvedValue({ order_document: { ...orderFixture, filename: '已保存.xlsx' } } as never)
  render()
  await wrapper.setProps({ thumbnails: true, taskId: 17 })
  await flushPromises()
  expect(task).toHaveBeenCalledWith(17)
  expect(wrapper.text()).toContain('已保存.xlsx')
})

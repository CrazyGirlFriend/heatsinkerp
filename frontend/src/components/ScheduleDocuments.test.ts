// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSelect, ElTabs } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ScheduleDocuments from './ScheduleDocuments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
import type { ProcessRoute } from '@/types/processRoute'

let wrapper: VueWrapper
let route: ProcessRoute
beforeEach(() => {
  route = structuredClone(routeFixture)
  route.engineering_employee_name = '张工'
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
  await click('工艺原件')
  expect(wrapper.text()).toContain('暂无工艺原件')
  await click('关闭')
  await click('图纸')
  expect(wrapper.text()).toContain('暂无图纸')
})
it('allows retrying a failed read', async () => {
  vi.mocked(processRouteApi.detail).mockRejectedValueOnce(new Error('读取失败'))
  render()
  await click('图纸')
  expect(wrapper.text()).toContain('读取失败')
  await click('重新加载')
  expect(wrapper.findComponent({ name: 'ProcessRouteDrawingPreview' }).exists()).toBe(true)
})

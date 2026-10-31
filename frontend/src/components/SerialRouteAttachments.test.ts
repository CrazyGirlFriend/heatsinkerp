// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElSelect } from 'element-plus'
import SerialRouteAttachments from './SerialRouteAttachments.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
let wrapper: VueWrapper
const stubs = { ProcessRouteAttachments: true }
beforeEach(() => {
  vi.spyOn(processRouteApi, 'dispatchOrder').mockResolvedValue(null)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
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

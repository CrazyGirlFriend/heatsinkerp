// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElSelect } from 'element-plus'
import SerialRouteAttachments from './SerialRouteAttachments.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
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

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FactoryShippingAnalysis from './FactoryShippingAnalysis.vue'
import { factoryDashboardApi as api } from '@/services/factoryDashboardApi'
import type { PageResult, SerialChoice, Shipments } from '@/types/factoryDashboard'

let wrapper: VueWrapper
const serial = (name: string): SerialChoice => ({ serial_no: name, created_at: '2026-09-20' })
const result = (items: SerialChoice[]): PageResult<SerialChoice> => ({
  items,
  total: items.length,
  page: 1,
  page_size: 50,
})
const chart = (name: string): Shipments => ({
  dates: ['2026-09-26'],
  series: [{ ...serial(name), values: [25] }],
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(api, 'serials').mockResolvedValue(result([serial('A'), serial('B')]))
  vi.spyOn(api, 'shipments').mockResolvedValue(chart('A'))
  wrapper = mount(FactoryShippingAnalysis, {
    props: { initialSelection: [serial('A')], today: '2026-09-26' },
    global: { stubs: { teleport: true, FactoryShipmentChart: true } },
  })
})
afterEach(() => {
  wrapper.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('loads real serials without material controls or a redundant detail table and unlocks scrolling on close', async () => {
  await flushPromises()
  expect(api.shipments).toHaveBeenCalledWith(['A'], '2026-09-20', '2026-09-26')
  expect(wrapper.find('select').exists()).toBe(false)
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('材质')
  expect(document.body.style.overflow).toBe('hidden')
  wrapper.unmount()
  expect(document.body.style.overflow).toBe('')
})
it('keeps the newer chart when an older request finishes last', async () => {
  await flushPromises()
  let stale!: (data: Shipments) => void
  vi.mocked(api.shipments).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        stale = resolve
      }),
  )
  await wrapper.findAll('input[type=checkbox]')[1]!.setValue(true)
  await wrapper.findAll('input[type=checkbox]')[0]!.setValue(false)
  vi.mocked(api.shipments).mockResolvedValue(chart('B'))
  await flushPromises()
  stale(chart('STALE'))
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'FactoryShipmentChart' }).props('data').series[0].serial_no,
  ).not.toBe('STALE')
})
it('ignores a stale search response after the search phrase changes', async () => {
  await flushPromises()
  let stale!: (data: PageResult<SerialChoice>) => void
  vi.mocked(api.serials).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        stale = resolve
      }),
  )
  await wrapper.get('input[type=search]').setValue('old')
  await vi.advanceTimersByTimeAsync(250)
  vi.mocked(api.serials).mockResolvedValue(result([serial('NEW')]))
  await wrapper.get('input[type=search]').setValue('new')
  await vi.advanceTimersByTimeAsync(250)
  stale(result([serial('OLD')]))
  await flushPromises()
  expect(wrapper.find('.analysis-serial-list').text()).toContain('NEW')
  expect(wrapper.find('.analysis-serial-list').text()).not.toContain('OLD')
})

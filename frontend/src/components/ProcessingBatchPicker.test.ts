// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ProcessingBatchPicker from './ProcessingBatchPicker.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { StockBatch } from '@/types/teamMaterials'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
it('identifies rework stock and only allows it to be selected after engineering publishes', async () => {
  const source = (id: number, ready: boolean) =>
    ({
      transfer: {
        id,
        serial_no: '691236-50',
        batch_no: `TL${id}`,
        material_type: 'semi_finished',
        rework_route_id: id,
        rework_pending: !ready,
        rework_route_ready: ready,
      },
      on_hand_quantity: 20,
      on_hand_weight: 2,
    }) as StockBatch
  vi.spyOn(teamMaterialApi, 'processingSources').mockResolvedValue({
    items: [source(1, false), source(2, true)],
    total: 2,
    page: 1,
    page_size: 10,
  })
  wrapper = mount(ProcessingBatchPicker, {
    props: { teamId: 2 },
    global: { stubs: { AppDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('返工工艺 · 未填写')
  expect(wrapper.text()).toContain('返工工艺 · 已制定')
  const buttons = wrapper.findAll('button').filter((b) => b.text() === '选择')
  expect(buttons[0]!.attributes('disabled')).toBeDefined()
  expect(buttons[1]!.attributes('disabled')).toBeUndefined()
  await buttons[1]!.trigger('click')
  expect(wrapper.emitted('selected')).toEqual([[2]])
})

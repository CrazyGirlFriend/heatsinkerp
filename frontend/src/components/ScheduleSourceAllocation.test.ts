// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScheduleSourceAllocation from './ScheduleSourceAllocation.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
let wrapper: VueWrapper
const option = {
  source_transfer_id: 8,
  batch_no: 'TL-008',
  serial_no: 'S-1',
  material_name: 'W80',
  material_type: 'raw',
  quantity: 1,
  weight: 10,
  on_hand_quantity: 1,
  on_hand_weight: 10,
  received_at: null,
}
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(ScheduleSourceAllocation, {
    props: { modelValue: [], teamId: 2, serialNo: 'S-1', targetQuantity: 100, targetWeight: 10 },
    global: {
      directives: { loading: () => {} },
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '关联批次')!
    .trigger('click')
  await flushPromises()
}
describe('shared schedule source allocation', () => {
  it('allocates the node output target even when one source piece becomes many', async () => {
    vi.spyOn(productionScheduleApi, 'sources').mockResolvedValue({
      items: [option],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render()
    expect(productionScheduleApi.sources).toHaveBeenCalledWith(
      expect.objectContaining({ team_id: 2, serial_no: 'S-1' }),
    )
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '关联')!
      .trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
      { source_transfer_id: 8, batch_no: 'TL-008', quantity: 100, weight: 10 },
    ])
  })
  it('discards late source results after the node team changes', async () => {
    let finish!: (value: Awaited<ReturnType<typeof productionScheduleApi.sources>>) => void
    vi.spyOn(productionScheduleApi, 'sources').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await render()
    await wrapper.setProps({ teamId: 3 })
    finish({ items: [option], total: 1, page: 1, page_size: 10 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('TL-008')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

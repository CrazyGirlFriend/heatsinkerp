// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import InventoryScheduleDetails from './InventoryScheduleDetails.vue'
import { inventoryScheduleFixture, scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())

describe('inventory schedule expansion', () => {
  it('identifies the task and completion basis without treating reference weight as an outstanding delivery', async () => {
    wrapper = mount(InventoryScheduleDetails, {
      props: {
        serialNo: '000128',
        summary: inventoryScheduleFixture({
          items: [
            scheduleSummaryFixture({
              task_title: '第一批交货',
              completion_basis: 'quantity',
              execution_state: 'completed',
              status: 'completed',
              remaining_quantity: 0,
              remaining_weight: 4.875,
            }),
          ],
        }),
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('第一批交货')
    expect(wrapper.text()).toContain('按件数')
    expect(wrapper.text()).toContain('按时完成')
    expect(wrapper.text()).not.toContain('4.875')
  })
  it('shows distinct order and source identities for shared material and preserves completion status', async () => {
    wrapper = mount(InventoryScheduleDetails, {
      props: {
        serialNo: '共投料',
        summary: inventoryScheduleFixture({
          count: 2,
          status: 'completed_late',
          items: [
            scheduleSummaryFixture({ status: 'completed_late' }),
            scheduleSummaryFixture({
              id: 82,
              serial_no: '000129',
              target_weight: null,
              status: 'completed',
              sources: [{ source_transfer_id: 12, batch_no: 'TL12', quantity: 10, weight: null }],
            }),
          ],
        }),
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('000128')
    expect(wrapper.text()).toContain('000129')
    expect(wrapper.text()).toContain('TL11')
    expect(wrapper.text()).toContain('TL12')
    expect(wrapper.text()).toContain('按时完成')
    expect(wrapper.text()).toContain('逾期完成')
    expect(wrapper.findAll('thead th').every((cell) => cell.classes().includes('is-center'))).toBe(
      true,
    )
  })

  it('clearly identifies bounded results and opens the full schedule list on request', async () => {
    wrapper = mount(InventoryScheduleDetails, {
      props: {
        serialNo: '000128',
        summary: inventoryScheduleFixture({
          count: 101,
          items_truncated: true,
          items: [scheduleSummaryFixture()],
        }),
      },
    })
    expect(wrapper.text()).toContain('101项排期')
    expect(wrapper.text()).toContain('仅展示前1项')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看完整排期')!
      .trigger('click')
    expect(wrapper.emitted('viewAll')).toEqual([[]])
  })

  it('shows actual inherited batches before direct bindings and identifies unfulfilled predecessor links', async () => {
    wrapper = mount(InventoryScheduleDetails, {
      props: {
        serialNo: '000128',
        summary: inventoryScheduleFixture({
          count: 3,
          items: [
            scheduleSummaryFixture({
              predecessor_id: 80,
              linked_batches: [
                {
                  source_transfer_id: 12,
                  batch_no: 'TL12',
                  material_name: 'W80',
                  quantity: 100,
                  weight: 10,
                  received_at: null,
                  status: 'pending',
                },
              ],
            }),
            scheduleSummaryFixture({ id: 82, predecessor_id: 80, sources: [] }),
            scheduleSummaryFixture({ id: 83, sources: [] }),
          ],
        }),
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('TL12')
    expect(wrapper.text()).not.toContain('TL11')
    expect(wrapper.text()).toContain('衔接上序')
    expect(wrapper.text()).toContain('待关联')
  })
})

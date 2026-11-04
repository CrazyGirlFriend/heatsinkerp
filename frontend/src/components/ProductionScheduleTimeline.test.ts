// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductionScheduleTimeline from './ProductionScheduleTimeline.vue'
import ScheduleTimelineBar from './ScheduleTimelineBar.vue'
import type { ProductionSchedule, ScheduleTask, ScheduleBatch } from '@/types/productionSchedule'
const node = (id: number, extra: Partial<ProductionSchedule> = {}) =>
  ({
    id,
    team_id: id,
    team_name: '研磨',
    serial_no: 'S-100',
    sequence_no: id,
    planning_state: 'pending',
    status: 'pending',
    target_quantity: 100,
    dispatched_quantity: 0,
    dispatched_weight: 0,
    due_at: '2026-11-04T16:00:00+08:00',
    ...extra,
  }) as ProductionSchedule
const batch = (id: number, extra: Partial<ScheduleBatch> = {}) =>
  ({
    id,
    batch_number: id,
    target_quantity: 40,
    planned_start_at: '2026-11-01T08:00:00+08:00',
    due_at: '2026-11-04T16:00:00+08:00',
    upstream_batch_ids: [],
    dispatched_quantity: 0,
    dispatched_weight: 0,
    status: 'pending',
    ...extra,
  }) as ScheduleBatch
const task = (id = 1, nodes = [node(1), node(2)]) =>
  ({ id, serial_no: 'S-100', final_due_at: '2026-11-08T00:00:00+08:00', nodes }) as ScheduleTask
let wrapper: VueWrapper
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-03T10:00:00+08:00'))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function render(tasks = [task()]) {
  wrapper = mount(ProductionScheduleTimeline, {
    props: { tasks },
    global: { stubs: { ScheduleDateRange: true } },
  })
}
describe('embedded production schedule timeline', () => {
  it('preserves repeated team visits and opens the correct existing node from a pending plan', async () => {
    render()
    expect(wrapper.findAll('.step-row')).toHaveLength(2)
    expect(wrapper.findAll('.batch-bar')).toHaveLength(0)
    await wrapper.findAll('.step-row .pending-plan')[1]!.trigger('click')
    expect(wrapper.emitted('open-node')?.[0]?.[0]).toMatchObject({ id: 2 })
    await wrapper.get('.serial-link').trigger('click')
    expect(wrapper.emitted('open-task')?.[0]?.[0]).toMatchObject({ id: 1 })
  })
  it('opens the parent schedule rather than a synthetic negative batch ID', async () => {
    const parent = node(9, { planning_state: 'confirmed', batches: [batch(51), batch(52)] })
    render([task(1, [parent])])
    await wrapper.findAll('.step-row .batch-bar')[1]!.trigger('click')
    expect(wrapper.emitted('open-node')?.[0]?.[0]).toEqual(parent)
    expect(wrapper.get('.board-footer').text()).not.toContain('第 52 批')
  })
  it('keeps batch details at the bar and does not dim other material or draw dependency links', async () => {
    render([
      task(1, [
        node(1, { batches: [batch(11), batch(12)] }),
        node(2, { batches: [batch(21, { upstream_batch_ids: [11] })] }),
      ]),
    ])
    const bars = wrapper.findAllComponents(ScheduleTimelineBar)
    expect(bars).toHaveLength(3)
    expect(bars[0]!.props('bar').node.batch_number).toBe(11)
    await wrapper.findAll('.step-row .batch-bar')[0]!.trigger('click')
    expect(wrapper.find('.batch-bar.dimmed').exists()).toBe(false)
    expect(wrapper.find('.flow-links').exists()).toBe(false)
    expect(wrapper.emitted('open-node')?.[0]?.[0]).toMatchObject({ id: 1 })
  })
  it('keeps same-serial orders separate and supports collapse and empty/loading states', async () => {
    render([task(1), task(2)])
    expect(wrapper.findAll('.order-group')).toHaveLength(2)
    await wrapper.get('[aria-label="收起全部班组"]').trigger('click')
    expect(wrapper.findAll('.step-row')).toHaveLength(0)
    await wrapper.get('[aria-label="展开全部班组"]').trigger('click')
    expect(wrapper.findAll('.step-row')).toHaveLength(4)
    await wrapper.get('[aria-label="收起全部班组"]').trigger('click')
    expect(wrapper.findAll('.step-row')).toHaveLength(0)
    await wrapper.setProps({ tasks: [], loading: true })
    expect(wrapper.get('[role="status"]').text()).toBe('正在读取排期…')
    await wrapper.setProps({ loading: false })
    expect(wrapper.text()).toContain('暂无排期')
  })
})

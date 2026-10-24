// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProductionScheduleOverview from './ProductionScheduleOverview.vue'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'

function node(overrides: Partial<ProductionSchedule> = {}): ProductionSchedule {
  return {
    ...scheduleSummaryFixture(),
    sequence_no: 1,
    notes: null,
    version: 1,
    cancelled_at: null,
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}
function task(id: number, nodes: ProductionSchedule[], serial = '805881-5'): ScheduleTask {
  return {
    id,
    task_no: `PQ${id}`,
    title: `第${id}批交货`,
    serial_no: serial,
    notes: null,
    version: 1,
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    final_due_at: nodes.at(-1)?.due_at || '',
    status: 'pending',
    nodes,
  }
}
let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())
async function render(tasks: ScheduleTask[]) {
  wrapper = mount(ProductionScheduleOverview, {
    props: {
      tasks,
    },
    global: { directives: { loading: () => {} } },
  })
  await flushPromises()
}
describe('global production schedule progress', () => {
  it('keeps same-serial delivery tasks separate and expands their full route inline', async () => {
    const tasks = [task(1, [node()]), task(2, [node()]), task(3, [node()], '628349-16')]
    await render(tasks)
    expect(wrapper.findAll('.sp-row')).toHaveLength(3)
    await wrapper.get('.sp-task-button').trigger('click')
    expect(wrapper.get('.sp-detail').text()).toContain('第1批交货')
    expect(wrapper.emitted('open-task')).toBeUndefined()
    await wrapper.findAll('.sp-detail-actions button')[0]!.trigger('click')
    expect(wrapper.emitted('open-task')?.[0]).toEqual([tasks[0]])
  })
  it('preserves repeated team visits and locates deadlines outside the current week', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-23T10:00:00+08:00'))
    const first = node({ id: 1, due_at: '2026-10-24T08:00:00+08:00' })
    const rework = node({ id: 2, sequence_no: 3, due_at: '2026-12-26T14:00:00+08:00' })
    const historical = node({
      id: 3,
      team_id: 99,
      team_name: '原检验组',
      due_at: '2026-10-24T12:00:00+08:00',
    })
    await render([task(1, [first, rework, historical])])
    expect(wrapper.findAll('.sp-node')).toHaveLength(2)
    expect(wrapper.text()).toContain('1 个节点在本周外')
    await wrapper.get('.sp-outside button').trigger('click')
    expect(wrapper.get('.sp-node').attributes('aria-label')).toContain('2026-12-26 14:00')
    await wrapper.get('.sp-node').trigger('click')
    expect(wrapper.findAll('.sp-detail tbody tr')).toHaveLength(3)
    const row = wrapper.get('.sp-selected')
    expect(row.text()).toContain('12-26 14:00')
    await row.get('button').trigger('click')
    expect(wrapper.emitted('open-node')?.[0]).toEqual([rework])
    vi.restoreAllMocks()
  })
  it('shows simultaneous on-hand and pending quantities without adding production across stages', async () => {
    const item = task(1, [
      node({ target_quantity: 1 }),
      node({ id: 2, team_name: '轧制', target_quantity: 100 }),
    ])
    item.locations = [
      {
        team_id: 1,
        team_name: '库房',
        quantity: 1,
        weight: 10,
        pending_quantity: 0,
        pending_weight: 0,
        batch_count: 1,
        quality_held: false,
      },
      {
        team_id: 2,
        team_name: '轧制',
        quantity: 40,
        weight: 4,
        pending_quantity: 60,
        pending_weight: 6,
        batch_count: 3,
        quality_held: false,
      },
    ]
    await render([item])
    expect(wrapper.get('.sp-target').text()).toBe('100 件')
    expect(wrapper.findAll('.sp-location')).toHaveLength(3)
    expect(wrapper.get('.sp-location.is-transit').text()).toContain('待签收')
    expect(wrapper.get('.sp-where').text()).toContain('不跨工序合计')
    expect(wrapper.text()).not.toContain('101 件')
  })
  it('shows quality holds, cancellation and the warehouse exemption', async () => {
    await render([
      task(1, [node({ quality_held: true })]),
      { ...task(2, [node({ status: 'cancelled' })]), status: 'cancelled' },
      {
        ...task(3, [node({ status: 'not_assessed', assessment_enabled: false })]),
        status: 'not_assessed',
      },
    ])
    expect(wrapper.text()).toContain('质量暂扣')
    expect(wrapper.text()).toContain('已取消')
    expect(wrapper.text()).toContain('库房不考核交货完成量')
  })
})

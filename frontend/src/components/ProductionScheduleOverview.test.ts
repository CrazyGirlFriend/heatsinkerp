// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElPopover } from 'element-plus'
import ProductionScheduleOverview from './ProductionScheduleOverview.vue'
import ProductionScheduleGantt from './ProductionScheduleGantt.vue'
import AppDialog from './AppDialog.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'
import ScheduleStockSummary from './ScheduleStockSummary.vue'
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
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(tasks: ScheduleTask[]) {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-27T10:00:00+08:00'))
  wrapper = mount(ProductionScheduleOverview, {
    props: {
      tasks,
    },
    global: {
      directives: { loading: () => {} },
      stubs: {
        ProductionScheduleGantt: true,
        ScheduleDateRange: true,
        AppDialog: {
          props: ['modelValue', 'title'],
          template:
            '<div v-if="modelValue" role="dialog" :aria-label="title"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await flushPromises()
}
describe('global production schedule progress', () => {
  it('keeps only serial, quantity and timeline on the board; exact task details open by serial', async () => {
    const tasks = [task(1, [node()]), { ...task(2, [node()]), business_person_name: '张经理' }]
    await render(tasks)
    expect(wrapper.findAll('.sp-row')).toHaveLength(2)
    expect(wrapper.findAll('.sp-table-head > span').map((cell) => cell.text())).toEqual([
      '流水号',
      '数量',
    ])
    for (const row of wrapper.findAll('.sp-row')) {
      expect(row.findAll('.sp-row-main > div')).toHaveLength(3)
      expect(row.get('.sp-target').text()).toBe('100 件')
      expect(row.text()).not.toContain('第1批交货')
      expect(row.text()).not.toContain('张经理')
    }
    expect(wrapper.findComponent(ProductionScheduleGantt).exists()).toBe(false)
    await wrapper.findAll('.sp-serial-button')[1]!.trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toContain('流水号详情')
    expect(wrapper.get('.sp-detail-fields').text()).toContain('第2批交货')
    expect(wrapper.get('.sp-detail-fields').text()).toContain('张经理')
    expect(wrapper.get('.sp-detail-fields').text()).toContain('最终交期')
    expect(wrapper.get('.sp-detail-fields').text()).toContain('交货状态')
    expect(wrapper.get('.sp-detail-fields').text()).toContain('物料所在班组')
    expect(wrapper.getComponent(ProductionScheduleGantt).props('tasks')).toEqual([tasks[1]])
    await wrapper.get('.sp-task-details').trigger('click')
    expect(wrapper.emitted('open-task')?.[0]).toEqual([tasks[1]])
    wrapper.getComponent(AppDialog).vm.$emit('close')
    await flushPromises()
    await wrapper.get('.sp-serial-button').trigger('click')
    expect(wrapper.getComponent(ProductionScheduleGantt).props('tasks')).toEqual([tasks[0]])
    expect(wrapper.find('.sp-row .sp-detail').exists()).toBe(false)
  })
  it('shows all repeated and simultaneous operations and opens each exact node without a collapsed cluster', async () => {
    const first = node({ id: 1, team_name: '退火', due_at: '2026-10-27T10:00:00+08:00' })
    const second = node({
      id: 2,
      team_name: '研磨',
      sequence_no: 2,
      predecessor_id: 1,
      due_at: first.due_at,
    })
    const again = node({
      id: 3,
      team_name: '退火',
      sequence_no: 3,
      predecessor_id: 2,
      due_at: first.due_at,
    })
    await render([task(1, [first, second, again])])
    const markers = wrapper.findAll('.sp-node')
    expect(markers).toHaveLength(3)
    expect(wrapper.find('.sp-cluster-label').exists()).toBe(false)
    expect(markers.map((marker) => marker.get('.sp-team-name').text())).toEqual([
      '退火',
      '研磨',
      '退火',
    ])
    expect(new Set(markers.map((marker) => (marker.element as HTMLElement).style.top)).size).toBe(3)
    expect(wrapper.findAll('.sp-links > path')).toHaveLength(2)
    for (const [index, marker] of markers.entries()) {
      await marker.trigger('click')
      expect(wrapper.emitted('open-node')?.[index]).toEqual([[first, second, again][index]])
    }
    expect((markers[0]!.element as HTMLElement).style.getPropertyValue('--team-color')).toBe(
      (markers[2]!.element as HTMLElement).style.getPropertyValue('--team-color'),
    )
  })
  it('keeps partial processing and dispatch separate for each operation including one-to-many output', async () => {
    await render([
      task(1, [
        node({ id: 1, team_name: '库房', target_quantity: 1, assessment_enabled: false }),
        node({
          id: 2,
          team_name: '线切割',
          target_quantity: 100,
          processed_quantity: 60,
          dispatched_quantity: 40,
        }),
        node({
          id: 3,
          team_name: '研磨',
          target_quantity: 100,
          processed_quantity: 10,
          dispatched_quantity: 0,
        }),
      ]),
    ])
    expect(wrapper.get('.sp-target').text()).toBe('100 件')
    const nodes = wrapper.findAll('.sp-node')
    expect(nodes[0]!.find('.sp-stage-progress').exists()).toBe(false)
    expect(nodes[1]!.text()).not.toContain('60%')
    expect(nodes[1]!.attributes('aria-label')).toContain('已加工 60 件')
    expect(nodes[1]!.attributes('aria-label')).toContain('40 / 100 件')
    expect(nodes[2]!.attributes('aria-label')).toContain('已加工 10 件')
    expect(nodes[2]!.attributes('aria-label')).toContain('0 / 100 件')
    await nodes[1]!.trigger('focus')
    await vi.waitFor(() => {
      const tooltip = document.querySelector('.schedule-node-tooltip')
      expect(tooltip?.textContent).toContain('60 件 60%')
      expect(tooltip?.textContent).toContain('40 件 40%')
    })
  })
  it('highlights only the selected operation and its immediate route neighbours for mouse and keyboard', async () => {
    const due_at = '2026-10-27T10:00:00+08:00'
    await render([
      task(1, [
        node({ id: 1, team_name: '退火', due_at }),
        node({ id: 2, team_name: '研磨', sequence_no: 2, predecessor_id: 1, due_at }),
        node({ id: 3, team_name: '退火', sequence_no: 3, predecessor_id: 2, due_at }),
        node({ id: 4, team_name: '检验', sequence_no: 4, predecessor_id: 3, due_at }),
      ]),
      task(2, [node({ id: 5, due_at })]),
    ])
    const markers = wrapper.findAll('.sp-node')
    await markers[1]!.trigger('mouseenter')
    expect(markers.map((m) => m.classes().includes('is-related'))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
    expect(wrapper.findAll('.sp-links > path.is-related')).toHaveLength(2)
    await markers[1]!.trigger('mouseleave')
    expect(wrapper.findAll('.sp-node.is-related')).toHaveLength(0)
    await markers[2]!.trigger('focus')
    expect(markers.map((m) => m.classes().includes('is-related'))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
    await markers[2]!.trigger('blur')
    expect(wrapper.findAll('.sp-node.is-related')).toHaveLength(0)
  })
  it('keeps interval labels compact and exposes exact batch dates and all linked neighbours', async () => {
    const schedules = [
      node({
        id: 1,
        team_name: '库房',
        planned_start_at: '2026-10-26T08:00:00+08:00',
        due_at: '2026-10-27T09:00:00+08:00',
      }),
      node({
        id: 2,
        team_name: '库房',
        planned_start_at: '2026-10-26T12:00:00+08:00',
        due_at: '2026-10-27T10:00:00+08:00',
      }),
      node({
        id: 3,
        team_name: '轧制',
        batch_number: 1,
        upstream_timeline_ids: [1, 2],
        planned_start_at: '2026-10-27T11:00:00+08:00',
        due_at: '2026-10-29T12:00:00+08:00',
      }),
    ]
    await render([task(1, schedules)])
    const markers = wrapper.findAll('.sp-node')
    const rolling = markers[2]!
    expect(rolling.text()).toContain('轧制 · 1 批')
    expect(rolling.text()).not.toContain('10-27')
    expect(rolling.attributes('aria-label')).toContain('开始 2026-10-27 11:00')
    expect(rolling.attributes('aria-label')).toContain('第 1 批')
    await rolling.trigger('focus')
    expect(wrapper.findAll('.sp-node.is-related')).toHaveLength(3)
    expect(wrapper.findAll('.sp-links > path.is-related')).toHaveLength(2)
    await vi.waitFor(() => {
      const tooltip = [...document.querySelectorAll('.schedule-node-tooltip')].find((e) =>
        e.textContent?.includes('2026-10-29 12:00'),
      )
      expect(tooltip?.textContent).toContain('2026-10-27 11:00')
    })
    // Tooltips must not consume native button activation on Enter or Space.
    for (const code of ['Enter', 'Space']) {
      const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })
      rolling.element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    await rolling.trigger('click')
    expect(wrapper.emitted('open-node')?.[0]).toEqual([schedules[2]])
  })
  it('preserves exact custom dates and zoom while locating a future task from its details', async () => {
    const future = task(1, [node({ due_at: '2026-12-26T14:00:00+08:00' })])
    await render([future])
    expect(wrapper.findAll('.sp-node')).toHaveLength(0)
    await wrapper.get('.sp-serial-button').trigger('click')
    await wrapper.get('.sp-locate').trigger('click')
    expect(wrapper.findComponent(ProductionScheduleGantt).exists()).toBe(false)
    expect(wrapper.get('.sp-node').attributes('aria-label')).toContain('2026-12-26 14:00')
    const picker = wrapper.getComponent(ScheduleDateRange)
    picker.vm.$emit('update:modelValue', ['2026-12-26', '2026-12-26'])
    await flushPromises()
    expect(wrapper.findAll('.sp-day')).toHaveLength(1)
    const range = picker.props('modelValue')
    const initialWidth = parseFloat(
      (wrapper.element as HTMLElement).style.getPropertyValue('--timeline-width'),
    )
    Object.defineProperty(wrapper.get('.sp-scroll').element, 'scrollTo', { value: vi.fn() })
    await wrapper.get('[aria-label="放大时间轴"]').trigger('click')
    expect(picker.props('modelValue')).toEqual(range)
    expect(
      parseFloat((wrapper.element as HTMLElement).style.getPropertyValue('--timeline-width')),
    ).toBe(initialWidth * 2)
    expect(wrapper.get('.sp-hour-day').text()).toBe('0003060912151821')
    await wrapper.get('[aria-label="下一时间段"]').trigger('click')
    expect(picker.props('modelValue')).toEqual(['2026-12-27', '2026-12-27'])
    await wrapper.get('[aria-label="上一时间段"]').trigger('click')
    expect(picker.props('modelValue')).toEqual(['2026-12-26', '2026-12-26'])
  })
  it('keeps current stock and pending receipts in details without summing quantities across operations', async () => {
    const item = task(1, [node({ target_quantity: 1 }), node({ id: 2, target_quantity: 100 })])
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
    expect(wrapper.findComponent(ScheduleStockSummary).exists()).toBe(false)
    await wrapper.get('.sp-serial-button').trigger('click')
    const summary = wrapper.get('.sp-detail-stock')
    expect(summary.findAll('.stock-team').map((badge) => badge.text())).toEqual(['库房', '轧制'])
    await summary.get('button').trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('.stock-distribution table')).not.toBeNull(),
    )
    const table = document.querySelector('.stock-distribution table')!
    expect(
      [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim()),
      ),
    ).toEqual([
      ['库房', '1', '10', '0', '0'],
      ['轧制', '40', '4', '60', '6'],
    ])
    const popover = summary.getComponent(ScheduleStockSummary).getComponent(ElPopover)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await flushPromises()
    expect(popover.props('visible')).toBe(false)
  })
  it('locates an offscreen operation without replacing the selected date range', async () => {
    await render([
      task(1, [node({ id: 1, due_at: '2026-10-20T10:00:00+08:00' })]),
      task(2, [node({ id: 2, due_at: '2026-10-27T10:00:00+08:00' })]),
    ])
    const picker = wrapper.getComponent(ScheduleDateRange)
    const selected = picker.props('modelValue')
    expect(wrapper.get('.sp-edge.is-after').text()).toBe('1')
    await wrapper.get('.sp-edge.is-after').trigger('click')
    await flushPromises()
    expect(picker.props('modelValue')).toEqual(selected)
    const scroll = wrapper.get('.sp-scroll')
    expect(scroll.element.scrollLeft).toBeGreaterThan(0)
    await scroll.trigger('scroll')
    expect(wrapper.get('.sp-edge.is-before').text()).toBe('1')
    expect(wrapper.find('.sp-edge.is-after').exists()).toBe(false)
  })
  it('retains hold, cancelled and warehouse states in the serial details', async () => {
    await render([
      task(1, [node({ quality_held: true })]),
      { ...task(2, [node({ status: 'cancelled' })]), status: 'cancelled' },
      {
        ...task(3, [node({ status: 'not_assessed', assessment_enabled: false })]),
        status: 'not_assessed',
      },
    ])
    for (const [index, status] of ['质量暂扣', '已取消', '库房备料'].entries()) {
      await wrapper.findAll('.sp-serial-button')[index]!.trigger('click')
      expect(wrapper.get('.sp-risk').text()).toBe(status)
      expect(wrapper.getComponent(ProductionScheduleGantt).props('tasks')[0].id).toBe(index + 1)
    }
  })
})

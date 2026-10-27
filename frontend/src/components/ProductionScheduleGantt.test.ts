// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductionScheduleGantt from './ProductionScheduleGantt.vue'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'

const node = (overrides: Partial<ProductionSchedule> = {}): ProductionSchedule => ({
  id: 1,
  task_id: 11,
  serial_no: '805881-5',
  team_id: 2,
  team_name: '轧制',
  next_team_id: 3,
  next_team_name: '研磨',
  external_destination: null,
  due_at: '2026-10-22T08:00:00Z',
  sequence_no: 1,
  predecessor_id: null,
  completion_basis: 'quantity',
  target_quantity: 100,
  target_weight: 10,
  notes: null,
  version: 1,
  status: 'pending',
  cancelled_at: null,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
  completed_at: null,
  dispatched_quantity: 40,
  dispatched_weight: 4,
  received_quantity: 30,
  received_weight: 3,
  remaining_quantity: 60,
  remaining_weight: 6,
  sources: [],
  ...overrides,
})
const task = (overrides: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id: 11,
  task_no: 'JH20261022001',
  title: '第一批交货',
  serial_no: '805881-5',
  notes: null,
  version: 1,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
  final_due_at: '2026-10-22T08:00:00Z',
  status: 'pending',
  nodes: [node()],
  ...overrides,
})
let wrapper: VueWrapper
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-10-22T06:00:00Z'))
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('production schedule milestone gantt', () => {
  it('keeps repeated-team same-hour milestones independent and opens the exact task/node', async () => {
    const first = node()
    const second = node({ id: 2, sequence_no: 2, predecessor_id: 1, status: 'today' })
    const data = task({ nodes: [first, second] })
    wrapper = mount(ProductionScheduleGantt, { props: { tasks: [data] } })
    await flushPromises()
    expect(wrapper.findAll('.gantt-node-row')).toHaveLength(2)
    expect(wrapper.findAll('.gantt-planned')).toHaveLength(2)
    expect(wrapper.findAll('.gantt-dependencies > path')).toHaveLength(1)
    expect(wrapper.find('.gantt-dependencies > path').attributes('marker-end')).toMatch(
      /^url\(#.+\)$/,
    )
    expect(wrapper.findAll('.gantt-actual')).toHaveLength(0)
    await wrapper.findAll('.gantt-planned')[1]!.trigger('click')
    expect(wrapper.emitted('open-node')).toEqual([[second]])
    expect(wrapper.find('.gantt-task-heading').exists()).toBe(false)
  })

  it('labels quantity/weight/both completion bases without treating reference measures as blockers', async () => {
    wrapper = mount(ProductionScheduleGantt, {
      props: {
        tasks: [
          task({
            nodes: [
              node({
                status: 'completed',
                dispatched_quantity: 100,
                dispatched_weight: 8,
                completed_at: '2026-10-22T07:00:00Z',
              }),
              node({ id: 2, completion_basis: 'weight', execution_state: 'pending_receipt' }),
              node({ id: 3, completion_basis: 'both', quality_held: true }),
            ],
          }),
        ],
      },
    })
    await flushPromises()
    const labels = wrapper
      .findAll('.gantt-planned')
      .map((button) => button.attributes('aria-label'))
    expect(labels[0]).toContain('按时完成')
    expect(labels[0]).toContain('已交 100 / 目标 100 件')
    expect(labels[0]).toContain('参考重量：已交 8 / 目标 10 kg')
    expect(labels[1]).toContain('参考件数：')
    expect(labels[1]).toContain('待签收')
    expect(labels[2]).toContain('计量方式：件数和重量')
    expect(labels[2]).not.toContain('参考')
    expect(labels[2]).toContain('质量暂扣')
    expect(wrapper.find('.gantt-actual').attributes('aria-label')).toContain(
      '实际交完 2026-10-22 15:00',
    )
  })

  it('describes ready material without repeating delivery status and separates simultaneous actual/planned markers', async () => {
    wrapper = mount(ProductionScheduleGantt, {
      props: {
        tasks: [
          task({
            nodes: [
              node({ execution_state: 'ready' }),
              node({
                id: 2,
                sequence_no: 2,
                completed_at: '2026-10-22T08:00:00Z',
                status: 'completed',
              }),
            ],
          }),
        ],
      },
    })
    await flushPromises()
    expect(wrapper.find('.gantt-node-subtitle').text()).toBe('待交货 · 物料已到位')
    const second = wrapper.findAll('.gantt-node-row')[1]!
    const planned = second.find('.gantt-planned')
    const actual = second.find('.gantt-actual')
    expect(planned.attributes('style')).toBe(actual.attributes('style'))
    expect(planned.attributes('aria-label')).toContain('计划节点')
    expect(actual.attributes('aria-label')).toContain('真实交完')
    expect(actual.classes()).not.toContain('gantt-planned')
  })

  it('bounds distant dates and lets users locate each out-of-window node or task', async () => {
    const distant = task({
      id: 12,
      task_no: 'JH20990001',
      nodes: [node({ id: 5, due_at: '2099-01-01T00:00:00Z' })],
    })
    wrapper = mount(ProductionScheduleGantt, { props: { tasks: [task(), distant] } })
    await flushPromises()
    expect(wrapper.findAll('.gantt-day')).toHaveLength(14)
    expect(wrapper.findAll('.gantt-planned.is-outside')).toHaveLength(1)
    await wrapper.findAll('.gantt-task-open')[1]!.trigger('click')
    expect(wrapper.emitted('open-task')).toEqual([[distant]])
    expect(wrapper.find('.gantt-task-serial strong').text()).toBe('805881-5')
    expect(wrapper.find('.gantt-task-due time').text()).toBe('2026-10-22 16:00')
    await wrapper.find('.gantt-planned.is-outside').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.gantt-day')).toHaveLength(14)
    expect(wrapper.findAll('.gantt-planned')[1]!.classes()).not.toContain('is-outside')
    expect(wrapper.emitted('open-node')).toBeUndefined()
    await wrapper.findAll('.gantt-task-locate')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.gantt-planned')[0]!.classes()).not.toContain('is-outside')
    expect(wrapper.findAll('.gantt-planned')[1]!.classes()).toContain('is-outside')
  })

  it('changes hour scale, pans finite windows and returns to today', async () => {
    wrapper = mount(ProductionScheduleGantt, { props: { tasks: [task()] } })
    await flushPromises()
    await wrapper.findAll('.gantt-scale button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.gantt-day')).toHaveLength(3)
    expect(wrapper.findAll('.gantt-hours')).toHaveLength(3)
    expect(wrapper.findAll('.gantt-scale button')[0]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.gantt-scale button').map((button) => button.text())).toEqual([
      '小时',
      '日期',
    ])
    await wrapper.find('[aria-label="后一时间段"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.gantt-now-cap').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '定位今天')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('.gantt-now-cap').exists()).toBe(true)
  })

  it('highlights only real adjacent links from pointer or keyboard focus and keeps focus within the same row', async () => {
    wrapper = mount(ProductionScheduleGantt, {
      props: {
        tasks: [
          task({
            nodes: [
              node(),
              node({ id: 2, sequence_no: 2, predecessor_id: 1 }),
              node({ id: 3, sequence_no: 3 }),
            ],
          }),
        ],
      },
    })
    await flushPromises()
    const rows = wrapper.findAll('.gantt-node-row')
    await rows[2]!.trigger('mouseenter')
    expect(rows[2]!.classes()).toContain('is-active')
    expect(wrapper.findAll('.gantt-dependencies > path.is-highlighted')).toHaveLength(0)
    await rows[2]!.trigger('mouseleave')
    await rows[0]!.trigger('mouseenter')
    expect(wrapper.findAll('.gantt-dependencies > path.is-highlighted')).toHaveLength(1)
    await rows[0]!.trigger('mouseleave')
    await rows[1]!.trigger('focusin')
    expect(rows[1]!.classes()).toContain('is-active')
    expect(wrapper.findAll('.gantt-dependencies > path.is-highlighted')).toHaveLength(1)
    await rows[1]!.trigger('focusout', { relatedTarget: rows[1]!.find('.gantt-planned').element })
    expect(rows[1]!.classes()).toContain('is-active')
    await rows[1]!.trigger('focusout', { relatedTarget: document.body })
    expect(rows[1]!.classes()).not.toContain('is-active')
    expect(wrapper.findAll('.gantt-dependencies > path.is-highlighted')).toHaveLength(0)
  })

  it('keeps scroll directions accurate at both ends and after viewport/content resizing, with observer cleanup', async () => {
    let resize: () => void = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    wrapper = mount(ProductionScheduleGantt, { props: { tasks: [task()] } })
    await flushPromises()
    const region = wrapper.find('.gantt-viewport')
    const element = region.element as HTMLElement
    const size = { clientWidth: 786, scrollWidth: 1952, clientHeight: 320, scrollHeight: 624 }
    for (const name of Object.keys(size) as (keyof typeof size)[])
      Object.defineProperty(element, name, { configurable: true, get: () => size[name] })
    element.scrollLeft = 0
    element.scrollTop = 0
    resize()
    await flushPromises()
    expect(observe).toHaveBeenCalledWith(element)
    expect(observe).toHaveBeenCalledWith(wrapper.find('.gantt-canvas').element)
    expect(wrapper.find('.gantt-scroll-hints').text()).toBe('后面还有日期 →下方还有节点 ↓')

    element.scrollLeft = 280
    element.scrollTop = 80
    await region.trigger('scroll')
    expect(wrapper.find('.gantt-scroll-hints').text()).toBe('← 更多日期 →↑ 更多节点 ↓')
    element.scrollLeft = size.scrollWidth - size.clientWidth
    element.scrollTop = size.scrollHeight - size.clientHeight
    await region.trigger('scroll')
    expect(wrapper.find('.gantt-scroll-hints').text()).toBe('← 前面还有日期↑ 上方还有节点')

    size.clientWidth = size.scrollWidth
    size.scrollHeight = size.clientHeight
    resize()
    await flushPromises()
    expect(wrapper.find('.gantt-scroll-hints').exists()).toBe(false)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('shows cancelled nodes and empty tasks without inventing actual completion', async () => {
    wrapper = mount(ProductionScheduleGantt, {
      props: {
        tasks: [
          task({ nodes: [node({ status: 'cancelled' })] }),
          task({ id: 12, task_no: 'JH002', nodes: [] }),
        ],
      },
    })
    await flushPromises()
    expect(wrapper.find('.gantt-node-row.is-cancelled').exists()).toBe(true)
    expect(wrapper.findAll('.gantt-actual')).toHaveLength(0)
    expect(wrapper.text()).toContain('尚未设置交货节点')
    expect(wrapper.findAll('.gantt-task-locate')).toHaveLength(1)
    await wrapper.setProps({ tasks: [] })
    expect(wrapper.text()).toContain('暂无交货任务')
    await wrapper.setProps({ loading: true })
    expect(wrapper.text()).toContain('正在读取交货排期')
  })

  it('updates the now marker while visible and clears its timer on unmount', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    wrapper = mount(ProductionScheduleGantt, { props: { tasks: [task()] } })
    await flushPromises()
    const original = wrapper.find('.gantt-canvas').attributes('style')
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    const updated = wrapper.find('.gantt-canvas').attributes('style')
    expect(updated).not.toBe(original)
    hidden.mockReturnValue(true)
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(wrapper.find('.gantt-canvas').attributes('style')).toBe(updated)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScheduleTask } from '@/types/productionSchedule'
import VTableScheduleTimeline from './VTableScheduleTimeline.vue'
import ScheduleBatchSummary from './ScheduleBatchSummary.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'

const native = vi.hoisted(() => ({ instances: [] as any[], disconnect: vi.fn() }))
vi.mock('@visactor/vtable-gantt', () => ({
  TYPES: { TasksShowMode: { Project_Sub_Tasks_Inline: 'project_sub_tasks_inline' } },
  VRender: {},
  Gantt: class {
    options: any
    handlers = new Map()
    scrollLeft = 0
    scrollTop = 0
    eventManager = { _eventHandler: { reseizeListeners: {} } }
    taskListTableInstance = { on: vi.fn(), getRecordByCell: vi.fn() }
    scenegraph = {
      release: vi.fn(),
      updateNextFrame: vi.fn(),
      taskBar: { removeSelectedBorder: vi.fn() },
    }
    release = vi.fn()
    updateOption = vi.fn((options) => {
      this.options = options
      this.scrollLeft = 0
      this.scrollTop = 0
    })
    on(name: string, handler: unknown) {
      this.handlers.set(name, handler)
    }
    constructor(_host: unknown, options: unknown) {
      this.options = options
      native.instances.push(this)
    }
  },
}))
vi.mock('@/composables/useChartPalette', () => ({ useChartPalette: () => ({ value: undefined }) }))
const task = {
  id: 7,
  task_no: 'PQ00000007',
  title: '试制',
  notes: null,
  version: 1,
  status: 'overdue',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  serial_no: '691236-51',
  final_due_at: '2026-11-04T09:00:00Z',
  nodes: [
    {
      id: 11,
      sequence_no: 2,
      team_name: '线切割',
      target_quantity: 80,
      planning_state: 'confirmed',
      status: 'overdue',
      batches: [
        {
          id: 33,
          batch_number: 1,
          planned_start_at: '2026-11-02T00:00:00Z',
          due_at: '2026-11-02T08:00:00Z',
          target_quantity: 80,
          upstream_batch_ids: [],
          dispatched_quantity: 60,
          received_quantity: 40,
          status: 'overdue',
        },
      ],
    },
  ],
} as unknown as ScheduleTask

afterEach(() => {
  vi.unstubAllGlobals()
  native.instances.length = 0
  vi.clearAllMocks()
})
it('fits the selected period to the viewport, resets zoom, and adapts date labels on resize', async () => {
  let resize: () => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback()
    return 1
  })
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [task] },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  await flushPromises()
  const instance = native.instances[0]!
  const canvas = wrapper.get('.gantt-canvas').element
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 1400 })
  const selectRange = async (start: string, end: string) => {
    wrapper.findComponent(ScheduleDateRange).vm.$emit('update:modelValue', [start, end])
    await flushPromises()
  }
  const timelineWidth = (days: number) => instance.options.timelineHeader.colWidth * 24 * days
  await selectRange('2026-11-02', '2026-11-08')
  expect(timelineWidth(7)).toBeCloseTo(1096)
  expect(instance.options.timelineHeader.scales[1].unit).toBe('day')
  expect(instance.options.minDate).toBe('2026-11-02T00:00:00.000')
  expect(instance.options.maxDate).toBe('2026-11-08T23:59:59.999')
  await wrapper.get('[aria-label="放大时间轴"]').trigger('click')
  expect(timelineWidth(7)).toBeCloseTo(1370)
  instance.scrollLeft = 80
  await selectRange('2026-11-02', '2027-01-24')
  expect(timelineWidth(84)).toBeCloseTo(1096)
  expect(instance.options.timelineHeader.scales[1].unit).toBe('week')
  expect(instance.scrollLeft).toBe(0)
  expect(wrapper.get('.gantt-zoom span').text()).toBe('100%')
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 776 })
  resize()
  expect(timelineWidth(84)).toBeCloseTo(472)
  expect(instance.options.timelineHeader.scales[1].unit).toBe('month')
  await selectRange('2028-02-01', '2028-02-29')
  expect(timelineWidth(29)).toBeCloseTo(472)
  await selectRange('2028-02-29', '2028-02-29')
  expect(timelineWidth(1)).toBeCloseTo(472)
  expect(instance.options.timelineHeader.scales[1].unit).toBe('day')
  wrapper.unmount()
})
it('transitions deliberate period changes without queuing motion or animating live refreshes', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const motion = { matches: false }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => motion),
  )
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [task] },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  await flushPromises()
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = []
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn() }
    animations.push(animation)
    return animation
  })
  Object.defineProperty(wrapper.get('.gantt-canvas').element, 'animate', { value: animate })
  wrapper
    .findComponent(ScheduleDateRange)
    .vm.$emit('update:modelValue', ['2026-11-02', '2026-11-08'])
  await flushPromises()
  expect(animate).toHaveBeenCalledTimes(1)
  await wrapper.get('[aria-label="放大时间轴"]').trigger('click')
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animations[0]!.cancel).toHaveBeenCalled()
  await wrapper.setProps({ tasks: [{ ...task, version: 2 }] })
  await flushPromises()
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animations[1]!.cancel).toHaveBeenCalled()
  motion.matches = true
  await wrapper.get('[aria-label="缩小时间轴"]').trigger('click')
  expect(animate).toHaveBeenCalledTimes(2)
  motion.matches = false
  await wrapper.get('[aria-label="放大时间轴"]').trigger('click')
  expect(animate).toHaveBeenCalledTimes(3)
  wrapper.unmount()
  expect(animations[2]!.cancel).toHaveBeenCalled()
})
it('shows one team bar in the overview and the saved batch quantities and dates in its hover card', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const wrapper = mount(VTableScheduleTimeline, {
    props: {
      tasks: [
        {
          ...task,
          nodes: [
            {
              ...task.nodes[0]!,
              dispatched_quantity: 60,
              batches: [
                { ...task.nodes[0]!.batches![0]!, target_quantity: 60 },
                {
                  ...task.nodes[0]!.batches![0]!,
                  id: 34,
                  batch_number: 2,
                  target_quantity: 20,
                  dispatched_quantity: 0,
                  planned_start_at: '2026-11-03T00:00:00Z',
                  due_at: '2026-11-03T08:00:00Z',
                },
              ],
            },
          ],
        },
      ],
    },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  await flushPromises()
  const instance = native.instances[0]!
  const serial = instance.options.records[0]
  const team = serial.children[0]
  expect(serial.hierarchyState).toBe('collapse')
  expect(team).toMatchObject({ type: 'task', progress: 75 })
  instance.handlers.get('mouseenter_task_bar')({
    record: team,
    federatedEvent: { clientX: 200, clientY: 300 },
  })
  await flushPromises()
  const rows = wrapper.findAll('.detail-batches tbody tr')
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row.findAll('td').map((cell) => cell.text()))).toEqual([
    ['1', '60', '11-02 08:00', '11-02 16:00'],
    ['2', '20', '11-03 08:00', '11-03 16:00'],
  ])
  wrapper.unmount()
})
it('pins batch details on click, opens the real schedule from details, and releases the native canvas', async () => {
  let resize: () => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect = native.disconnect
    },
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback()
    return 1
  })
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [task] },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  await flushPromises()
  const instance = native.instances[0]!
  expect(instance.options.taskBar).toMatchObject({
    moveable: false,
    resizable: false,
    scheduleCreatable: false,
    selectable: true,
    progressField: 'progress',
    progressAdjustable: false,
  })
  const batch = instance.options.records[0].children[0].children[0]
  expect(batch.progress).toBe(75)
  instance.handlers.get('click_task_bar')({
    record: batch,
    federatedEvent: { clientX: 200, clientY: 300 },
  })
  await flushPromises()
  expect(wrapper.emitted('open-node')).toBeUndefined()
  expect(wrapper.findComponent(ScheduleBatchSummary).props('node').batch_number).toBe(1)
  expect(wrapper.find('[aria-label="取消选中批次"]').exists()).toBe(true)
  wrapper.findComponent(ScheduleBatchSummary).vm.$emit('open')
  expect(wrapper.emitted('open-node')?.[0]?.[0]).toMatchObject({
    id: 11,
    batch_number: 1,
    dispatched_quantity: 60,
    received_quantity: 40,
  })
  instance.scrollLeft = 120
  instance.scrollTop = 56
  await wrapper.setProps({
    tasks: [
      {
        ...task,
        nodes: task.nodes.map((node) => ({
          ...node,
          batches: node.batches?.map((batch) => ({ ...batch, dispatched_quantity: 40 })),
        })),
      },
    ],
  })
  await flushPromises()
  expect(instance.options.records[0].children[0].children[0].progress).toBe(50)
  expect(instance.scrollLeft).toBe(120)
  expect(instance.scrollTop).toBe(56)
  expect(instance.taskListTableInstance.on).toHaveBeenCalledTimes(2)
  const canvas = wrapper.get('.gantt-canvas').element
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 })
  resize()
  instance.updateOption.mockClear()
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 400 })
  resize()
  expect(instance.updateOption).toHaveBeenCalledTimes(1)
  expect(instance.scrollTop).toBe(56)
  const afterRelease = vi.fn()
  const resizeCallback: { cb?: () => void } = { cb: afterRelease }
  const tableResizeCallback: { cb?: () => void } = { cb: afterRelease }
  instance.eventManager._eventHandler.reseizeListeners = { gantt: resizeCallback }
  instance.taskListTableInstance.internalProps = {
    handler: { reseizeListeners: { table: tableResizeCallback } },
  }
  setTimeout(() => {
    resizeCallback.cb?.()
    tableResizeCallback.cb?.()
  }, 0)
  instance.scenegraph.scrollbarComponent = {
    _clearHorizontalScrollBar: setTimeout(afterRelease, 0),
    _clearVerticalScrollBar: setTimeout(afterRelease, 0),
  }
  wrapper.unmount()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(afterRelease).not.toHaveBeenCalled()
  expect(instance.scenegraph.release).toHaveBeenCalledTimes(1)
  expect(instance.release).toHaveBeenCalledTimes(1)
  expect(native.disconnect).toHaveBeenCalledTimes(1)
})

it('highlights only explicitly linked supplies and destinations, and clears selection with Escape', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const linkedTask = {
    ...task,
    nodes: [
      {
        ...task.nodes[0]!,
        id: 10,
        sequence_no: 1,
        team_name: '库房',
        batches: [
          { ...task.nodes[0]!.batches![0]!, id: 31 },
          { ...task.nodes[0]!.batches![0]!, id: 32, batch_number: 2 },
        ],
      },
      {
        ...task.nodes[0]!,
        batches: [{ ...task.nodes[0]!.batches![0]!, upstream_batch_ids: [32] }],
      },
    ],
  }
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [linkedTask] },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  await flushPromises()
  const instance = native.instances[0]!
  const teams = instance.options.records[0].children
  const upstream = teams[0].children
  const batch = teams[1].children[0]
  const bars = [...upstream, batch, { ...batch, task: { ...task, id: 999 } }].map((record) => ({
    record,
    setAttribute: vi.fn(),
  }))
  instance.scenegraph.taskBar.barContainer = {
    forEachChildren: (callback: (bar: unknown) => void) => bars.forEach(callback),
  }
  const event = { record: batch, federatedEvent: { clientX: 200, clientY: 300 } }
  instance.handlers.get('mouseenter_task_bar')(event)
  await flushPromises()
  expect(bars.map((bar) => bar.setAttribute.mock.lastCall)).toEqual([
    ['baseOpacity', 0.25],
    ['baseOpacity', 1],
    ['baseOpacity', 1],
    ['baseOpacity', 0.25],
  ])
  expect(
    wrapper.findComponent(ScheduleBatchSummary).props('relations')!.upstream[0]!.batch_number,
  ).toBe(2)
  expect(wrapper.findComponent(ScheduleBatchSummary).text()).toContain('库房 · 第2批')
  instance.handlers.get('click_task_bar')(event)
  instance.handlers.get('mouseenter_task_bar')({ ...event, record: upstream[0] })
  await flushPromises()
  expect(wrapper.findComponent(ScheduleBatchSummary).props('node').id).toBe(-33)
  // Element Plus reports the canvas click as outside its virtual trigger.
  // It must not close the details immediately after that same click pins them.
  wrapper.findComponent({ name: 'AppPopover' }).vm.$emit('update:visible', false)
  await flushPromises()
  expect(wrapper.findComponent({ name: 'AppPopover' }).attributes('visible')).toBe('true')
  await wrapper.setProps({ tasks: [{ ...linkedTask }] })
  await flushPromises()
  expect(wrapper.find('[aria-label="取消选中批次"]').exists()).toBe(true)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(bars.every((bar) => bar.setAttribute.mock.lastCall?.[1] === 1)).toBe(true)
  expect(wrapper.findComponent({ name: 'AppPopover' }).attributes('visible')).toBe('false')
  wrapper.unmount()
})

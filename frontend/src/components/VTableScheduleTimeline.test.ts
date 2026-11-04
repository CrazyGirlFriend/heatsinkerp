// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScheduleTask } from '@/types/productionSchedule'
import VTableScheduleTimeline from './VTableScheduleTimeline.vue'

const native = vi.hoisted(() => ({ instances: [] as any[], disconnect: vi.fn() }))
vi.mock('@visactor/vtable-gantt', () => ({
  TYPES: { TasksShowMode: { Project_Sub_Tasks_Inline: 'project_sub_tasks_inline' } },
  VRender: {},
  Gantt: class {
    options: any
    handlers = new Map()
    scrollLeft = 0
    scrollTop = 0
    taskListTableInstance = { on: vi.fn(), getRecordByCell: vi.fn() }
    scenegraph = { release: vi.fn(), taskBar: {} }
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
it('opens the existing schedule using its real id and releases the native canvas on unmount', async () => {
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
    global: { stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true } },
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
  instance.handlers.get('click_task_bar')({ record: batch })
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
  wrapper.unmount()
  expect(instance.scenegraph.release).toHaveBeenCalledTimes(1)
  expect(instance.release).toHaveBeenCalledTimes(1)
  expect(native.disconnect).toHaveBeenCalledTimes(1)
})

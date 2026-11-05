// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScheduleTask } from '@/types/productionSchedule'
import VTableScheduleTimeline from './VTableScheduleTimeline.vue'
import ScheduleBatchSummary from './ScheduleBatchSummary.vue'
import ScheduleDateRange from './ScheduleDateRange.vue'

const native = vi.hoisted(() => ({ instances: [] as any[], disconnect: vi.fn() }))
const graphics = vi.hoisted(() => {
  class Graphic {
    children: Graphic[] = []
    handlers = new Map<string, () => void>()
    constructor(public attribute: any) {}
    addEventListener(name: string, handler: () => void) {
      this.handlers.set(name, handler)
    }
    add(child: Graphic) {
      this.children.push(child)
    }
    setAttributes(attributes: any) {
      Object.assign(this.attribute, attributes)
    }
    AABBBounds = {
      width: () =>
        [...String(this.attribute.text || '')].reduce(
          (width, char) => width + this.attribute.fontSize * (char.charCodeAt(0) > 255 ? 1 : 0.6),
          0,
        ),
    }
  }
  return { Group: Graphic, Text: Graphic, Rect: Graphic, Circle: Graphic, Image: Graphic }
})
vi.mock('@visactor/vtable-gantt', () => ({
  TYPES: { TasksShowMode: { Project_Sub_Tasks_Inline: 'project_sub_tasks_inline' } },
  VRender: graphics,
  Gantt: class {
    options: any
    handlers = new Map()
    private left = 0
    get scrollLeft() {
      return this.left
    }
    set scrollLeft(value: number) {
      this.left = Math.ceil(value)
    }
    scrollTop = 0
    gridHeight = 400
    getAllTaskBarsHeight() {
      return this.options.records.length * 32
    }
    millisecondsPerPixel = 720000
    parsedOptions = {
      zoom: { minMillisecondsPerPixel: 30000, maxMillisecondsPerPixel: 17280000 },
    }
    zoomScaleManager = {
      config: { levels: [] as any[][] },
      updateZoomLimits: vi.fn(),
      getGlobalMinMillisecondsPerPixel: () => 30000,
      getGlobalMaxMillisecondsPerPixel: () => 17280000,
      findOptimalLevel: (value: number) =>
        value > 10080000 ? 0 : value > 1440000 ? 1 : value > 360000 ? 2 : value > 60000 ? 3 : 4,
      switchToLevel: (level: number) => {
        this.options.timelineHeader.scales = this.options.timelineHeader.zoomScale.levels[level]
      },
      updateDataZoomResponsive: vi.fn(),
      getDataZoomIntegration: () => undefined,
    }
    updateDateRange(minDate: string, maxDate: string) {
      this.options.minDate = minDate
      this.options.maxDate = maxDate
    }
    getCurrentMillisecondsPerPixel() {
      return this.millisecondsPerPixel
    }
    setMillisecondsPerPixel(value: number) {
      this.millisecondsPerPixel = value
      this.handlers.get('zoom')?.({ newMillisecondsPerPixel: value })
    }
    zoomByFactor = vi.fn((factor: number) =>
      this.setMillisecondsPerPixel(this.millisecondsPerPixel / factor),
    )
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
      this.zoomScaleManager.config.levels = this.options.timelineHeader.zoomScale.levels
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

beforeEach(() => {
  // Motion restores window scroll after measuring an auto-height reveal.
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  native.instances.length = 0
  vi.clearAllMocks()
})
it('mounts bars around the viewport and preserves the selected period when appending rows', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback()
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const tasks = Array.from({ length: 500 }, (_, index) => ({ ...task, id: index + 1 }))
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks },
    global: { stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true } },
  })
  try {
    await flushPromises()
    const instance = native.instances[0]!
    expect(instance.options.records).toHaveLength(500)
    expect(instance.options.records.filter((row: any) => row.children.length).length).toBeLessThan(
      50,
    )
    expect(instance.options.records[499].children).toEqual([])
    instance.scrollTop = 15600
    instance.handlers.get('scroll')({ scrollDirection: 'vertical' })
    expect(instance.options.records[499].children.length).toBeGreaterThan(0)
    expect(instance.options.records[0].children).toEqual([])
    expect(instance.scrollTop).toBe(15600)
    wrapper
      .getComponent(ScheduleDateRange)
      .vm.$emit('update:modelValue', ['2026-11-01', '2026-11-30'])
    await flushPromises()
    instance.scrollTop = 100
    await wrapper.setProps({ tasks: [...tasks, { ...task, id: 501 }] })
    await flushPromises()
    expect(instance.options.minDate).toContain('2026-11-01')
    expect(instance.options.maxDate).toContain('2026-11-30')
    expect(instance.scrollTop).toBe(100)
  } finally {
    wrapper.unmount()
  }
})
it('requests continuation near the bottom and pauses while loading or after a failure', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback()
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [task], hasMore: true, loading: true },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  try {
    await flushPromises()
    expect(wrapper.emitted('load-more')).toBeUndefined()
    await wrapper.setProps({ loading: false })
    expect(wrapper.emitted('load-more')).toHaveLength(1)
    await wrapper.setProps({ loadingMore: true })
    native.instances[0]!.handlers.get('scroll')({ scrollDirection: 'vertical' })
    expect(wrapper.emitted('load-more')).toHaveLength(1)
    await wrapper.setProps({ loadingMore: false, loadError: '连接中断' })
    native.instances[0]!.handlers.get('scroll')({ scrollDirection: 'vertical' })
    expect(wrapper.emitted('load-more')).toHaveLength(1)
    expect(wrapper.text()).toContain('加载失败，重试')
    await wrapper.setProps({ hasMore: false, loadError: '' })
    expect(wrapper.emitted('load-more')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
it('shows batch quantities on the bars without expandable table rows', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [task] },
    global: { stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true } },
  })
  try {
    await flushPromises()
    const options = native.instances[0]!.options
    const serial = options.records[0]
    expect(options.taskListTable.columns[0]).toMatchObject({ title: '流水号', tree: false })
    expect(wrapper.find('[aria-label="展开流水号"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="收起流水号"]').exists()).toBe(false)
    const batch = serial.children[0].children[0]
    const draw = (record: any, width = 120) =>
      options.taskBar.customLayout({ width, height: 20, taskRecord: record }).rootContainer.children
    const text = draw(batch).map((graphic: any) => graphic.attribute.text)
    expect(text).toEqual(expect.arrayContaining(['线切割', '80件', '75%']))
    const largeQuantity = draw({ ...batch, quantity: '1,400' })
    const teamName = largeQuantity.find((graphic: any) => graphic.attribute.text === '线切割')
    expect(teamName.AABBBounds.width()).toBeLessThanOrEqual(teamName.attribute.maxLineWidth)
    expect(largeQuantity.map((graphic: any) => graphic.attribute.text)).toContain('1,400件')
    const narrow = draw({ ...batch, quantity: '1,400' }, 90)
    expect(narrow.map((graphic: any) => graphic.attribute.text)).toEqual(
      expect.arrayContaining(['1400', '75%']),
    )
    expect(narrow.filter((graphic: any) => graphic.attribute.image)).toHaveLength(2)
    const weighted = {
      ...batch,
      quantity: '12.5 kg',
      node: { ...batch.node, completion_basis: 'weight' },
    }
    expect(draw(weighted).map((graphic: any) => graphic.attribute.text)).toContain('12.5 kg')
    expect(draw(weighted).map((graphic: any) => graphic.attribute.text)).not.toContain('12.5 kg件')
  } finally {
    wrapper.unmount()
  }
})
it('fits a selected month, drills into dates and restores the overview while preserving manual zoom on refresh', async () => {
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
  const expandedGradient = instance.options.taskBar.customLayout({
    width: 120,
    height: 28,
    taskRecord: instance.options.records[0].children[0].children[0],
  }).rootContainer.attribute.fill
  await selectRange('2026-11-01', '2026-11-30')
  expect(instance.options.timelineHeader.zoomScale).toMatchObject({
    enabled: true,
    dataZoomAxis: { enabled: false },
  })
  const batch = instance.options.records[0].children[0].children[0]
  const line = instance.options.taskBar.customLayout({
    width: 60,
    height: 20,
    taskRecord: batch,
  }).rootContainer
  expect(line.attribute.fill).toBe('transparent')
  expect(
    line.children
      .filter((item: any) => item.attribute.height === 4)
      .map((item: any) => item.attribute.width),
  ).toEqual([60, 45])
  expect(expandedGradient.gradient).toBe('linear')
  expect(
    line.children
      .filter((item: any) => item.attribute.height === 4)
      .map((item: any) => item.attribute.fill),
  ).toEqual([expandedGradient, expandedGradient])
  expect(line.children.map((item: any) => item.attribute.text)).toEqual(
    expect.arrayContaining(['线切割 75%']),
  )
  expect(line.children.some((item: any) => item.attribute.image)).toBe(false)
  const monthScale = (30 * 86400000) / 1096
  expect(instance.getCurrentMillisecondsPerPixel()).toBe(monthScale)
  expect(instance.options.rowHeight).toBeCloseTo(28.8)
  expect(instance.options.timelineHeader.scales).toEqual(
    expect.arrayContaining([expect.objectContaining({ unit: 'week', step: 1 })]),
  )
  expect(instance.options.minDate).toBe('2026-11-01T00:00:00.000')
  expect(instance.options.maxDate).toBe('2026-11-30T23:59:59.999')
  // Every native level retains sub-day precision, even with week/month headers.
  for (const level of instance.options.timelineHeader.zoomScale.levels)
    expect(level.some((scale: any) => scale.unit === 'hour')).toBe(true)
  const drawWeek = instance.options.timelineHeader.scales.find(
    (scale: any) => scale.unit === 'week',
  ).customLayout
  const week = drawWeek({
    width: 7 * 36,
    height: 44,
    startDate: new Date('2026-11-02T00:00:00'),
    endDate: new Date('2026-11-08T23:59:59.999'),
  }).rootContainer
  const days = week.children.filter((cell: any) => cell.handlers.has('click'))
  expect(days).toHaveLength(7)
  days[3].handlers.get('click')()
  await flushPromises()
  expect(instance.getCurrentMillisecondsPerPixel()).toBeCloseTo(86400000 / 1096)
  expect(instance.scrollLeft).toBeCloseTo(4 * 1096)
  expect(wrapper.get('.gantt-visible-range').text()).toBe('11-05 — 11-05')
  expect(instance.options.taskListTable.columns[0].tree).toBe(false)
  expect(instance.options.timelineHeader.scales).toEqual(
    expect.arrayContaining([expect.objectContaining({ unit: 'hour' })]),
  )
  await wrapper.get('[aria-label="返回整月"]').trigger('click')
  expect(instance.getCurrentMillisecondsPerPixel()).toBe(monthScale)
  expect(instance.scrollLeft).toBe(0)
  expect(wrapper.get('.gantt-visible-range').text()).toBe('11-01 — 11-30')
  const compactWeek = drawWeek({
    width: 100,
    height: 44,
    startDate: new Date('2026-11-02T00:00:00'),
    endDate: new Date('2026-11-08T23:59:59.999'),
  }).rootContainer
  compactWeek.handlers.get('click')()
  await flushPromises()
  expect(wrapper.get('.gantt-visible-range').text()).toBe('11-02 — 11-08')
  await wrapper.get('[aria-label="返回整月"]').trigger('click')
  // A narrower viewport falls back to clickable week headings, clipped at month end.
  const lastWeek = drawWeek({
    width: 100,
    height: 44,
    startDate: new Date('2026-11-30T00:00:00'),
    endDate: new Date('2026-12-06T23:59:59.999'),
  }).rootContainer
  lastWeek.handlers.get('click')()
  await flushPromises()
  expect(wrapper.get('.gantt-visible-range').text()).toBe('11-30 — 11-30')
  await wrapper.get('[aria-label="返回整月"]').trigger('click')
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 1200 })
  resize()
  expect(instance.getCurrentMillisecondsPerPixel()).toBe((30 * 86400000) / 896)
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 1400 })
  resize()
  expect(instance.getCurrentMillisecondsPerPixel()).toBe(monthScale)
  await wrapper.get('[aria-label="放大时间轴"]').trigger('click')
  expect(instance.zoomByFactor).toHaveBeenCalledWith(1.2)
  expect(instance.getCurrentMillisecondsPerPixel()).toBe(monthScale / 1.2)
  instance.scrollLeft = 80
  instance.scrollTop = 120
  await wrapper.setProps({ tasks: [{ ...task, version: 2 }] })
  await flushPromises()
  expect(instance.getCurrentMillisecondsPerPixel()).toBe(monthScale / 1.2)
  expect(instance.scrollLeft).toBe(80)
  expect(instance.scrollTop).toBe(120)
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 1000 })
  resize()
  expect(instance.getCurrentMillisecondsPerPixel()).toBe(monthScale / 1.2)
  expect(instance.zoomScaleManager.updateDataZoomResponsive).toHaveBeenCalled()
  // Wheel zoom updates the same indicator; the toolbar is not a second zoom system.
  instance.setMillisecondsPerPixel(360000)
  await flushPromises()
  expect(wrapper.get('.gantt-zoom span').text()).toBe('200%')
  await selectRange('2028-02-29', '2028-02-29')
  expect(instance.getCurrentMillisecondsPerPixel()).toBeCloseTo(86400000 / 696)
  expect(instance.scrollLeft).toBe(0)
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
  expect(animate).toHaveBeenCalledTimes(1)
  await wrapper.setProps({ tasks: [{ ...task, version: 2 }] })
  await flushPromises()
  expect(animate).toHaveBeenCalledTimes(1)
  expect(animations[0]!.cancel).toHaveBeenCalled()
  motion.matches = true
  await wrapper.get('[aria-label="缩小时间轴"]').trigger('click')
  expect(animate).toHaveBeenCalledTimes(1)
  motion.matches = false
  await wrapper.get('[aria-label="放大时间轴"]').trigger('click')
  expect(animate).toHaveBeenCalledTimes(1)
  wrapper.unmount()
  expect(animations[0]!.cancel).toHaveBeenCalled()
})
it('animates the list and timeline rows together and clears their transforms on release', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  const cancelFrame = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  const wrapper = mount(VTableScheduleTimeline, {
    props: { tasks: [task] },
    global: {
      stubs: { AppPopover: true, AppButton: true, ScheduleDateRange: true },
      renderStubDefaultSlot: true,
    },
  })
  await flushPromises()
  const group = () => ({
    attribute: { scaleY: 1 },
    setAttribute(_key: string, value: number) {
      this.attribute.scaleY = value
    },
    forEachChildren: vi.fn(),
  })
  const list = group(),
    bars = group()
  const instance = native.instances[0]!
  instance.taskListTableInstance.scenegraph = { bodyGroup: list, updateNextFrame: vi.fn() }
  instance.scenegraph.taskBar.barContainer = bars
  wrapper
    .findComponent(ScheduleDateRange)
    .vm.$emit('update:modelValue', ['2026-11-02', '2027-01-24'])
  await flushPromises()
  expect(list.attribute.scaleY).toBeCloseTo(1 / 0.8)
  expect(bars.attribute.scaleY).toBe(list.attribute.scaleY)
  frame(performance.now() + 90)
  expect(list.attribute.scaleY).toBeGreaterThan(1)
  expect(list.attribute.scaleY).toBeLessThan(1 / 0.8)
  expect(bars.attribute.scaleY).toBe(list.attribute.scaleY)
  frame(performance.now() + 1000)
  expect(list.attribute.scaleY).toBe(1)
  expect(bars.attribute.scaleY).toBe(1)
  wrapper
    .findComponent(ScheduleDateRange)
    .vm.$emit('update:modelValue', ['2026-11-02', '2026-11-08'])
  await flushPromises()
  expect(list.attribute.scaleY).toBeCloseTo(0.8)
  wrapper.unmount()
  expect(cancelFrame).toHaveBeenCalledWith(1)
  expect(list.attribute.scaleY).toBe(1)
  expect(bars.attribute.scaleY).toBe(1)
})
it('keeps batch lanes in the compact overview and exposes saved team totals in details', async () => {
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
  expect(team).toMatchObject({ type: 'project', progress: 75, laneCount: 2 })
  expect(team.children.map((batch: any) => batch.lanes[serial.id])).toEqual([0, 1])
  instance.handlers.get('click_task_bar')({
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
  await wrapper.setProps({ tasks: wrapper.props('tasks').map((task) => ({ ...task, version: 2 })) })
  await flushPromises()
  expect(wrapper.find('[aria-label="取消选中批次"]').exists()).toBe(true)
  expect(wrapper.findComponent(ScheduleBatchSummary).props('node').team_name).toBe('线切割')
  expect(wrapper.findAll('.detail-batches tbody tr')).toHaveLength(2)
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
  const deadline = instance.options.records[0].children.at(-1)
  for (const record of [deadline, { ...batch, type: 'milestone' }]) {
    const marker = instance.options.taskBar.customLayout({ taskRecord: record })
    expect(marker.renderDefaultBar).toBe(false)
    expect(marker.rootContainer.attribute).toMatchObject({ width: 12, height: 12 })
    expect(marker.rootContainer.children[0].attribute).toMatchObject({ radius: 3, lineWidth: 1.5 })
  }
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
  expect(instance.taskListTableInstance.on).toHaveBeenCalledTimes(1)
  expect(instance.taskListTableInstance.on).toHaveBeenCalledWith('click_cell', expect.any(Function))
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

it('opens details only on click, keeps them while hovering, and clears selection with Escape', async () => {
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
  instance.handlers.get('mouseenter_task_bar')?.(event)
  await flushPromises()
  expect(wrapper.findComponent({ name: 'AppPopover' }).attributes('visible')).toBe('false')
  expect(wrapper.findComponent(ScheduleBatchSummary).exists()).toBe(false)
  expect(bars.every((bar) => !bar.setAttribute.mock.calls.length)).toBe(true)
  instance.handlers.get('click_task_bar')(event)
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
  instance.handlers.get('mouseenter_task_bar')?.({ ...event, record: upstream[0] })
  instance.handlers.get('mouseleave_task_bar')?.(event)
  await flushPromises()
  expect(wrapper.findComponent(ScheduleBatchSummary).props('node').id).toBe(-33)
  // Element Plus reports the canvas click as outside its virtual trigger.
  // It must not close the details immediately after that same click pins them.
  wrapper.findComponent({ name: 'AppPopover' }).vm.$emit('update:visible', false)
  await flushPromises()
  expect(wrapper.findComponent({ name: 'AppPopover' }).attributes('visible')).toBe('true')
  instance.handlers.get('click_task_bar')({ ...event, record: upstream[0] })
  await flushPromises()
  expect(wrapper.findComponent(ScheduleBatchSummary).props('node').id).toBe(-31)
  instance.handlers.get('click_task_bar')({ ...event, record: upstream[0] })
  await flushPromises()
  expect(wrapper.findComponent({ name: 'AppPopover' }).attributes('visible')).toBe('false')
  instance.handlers.get('click_task_bar')(event)
  await wrapper.setProps({ tasks: [{ ...linkedTask }] })
  await flushPromises()
  expect(wrapper.find('[aria-label="取消选中批次"]').exists()).toBe(true)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(bars.every((bar) => bar.setAttribute.mock.lastCall?.[1] === 1)).toBe(true)
  expect(wrapper.findComponent({ name: 'AppPopover' }).attributes('visible')).toBe('false')
  wrapper.unmount()
})

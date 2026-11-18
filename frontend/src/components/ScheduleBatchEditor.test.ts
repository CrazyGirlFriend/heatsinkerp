// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElDatePicker, ElInputNumber } from 'element-plus'
import ScheduleBatchEditor from './ScheduleBatchEditor.vue'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import type { ProductionSchedule, ScheduleBatch, ScheduleTask } from '@/types/productionSchedule'

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isDispatch: false }) }))
let wrapper: VueWrapper
const schedule = {
  ...scheduleSummaryFixture(),
  id: 5,
  task_id: 2,
  process_route_id: routeFixture.id,
  version: 7,
  completion_basis: 'quantity',
  due_at: '2026-12-21T08:00:00Z',
  batches: [],
} as unknown as ProductionSchedule
async function render(task: Partial<ScheduleTask> = {}, plan: ProductionSchedule = schedule) {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({
    ...routeFixture,
    source_data: { ...routeFixture.source_data, order_document: orderFixture },
  })
  vi.spyOn(processRouteApi, 'orderPreview')
  vi.spyOn(productionScheduleApi, 'orderPreview').mockResolvedValue(new Blob(['original-pdf']))
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:team-order-original')
      static revokeObjectURL = vi.fn()
    },
  )
  vi.spyOn(productionScheduleApi, 'task').mockResolvedValue({
    id: 2,
    final_due_at: '2026-12-30T08:00:00Z',
    nodes: [],
    ...task,
  } as unknown as ScheduleTask)
  vi.spyOn(productionScheduleApi, 'saveBatches').mockResolvedValue(schedule)
  wrapper = mount(ScheduleBatchEditor, {
    props: { schedule: plan },
    global: {
      stubs: {
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        WordDocumentPreview: true,
        ProcessRouteDrawingPreview: true,
        DocumentViewer: true,
      },
      directives: { loading: () => {} },
    },
  })
  await flushPromises()
}
async function click(label: string) {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === label)!
    .trigger('click')
  await flushPromises()
}
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('team handover planner', () => {
  it('prefills a single plan from a legacy split draft and ignores a legacy lock timestamp', async () => {
    const legacyTask = { id: 2, locked_at: '2026-10-30T00:00:00Z' }
    await render(legacyTask, {
      ...schedule,
      completion_basis: 'weight',
      pending_batches: ['10.500000', '20.250000'].map((weight, index) => ({
        id: null,
        batch_number: index + 1,
        due_at: `2026-12-${21 + index}T08:00:00Z`,
        target_quantity: null,
        target_weight: weight,
        upstream_batch_ids: [],
      })),
    })
    expect(wrapper.findAllComponents(ElInputNumber)).toHaveLength(1)
    expect(wrapper.getComponent(ElInputNumber).props('modelValue')).toBe(30.75)
    await click('保存排期')
    expect(productionScheduleApi.saveBatches).toHaveBeenCalledWith(5, {
      expected_version: 7,
      batches: [
        {
          batch_number: 1,
          due_at: '2026-12-22T16:00:00+08:00',
          target_quantity: null,
          target_weight: 30.75,
          upstream_batch_ids: [],
        },
      ],
    })
  })
  it('previews and downloads the task original beside the team submission form', async () => {
    const download = vi.spyOn(productionScheduleApi, 'downloadOrder').mockResolvedValue(undefined)
    await render({ order_document: { ...orderFixture, filename: '调度订单原件.xlsx' } })
    expect(productionScheduleApi.task).toHaveBeenCalledTimes(1)
    expect(processRouteApi.detail).toHaveBeenCalledWith(schedule.process_route_id)
    expect(productionScheduleApi.orderPreview).toHaveBeenCalledWith(2, expect.any(AbortSignal))
    expect(processRouteApi.orderPreview).not.toHaveBeenCalled()
    const rail = wrapper.get('[aria-label="排期附件缩略图"]')
    expect(rail.find('table').exists()).toBe(false)
    expect(rail.get('iframe[title="订单表原件"]').attributes('src')).toContain(
      'blob:team-order-original',
    )
    await rail.get('button[aria-label="放大订单表"]').trigger('click')
    expect(wrapper.getComponent(DocumentViewer).props()).toMatchObject({
      pdf: 'blob:team-order-original',
      initialZoom: 100,
    })
    expect(wrapper.getComponent(DocumentViewer).props('html')).toBeUndefined()
    await click('下载原件')
    expect(download).toHaveBeenCalledWith(2, '调度订单原件.xlsx')
    expect(wrapper.findAllComponents(ElDatePicker)).toHaveLength(1)
    expect(wrapper.text()).toContain('保存排期')
  })
  it('never substitutes the engineering order when this task has no order document', async () => {
    await render()
    expect(wrapper.get('[aria-label="排期附件缩略图"]').text()).toContain('未上传')
    expect(wrapper.find('[aria-label="放大订单表"]').exists()).toBe(false)
    expect(processRouteApi.orderPreview).not.toHaveBeenCalled()
    expect(productionScheduleApi.orderPreview).not.toHaveBeenCalled()
  })
  it('requires only a handover time and keeps the final deadline read-only', async () => {
    await render()
    expect(wrapper.text()).not.toContain('计划开始')
    wrapper.findAllComponents(ElDatePicker)[0]!.vm.$emit('update:modelValue', '')
    await click('保存排期')
    expect(productionScheduleApi.saveBatches).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写转交时间')
    expect(wrapper.text()).toContain('2026-12-30 16:00')
  })
  it('edits the one handover plan while preserving its identity and supply link', async () => {
    await render(
      {},
      {
        ...schedule,
        batches: [
          {
            id: 10,
            batch_number: 1,
            due_at: schedule.due_at,
            target_quantity: 100,
            target_weight: schedule.target_weight,
            upstream_batch_ids: [9],
          } as ScheduleBatch,
        ],
      },
    )
    expect(wrapper.text()).not.toContain('增加一批')
    expect(wrapper.findAllComponents(ElDatePicker)).toHaveLength(1)
    wrapper.getComponent(ElDatePicker).vm.$emit('update:modelValue', '2026-12-22T17:00:00')
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 60)
    await click('保存排期')
    expect(productionScheduleApi.saveBatches).toHaveBeenCalledWith(5, {
      expected_version: 7,
      batches: [
        {
          id: 10,
          batch_number: 1,
          due_at: '2026-12-22T17:00:00+08:00',
          target_quantity: 60,
          target_weight: schedule.target_weight,
          upstream_batch_ids: [9],
        },
      ],
    })
    expect(wrapper.emitted('saved')).toEqual([[schedule]])
  })
})

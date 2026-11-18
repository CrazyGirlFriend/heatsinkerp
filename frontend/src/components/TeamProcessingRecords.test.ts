// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination, ElInput, ElSelect } from 'element-plus'
import TeamProcessingRecords from './TeamProcessingRecords.vue'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import TableExportButton from './TableExportButton.vue'
import TableColumnFilter from './TableColumnFilter.vue'
import TableExportDialog from './TableExportDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'
import type { ProcessingRecord } from '@/types/materialProcessing'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', () => ({
  useLiveRefresh: (refresh: () => Promise<void>) => {
    live.refresh = refresh
    return { message: { value: '' }, request: refresh }
  },
}))
const record = (id = 1): ProcessingRecord => ({
  id,
  source_transfer_id: 10,
  serial_no: 'YS-007',
  batch_no: 'TL001',
  material_name: '材料1',
  material_type: 'semi_finished',
  purpose_name: '切割业务1',
  before_quantity: 1,
  after_quantity: 20,
  delta_quantity: 19,
  weight: 100,
  reason: '切割为20件',
  created_by: '线切割班组长',
  created_at: '2026-10-09T01:00:00Z',
  on_hand_quantity: 12,
  on_hand_weight: 60,
  in_transit_quantity: 0,
  in_transit_weight: 0,
  processing_state: 'registered',
})
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'processingTasks').mockRejectedValue(new Error('不应读取他组任务目录'))
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([
    { id: 3, name: '研磨业务1', team_id: 5, active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'processingRecords').mockResolvedValue({
    items: [record()],
    total: 21,
    page: 1,
    page_size: 10,
    summary: {
      employee_day_count: 2,
      record_count: 20,
      unreported_count: 1,
      completed_quantity: 100,
      completed_weight: 98,
      scrap_quantity: 0,
      scrap_weight: 2,
    },
    processors: [
      { id: 71, name: '张师傅' },
      { id: 22, name: '王师傅' },
    ],
    processing_tasks: [{ id: 8, name: '粗磨' }],
  })
  vi.spyOn(teamMaterialApi, 'processingDaily').mockResolvedValue({
    items: [
      {
        team_id: 5,
        team_name: '轧制',
        processing_date: '2026-10-15',
        processor_employee_id: 71,
        processor_name: '张师傅',
        processing_mode: 'split',
        record_count: 1,
        input_quantity: 1,
        input_weight: 100,
        completed_quantity: 100,
        completed_weight: 98,
        scrap_quantity: 0,
        scrap_weight: 2,
      },
    ],
    total: 1,
    page: 1,
    page_size: 100,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(canWrite = true, path = '/team-workspaces/5?tab=processing') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div/>' } }],
  })
  await router.push(path)
  wrapper = mount(TeamProcessingRecords, {
    props: { teamId: 5, canWrite },
    global: {
      plugins: [router],
      stubs: {
        AppPopover: {
          props: ['visible'],
          template:
            '<div><slot name="reference" /><div v-if="visible !== false"><slot /></div></div>',
        },
        QuantityAdjustmentDialog: true,
        ProcessRouteEditor: {
          name: 'ProcessRouteEditor',
          props: { route: Object, viewOnly: Boolean },
          template: '<div />',
        },
        ElDialog: { template: '<div><slot/><slot name="footer"/></div>' },
      },
    },
  })
  await flushPromises()
  return router
}

async function openFilters() {
  await wrapper.getComponent(FilterDialog).get('button').trigger('click')
  await vi.waitFor(() => expect(wrapper.findComponent(RecordDateFilter).exists()).toBe(true))
}

it('shows the latest QC counts and leaves unrecorded quality results blank', async () => {
  const response = await teamMaterialApi.processingRecords(5)
  vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
    ...response,
    items: [
      {
        ...record(),
        report_inspections: [
          {
            id: 1,
            source_transfer_id: 11,
            checked_at: '2026-11-16T08:00:00Z',
            inspector_name: '张师傅',
            batch_quantity: 100,
            sample_quantity: 60,
            passed_quantity: 57,
            failed_quantity: 3,
            kind: 'inspection',
            scope: 'sample',
            parent_id: null,
            disposition: 'pending',
            problem_names: ['划伤'],
            notes: '边缘划伤',
          },
        ],
      },
      record(2),
    ],
  })
  await render()
  await wrapper.setProps({ teamCode: 'FACTORY-QC' })
  await flushPromises()
  const headers = wrapper.findAll('.el-table__header th')
  const bodyRows = wrapper.findAll('.el-table__body tbody tr')
  for (const [label, expected] of [
    ['检验件数', '60'],
    ['合格件数', '57'],
    ['不合格件数', '3'],
  ]) {
    const index = headers.findIndex((th) => th.text().includes(label!))
    expect(index).toBeGreaterThanOrEqual(0)
    expect(bodyRows[0]!.findAll('td')[index]!.text()).toBe(expected)
    expect(bodyRows[1]!.findAll('td')[index]!.text()).toBe('—')
  }
})

describe('cutting processing records', () => {
  it('shows and exports two hours of labor for two people working one hour', async () => {
    const result = await teamMaterialApi.processingRecords(5)
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      ...result,
      total: 1,
      items: [
        {
          ...record(),
          processors: [
            { id: 71, name: '张师傅' },
            { id: 22, name: '王师傅' },
          ],
          processing_minutes: 60,
          labor_minutes: 120,
          completed_quantity: 10,
        },
      ],
      summary: {
        ...result.summary!,
        processing_minutes: 60,
        labor_minutes: 120,
        record_count: 1,
        duration_record_count: 1,
      },
    })
    await render()
    expect(wrapper.get('tbody').text()).toContain('2 小时')
    expect(wrapper.get('tbody').text()).toContain('张师傅')
    expect(wrapper.get('tbody').text()).toContain('王师傅')
    expect(wrapper.find('.processing-totals').exists()).toBe(false)
    expect(wrapper.find('.summary-note').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('非实物库存产量')
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    const exported = await source.load(new AbortController().signal, () => {})
    expect(exported[0]).toMatchObject({ processing_minutes: 120, completed_quantity: 10 })
    await wrapper.setProps({ teamCode: 'FACTORY-ROLL' })
    const template = wrapper.getComponent(TableExportButton).props('source')()!
    const templateRows = await template.load(new AbortController().signal, () => {})
    expect(templateRows[0]).toMatchObject({ processing_minutes: 120, completed_quantity: 10 })
  })

  it('offers dispatch on writable records and disables it while loading or after clearing', async () => {
    await render()
    const button = () => wrapper.findAll('button').find((item) => item.text() === '转出')!
    await button().trigger('click')
    expect(wrapper.emitted('dispatch')).toEqual([[record()]])
    await wrapper.setProps({ dispatchingRecordId: 1 })
    expect(button().classes()).toContain('is-loading')
    expect(button().attributes('disabled')).toBeDefined()
    await wrapper.setProps({ dispatchingRecordId: undefined })
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [{ ...record(), on_hand_quantity: 0, on_hand_weight: 0, in_transit_quantity: 20 }],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await live.refresh()
    await flushPromises()
    expect(button().attributes('disabled')).toBeDefined()
    await wrapper.setProps({ canWrite: false })
    expect(button()).toBeUndefined()
  })
  it('filters both exports by task and business without precomputing grouped totals', async () => {
    const result = await teamMaterialApi.processingRecords(5)
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      ...result,
      summary: { ...result.summary!, employee_day_count: 1, daily_group_count: 3 },
    })
    const router = await render()
    expect(teamMaterialApi.processingTasks).not.toHaveBeenCalled()
    await openFilters()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('[aria-label="加工任务筛选"]').exists())!
      .vm.$emit('update:modelValue', 8)
    expect(wrapper.find('[aria-label="加工业务筛选"]').exists()).toBe(false)
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      processing_task_id: '8',
    })
    const exports = wrapper.getComponent(TableExportButton)
    const details = exports.props('source')()!
    const grouped = exports.props('variants')!()[0]!
    expect(grouped.total).toBeNull()
    expect(grouped.title).toContain('任务')
    await details.load(new AbortController().signal, () => {})
    await grouped.load(new AbortController().signal, () => {})
    expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(
      5,
      expect.objectContaining({ processing_task_id: 8, purpose_id: undefined }),
    )
    expect(teamMaterialApi.processingDaily).toHaveBeenLastCalledWith(
      5,
      expect.objectContaining({ processing_task_id: 8, purpose_id: undefined }),
    )
    wrapper.getComponent(FilterDialog).vm.$emit('reset')
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(router.currentRoute.value.query.processing_task_id).toBeUndefined()
    expect(router.currentRoute.value.query.purpose_id).toBeUndefined()
  })
  it('distinguishes schedule batches on the same serial in history and export', async () => {
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [
        { ...record(1), task_batch_number: 2 },
        { ...record(2), task_batch_number: 1 },
        record(3),
      ],
      total: 3,
      page: 1,
      page_size: 10,
    })
    await render()
    const table = wrapper.get('.el-table')
    expect(table.text()).toContain('排期批次')
    expect(table.text()).toContain('第2批')
    expect(table.text()).toContain('第1批')
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    const exported = await source.load(new AbortController().signal, () => {})
    expect(exported.map((row) => row.task_batch_number)).toEqual(['第2批', '第1批', '—'])
    const filter = wrapper
      .findAllComponents(TableColumnFilter)
      .find((item) => item.props('label') === '排期批次')!
    filter.vm.$emit('apply', '2', '2')
    await flushPromises()
    expect(
      JSON.parse(vi.mocked(teamMaterialApi.processingRecords).mock.lastCall![1]!.table_query!),
    ).toMatchObject({
      filters: [{ field: 'task_batch_number', kind: 'number', value: '2', end: '2' }],
    })
  })

  it('shows and exports the processing person without substituting the login account', async () => {
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [{ ...record(), processor_name: '王师傅' }, record(2)],
      total: 2,
      page: 1,
      page_size: 10,
    })
    await render()
    expect(wrapper.text()).toContain('加工人')
    expect(wrapper.text()).toContain('王师傅')
    expect(wrapper.text()).toContain('未登记')
    expect(wrapper.text()).not.toContain('线切割班组长')
    expect(wrapper.text()).not.toContain('登记人')
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    expect(source.fields.find((field) => field.key === 'processor_name')?.label).toBe('加工人')
    const exported = await source.load(new AbortController().signal, () => {})
    expect(exported.map((row) => row.processor_name)).toEqual(['王师傅', '未登记'])
  })

  it('separates registered pieces from the current twelve-piece inventory', async () => {
    await render()
    expect(wrapper.text()).toContain('加工前件数')
    expect(wrapper.text()).toContain('加工后件数')
    expect(wrapper.text()).toContain('当前未转出件数')
    expect(wrapper.text()).toContain('有加工记录 · 进度未标明')
    const headings = wrapper.findAll('thead th').map((cell) => cell.text())
    const cells = wrapper.find('tbody tr').findAll('td')
    expect(
      ['加工前件数', '加工后件数', '当前未转出件数'].map((label) =>
        cells[headings.indexOf(label)]!.text(),
      ),
    ).toEqual(['1', '20', '12'])
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '加工登记')!
      .trigger('click')
    expect(wrapper.emitted('register')).toHaveLength(1)
  })
  it('preserves filters on pagination and offers records to read-only administrators', async () => {
    const router = await render(
      false,
      '/team-workspaces/5?tab=processing&query=YS-007&date_from=2026-10-01&date_to=2026-10-09&processor_id=22&work_date=2026-10-08',
    )
    expect(wrapper.findAll('button').some((button) => button.text() === '加工登记')).toBe(false)
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      tab: 'processing',
      query: 'YS-007',
      page: '2',
      date_from: '2026-10-01',
      processor_id: '22',
      work_date: '2026-10-08',
    })
    expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(
      5,
      expect.objectContaining({
        page: 2,
        query: 'YS-007',
        processor_id: 22,
        work_date: '2026-10-08',
      }),
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '记录')!
      .trigger('click')
    expect(wrapper.getComponent(QuantityAdjustmentDialog).props()).toMatchObject({
      sourceId: 10,
      canWrite: false,
      processing: true,
      modelValue: true,
    })
  })
  it('uses a fixed table header in fullscreen and retains results on failed live refresh', async () => {
    await render()
    await wrapper.setProps({ fullscreen: true })
    expect(wrapper.getComponent({ name: 'ElTable' }).props()).toMatchObject({
      height: '100%',
      flexible: true,
    })
    vi.mocked(teamMaterialApi.processingRecords).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow('offline')
    expect(wrapper.text()).toContain('YS-007')
  })
  it('ignores a response from the previous team', async () => {
    await render()
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.processingRecords>>) => void
    vi.mocked(teamMaterialApi.processingRecords).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const refresh = live.refresh()
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    await wrapper.setProps({ teamId: 6 })
    await flushPromises()
    finish({ items: [record()], total: 1, page: 1, page_size: 10 })
    await refresh
    await flushPromises()
    expect(wrapper.text()).not.toContain('YS-007')
  })
})

describe('unified production records', () => {
  it('opens the exact rework instructions used by the historical processing record as read-only', async () => {
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [
        { ...record(), work_kind: 'rework', process_route_id: 27, process_step_name: '返工精磨' },
      ],
      total: 1,
      page: 1,
      page_size: 10,
    })
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(reworkRouteFixture)
    await render()
    await wrapper.get('button[aria-label="查看加工记录 #1 的返工工艺"]').trigger('click')
    await flushPromises()
    expect(processRouteApi.detail).toHaveBeenCalledWith(27)
    expect(wrapper.getComponent({ name: 'ProcessRouteEditor' }).props()).toMatchObject({
      route: reworkRouteFixture,
      viewOnly: true,
    })
    expect(wrapper.getComponent(QuantityAdjustmentDialog).props('modelValue')).toBe(false)
  })
  it('expands recorded process requirements without adding long text to the main table or reopening registration', async () => {
    const instructions = '厚度 2.5（+0.01/-0.02）mm。\n禁止叠放；单件放入泡沫盒。'.repeat(20)
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [
        {
          ...record(),
          process_step_name: '精磨',
          processing_task_name: '双面精磨',
          process_step_instructions: instructions,
          work_kind: 'rework',
          rework_of_id: 42,
          rework_round: 1,
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render()
    expect(wrapper.find('.processing-record-detail').exists()).toBe(false)
    expect(wrapper.text()).toContain('精磨')
    expect(wrapper.text()).toContain('双面精磨')
    expect(wrapper.text()).not.toContain(instructions)
    const requests = vi.mocked(teamMaterialApi.processingRecords).mock.calls.length
    await wrapper.get('.el-table__expand-icon').trigger('click')
    await flushPromises()
    const detail = wrapper.get('[aria-label="加工记录 #1 工艺详情"]')
    expect(detail.text()).toContain('精磨')
    expect(detail.text()).toContain('双面精磨')
    expect(
      detail.findAll('dl > div').map((item) => [item.get('dt').text(), item.get('dd').text()]),
    ).toContainEqual(['返工原记录', '#42'])
    expect(detail.get('.processing-record-requirements dd').element.textContent).toBe(instructions)
    expect(wrapper.getComponent(QuantityAdjustmentDialog).props('modelValue')).toBe(false)
    expect(teamMaterialApi.processingRecords).toHaveBeenCalledTimes(requests)
    await wrapper.get('.el-table__expand-icon').trigger('click')
    await flushPromises()
    expect(wrapper.find('.processing-record-detail').exists()).toBe(false)
  })

  it('marks missing historical requirements explicitly rather than inferring them from a step or task', async () => {
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [
        {
          ...record(),
          process_step_name: '旧精磨工序',
          processing_task_name: '旧精磨任务',
          process_step_instructions: null,
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
    })
    await render()
    await wrapper.get('.el-table__expand-icon').trigger('click')
    await flushPromises()
    const detail = wrapper.get('.processing-record-detail')
    expect(detail.get('.processing-record-requirements dd').text()).toBe('历史未登记')
    expect(detail.text()).toContain('旧精磨工序')
    expect(detail.text()).toContain('旧精磨任务')
    expect(detail.text()).not.toContain('返工原记录')
  })

  it('exports the complete recorded requirements including newlines and marks missing history', async () => {
    const instructions =
      '按图纸 NP000500010-A4 加工。\n厚度 2.5（+0.01/-0.02）mm，禁止叠放。'.repeat(30)
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
      items: [
        { ...record(), process_step_instructions: instructions },
        { ...record(2), process_step_instructions: null },
      ],
      total: 2,
      page: 1,
      page_size: 10,
    })
    await render()
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    expect(source.fields.find((field) => field.key === 'process_step_instructions')?.label).toBe(
      '本道工艺要求',
    )
    const exported = await source.load(new AbortController().signal, () => {})
    expect(exported.map((row) => row.process_step_instructions)).toEqual([
      instructions,
      '历史未登记',
    ])
  })

  it('keeps pagination without totals in normal and fullscreen modes', async () => {
    await render()
    expect(wrapper.find('.processing-totals').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('个人日产')
    expect(wrapper.text()).not.toContain('筛选结果合计')
    expect(wrapper.getComponent(ElPagination).props('total')).toBe(21)
    expect(wrapper.text()).not.toContain('1 笔历史记录信息不全，未计入工作量')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    await wrapper.setProps({ fullscreen: true })
    expect(wrapper.findComponent(FilterDialog).exists()).toBe(true)
    expect(wrapper.findComponent(TableExportButton).exists()).toBe(true)
    expect(wrapper.find('[aria-label="筛选结果加工工作量合计"]').exists()).toBe(false)
    expect(wrapper.getComponent(ElPagination).props('total')).toBe(21)
  })
  it('uses the applied actual-date and person filters for both export formats', async () => {
    const router = await render()
    await openFilters()
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', 'YS-007')
    wrapper
      .getComponent(RecordDateFilter)
      .vm.$emit('update:modelValue', { from: '2026-10-15', to: '2026-10-15' })
    wrapper.getComponent(ProcessingPersonInput).vm.$emit('update:modelValue', '张师傅')
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    const params = {
      query: 'YS-007',
      date_from: '2026-10-15',
      date_to: '2026-10-15',
      processor_id: 71,
      work_date: undefined,
    }
    expect(router.currentRoute.value.query).toMatchObject({
      processor_id: '71',
      date_from: '2026-10-15',
    })
    expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(5, {
      ...params,
      page: 1,
      page_size: 10,
    })
    wrapper.getComponent(ElInput).vm.$emit('update:modelValue', '未应用的输入')
    const exports = wrapper.getComponent(TableExportButton)
    const detailed = exports.props('source')()!
    const grouped = exports.props('variants')!()[0]!
    expect(detailed.total).toBe(21)
    expect(grouped.total).toBeNull()
    expect(teamMaterialApi.processingDaily).not.toHaveBeenCalled()
    const data = await grouped.load(new AbortController().signal, () => {})
    expect(data[0]).toMatchObject({
      completed_quantity: 100,
      input_quantity: 1,
      scrap_weight: 2,
      processor_employee_id: 71,
    })
    expect(teamMaterialApi.processingDaily).toHaveBeenLastCalledWith(5, {
      ...params,
      page: 1,
      page_size: 100,
    })
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(5, {
      ...params,
      page: 2,
      page_size: 10,
    })
    // Pagination must retain only applied date/person filters.
    await openFilters()
    wrapper
      .getComponent(RecordDateFilter)
      .vm.$emit('update:modelValue', { from: '2026-10-16', to: '2026-10-16' })
    wrapper.getComponent(ProcessingPersonInput).vm.$emit('update:modelValue', '王师傅')
    wrapper.getComponent(FilterDialog).vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.getComponent(ProcessingPersonInput).props('modelValue')).toBe('张师傅')
    expect(wrapper.getComponent(RecordDateFilter).props('modelValue')).toEqual({
      from: '2026-10-15',
      to: '2026-10-15',
    })
    wrapper.getComponent(FilterDialog).vm.$emit('reset')
    wrapper.getComponent(FilterDialog).vm.$emit('apply')
    await flushPromises()
    expect(router.currentRoute.value.query.processor_id).toBeUndefined()
    expect(router.currentRoute.value.query.date_from).toBeUndefined()
  })
  it('does not keep the previous team worker when switching teams', async () => {
    const router = await render(true, '/team-workspaces/5?tab=processing&processor_id=71')
    await wrapper.setProps({ teamId: 6 })
    await flushPromises()
    expect(router.currentRoute.value.query.processor_id).toBeUndefined()
    expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(
      6,
      expect.objectContaining({ processor_id: undefined }),
    )
  })
})

it('keeps processing history read-only and does not let production initiate rework', async () => {
  const sources = vi.spyOn(teamMaterialApi, 'processingSources')
  await render()
  expect(wrapper.findAll('button').some((button) => button.text() === '返工')).toBe(false)
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '记录')!
    .trigger('click')
  await flushPromises()
  expect(sources).not.toHaveBeenCalled()
  expect(wrapper.getComponent(QuantityAdjustmentDialog).props()).toMatchObject({
    sourceId: 10,
    canWrite: false,
    modelValue: true,
  })
})

it('exports rework identity without showing list totals', async () => {
  vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
    items: [{ ...record(), work_kind: 'rework', rework_round: 3, rework_of_id: 9 }],
    total: 1,
    page: 1,
    page_size: 10,
    summary: {
      completed_quantity: 1,
      completed_weight: 1,
      rework_quantity: 3,
      rework_weight: 3,
      record_count: 4,
      employee_day_count: 1,
      unreported_count: 0,
      scrap_quantity: 0,
      scrap_weight: 0,
    },
  })
  await render()
  expect(wrapper.text()).not.toContain('首次任务完成')
  expect(wrapper.text()).toContain('返工 · 第 3 次')
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  const exported = await source.load(new AbortController().signal, () => {})
  expect(exported[0]).toMatchObject({ work_kind: '返工', rework_of_id: 9, rework_round: 3 })
})

it('shows team parameters and preserves them in detail exports without adding unrelated columns', async () => {
  vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
    items: [
      {
        ...record(),
        furnace_no: '02炉',
        actual_temperature_c: 0,
        temperature_requirement: '900–950 °C',
        holding_minutes: 60,
      },
    ],
    total: 1,
    page: 1,
    page_size: 10,
    parameter_fields: [
      'furnace_no',
      'temperature_requirement',
      'actual_temperature_c',
      'holding_minutes',
    ],
  })
  await render()
  const headers = wrapper.findAll('th').map((th) => th.text())
  expect(headers).toContain('炉号')
  expect(headers).toContain('实际温度（°C）')
  expect(headers).not.toContain('机台号')
  expect(headers).not.toContain('保温时长')
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  const rows = await source.load(new AbortController().signal, () => {})
  expect(rows[0]).toMatchObject({
    furnace_no: '02炉',
    actual_temperature_c: 0,
    temperature_requirement: '900–950 °C',
    holding_minutes: 60,
  })
  vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
    parameter_fields: ['machine_no'],
  })
  await wrapper.setProps({ teamId: 6 })
  await flushPromises()
  const nextHeaders = wrapper.findAll('th').map((th) => th.text())
  expect(nextHeaders).toContain('机台号')
  expect(nextHeaders).not.toContain('炉号')
})

it('exports all inspection tasks through one original template without exposing internal JSON as a column', async () => {
  const result = await teamMaterialApi.processingRecords(5)
  const inspections: NonNullable<ProcessingRecord['report_inspections']> = [
    {
      id: 71,
      source_transfer_id: 10,
      checked_at: '2026-11-13T01:30:00Z',
      inspector_name: '检验员甲',
      batch_quantity: 123,
      sample_quantity: 12,
      passed_quantity: 10,
      failed_quantity: 2,
      kind: 'inspection',
      scope: 'sample',
      parent_id: null,
      disposition: 'pending',
      problem_names: ['划伤'],
      notes: '',
    },
  ]
  vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
    ...result,
    total: 3,
    items: ['检验', '喷砂', '去毛刺'].map((processing_task_name, index) => ({
      ...record(index + 1),
      processing_task_name,
      finished_quantity: 4008,
      completed_quantity: 123 + index,
      report_inspections: index === 0 ? inspections : [],
    })),
  })
  await render()
  await wrapper.setProps({ teamCode: 'FACTORY-QC' })
  const button = wrapper.getComponent(TableExportButton)
  const detail = button.props('source')()!
  expect(detail.fields.some((field) => field.key === 'report_inspections')).toBe(false)
  const templates = button.props('variants')!().filter((source) => source.workbook)
  expect(templates.map((source) => source.title)).toEqual(['检验产量表'])
  const rows = await templates[0]!.load(new AbortController().signal, () => {})
  expect(rows).toHaveLength(3)
  expect(rows.map((row) => row.processing_task_name)).toEqual(['检验', '喷砂', '去毛刺'])
  expect(rows.map((row) => row.completed_quantity)).toEqual([123, 124, 125])
  expect(rows[0]).toMatchObject({ finished_quantity: 4008, completed_quantity: 123 })
  expect(JSON.parse(String(rows[0]!.report_inspections))).toEqual(inspections)
  for (const row of rows.slice(1)) expect(JSON.parse(String(row.report_inspections))).toEqual([])
})

it.each([
  ['FACTORY-ROLL', '轧制产量表'],
  ['FACTORY-ANNEAL', '退火模压产量表'],
  ['FACTORY-GRIND', '研磨产量表'],
  ['FACTORY-WIRE', '线切割产量表'],
  ['FACTORY-ENGRAVE', '雕刻产量表'],
  ['FACTORY-QC', '检验产量表'],
])('defaults production registration to the original %s template', async (teamCode, title) => {
  await render(true, '/team-workspaces/5?tab=processing&processing_view=production')
  await wrapper.setProps({ teamCode })
  const button = wrapper.getComponent(TableExportButton)
  await button.get('button').trigger('click')
  const dialog = wrapper.getComponent(TableExportDialog)
  expect(dialog.props('source')).toMatchObject({ title, workbook: expect.any(Function) })
  expect(dialog.find('.export-fields').exists()).toBe(false)
  expect(dialog.props('variants')).toEqual([])
  expect(dialog.props('variants')?.[0]?.workbook).toBeUndefined()
})

it('keeps actual-date and task filters and loads all matching records for the default template', async () => {
  const result = await teamMaterialApi.processingRecords(5)
  vi.mocked(teamMaterialApi.processingRecords).mockResolvedValue({
    ...result,
    total: 1,
    items: [{ ...record(), completed_quantity: 123, processing_minutes: 90, labor_minutes: 90 }],
  })
  await render(
    true,
    '/team-workspaces/5?tab=processing&processing_view=production&date_from=2026-11-01&date_to=2026-11-15&processing_task_id=8&page_size=20',
  )
  await wrapper.setProps({ teamCode: 'FACTORY-ROLL' })
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  const rows = await source.load(new AbortController().signal, () => {})
  expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(
    5,
    expect.objectContaining({
      date_from: '2026-11-01',
      date_to: '2026-11-15',
      processing_task_id: 8,
      page: 1,
      page_size: 100,
    }),
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ completed_quantity: 123, processing_minutes: 90 })
})

it('uses ordinary details for processing history and teams without a supplied template', async () => {
  await render()
  await wrapper.setProps({ teamCode: 'FACTORY-ROLL' })
  const button = wrapper.getComponent(TableExportButton)
  expect(button.props('source')()!.workbook).toBeUndefined()
  expect(button.props('variants')!()[0]!.title).toBe('轧制产量表')
  await wrapper.setProps({ teamCode: 'FACTORY-PLATE' })
  expect(button.props('source')()!.title).toBe('逐笔加工明细')
  expect(button.props('source')()!.workbook).toBeUndefined()
  expect(button.props('variants')!().some((source) => source.workbook)).toBe(false)
})

it('uses only original columns in daily registration and leaves unrecorded roles blank', async () => {
  await render(true, '/team-workspaces/5?tab=processing&processing_view=production')
  await wrapper.setProps({ teamCode: 'FACTORY-ROLL' })
  await flushPromises()
  const headers = wrapper.findAll('thead th').map((cell) => cell.text())
  for (const label of ['日期', '流水号', '主操', '副操', '加工成品 / 件数', '备注']) {
    expect(headers.some((text) => text.includes(label))).toBe(true)
  }
  for (const label of ['当前状态', '工艺工序', '当前未转出件数', '登记时进度', '操作']) {
    expect(headers.some((text) => text.includes(label))).toBe(false)
  }
  expect(wrapper.text()).not.toContain('筛选结果合计')
  expect(wrapper.text()).not.toContain('加工人员：')
  expect(wrapper.find('.el-table__expand-icon').exists()).toBe(false)
})

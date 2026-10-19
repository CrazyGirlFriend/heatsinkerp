// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination, ElInput } from 'element-plus'
import TeamProcessingRecords from './TeamProcessingRecords.vue'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import TableExportButton from './TableExportButton.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
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
        QuantityAdjustmentDialog: true,
        ElDialog: { template: '<div><slot/><slot name="footer"/></div>' },
      },
    },
  })
  await flushPromises()
  return router
}

describe('cutting processing records', () => {
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
  it('shows totals for every matching record and keeps one entry in normal and fullscreen modes', async () => {
    await render()
    expect(wrapper.text()).not.toContain('个人日产')
    expect(wrapper.get('[aria-label="筛选结果产量合计"]').text()).toContain('完成 100 件 / 98 kg')
    expect(wrapper.text()).toContain('1 笔历史记录信息不全，未计入产量')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    await wrapper.setProps({ fullscreen: true })
    expect(wrapper.findComponent(FilterDialog).exists()).toBe(true)
    expect(wrapper.findComponent(TableExportButton).exists()).toBe(true)
    expect(wrapper.find('[aria-label="筛选结果产量合计"]').exists()).toBe(true)
  })
  it('uses the applied actual-date and person filters for both export formats', async () => {
    const router = await render()
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
    expect(grouped.total).toBe(2)
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

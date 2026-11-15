// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import TeamQualityFeedback from './TeamQualityFeedback.vue'
import QualityFeedbackDetail from './QualityFeedbackDetail.vue'
import FilterDialog from './FilterDialog.vue'
import InspectionProblemFilter from './InspectionProblemFilter.vue'
import TableExportButton from './TableExportButton.vue'
import TableFilterFields from './TableFilterFields.vue'
import {
  qualityFeedbackApi,
  type QualityFeedback,
  type TeamProblem,
} from '@/services/qualityFeedbackApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 2, name: '轧制', code: 'FACTORY-ROLL', active: true },
      { id: 8, name: '检验', code: 'FACTORY-QC', active: true },
    ],
  }),
}))
vi.mock('@/composables/useLiveRefresh', () => ({
  useLiveRefresh: () => ({ message: { value: '' }, request: vi.fn() }),
}))
const record = {
  id: 1,
  serial_no: '805881-5',
  checked_at: '2026-10-20T00:00:00Z',
  kind: 'patrol',
  team_name: '轧制',
  scope: 'sample',
  sample_quantity: 10,
  failed_quantity: 2,
  involved_teams: [{ team_id: 2, name: '轧制', replied: false }],
  problems: [{ id: 11, name: '登记时的问题名称' }],
  notes: '补充',
  feedback_status: 'pending',
  disposition: 'pending',
  decision_notes: '',
  batch_no: 'TL42',
} as QualityFeedback
let wrapper: VueWrapper
beforeEach(() => {
  route.query = {}
  vi.spyOn(qualityFeedbackApi, 'records').mockResolvedValue({
    items: [record],
    total: 1,
    pending_count: 1,
  })
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockResolvedValue([
    { id: 11, team_id: 8, name: '目录改名后', active: false, version: 2 },
  ])
})
it('keeps the overview quality period and status when opening the list or exporting', async () => {
  route.query = { status: 'pending', team_id: '2', date_from: '2026-10-09', date_to: '2026-11-07' }
  await render()
  const filters = { status: 'pending', team_id: 2, date_from: '2026-10-09', date_to: '2026-11-07' }
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(expect.objectContaining(filters))
  await wrapper.setProps({ teamId: 8, showAll: true })
  await flushPromises()
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(expect.objectContaining(filters))
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  await source.load(new AbortController().signal, vi.fn())
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(expect.objectContaining(filters))
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(showAll = false) {
  wrapper = mount(TeamQualityFeedback, {
    props: showAll ? { showAll: true } : { teamId: 2 },
    global: {
      stubs: {
        QualityFeedbackDetail: true,
        TeamProblemDetail: {
          name: 'TeamProblemDetail',
          props: ['routeId'],
          template: '<div class="team-problem-detail" />',
        },
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await flushPromises()
}
it('lists cross-team issues without a team constraint and keeps disposition filtering in exports', async () => {
  vi.mocked(qualityFeedbackApi.records).mockResolvedValue({
    items: [
      { ...record, notes: '边缘毛刺', disposition: 'rework' },
      {
        ...record,
        id: 2,
        kind: 'inspection',
        team_name: '检验',
        notes: '尺寸超差',
        disposition: 'scrap',
      },
    ],
    total: 2,
    pending_count: 2,
  })
  await render(true)
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: undefined, page: 1 }),
  )
  expect(wrapper.text()).toContain('边缘毛刺')
  expect(wrapper.text()).toContain('尺寸超差')
  expect(wrapper.text()).toContain('返工')
  expect(wrapper.text()).toContain('报废')
  expect(wrapper.text()).toContain('共 2 条问题')
  wrapper.getComponent(FilterDialog).vm.$emit('open')
  wrapper.getComponent(FilterDialog).vm.$emit('update:modelValue', true)
  await flushPromises()
  wrapper
    .getComponent(TableFilterFields)
    .vm.$emit('update:modelValue', [
      { field: 'disposition', kind: 'select', value: 'rework', end: '' },
    ])
  wrapper.getComponent(FilterDialog).vm.$emit('apply')
  await flushPromises()
  const filters = {
    table_query: JSON.stringify({
      filters: [{ field: 'disposition', kind: 'select', value: 'rework', end: '' }],
    }),
  }
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(expect.objectContaining(filters))
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  await source.load(new AbortController().signal, vi.fn())
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(expect.objectContaining(filters))
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '查看 / 处理')!
    .trigger('click')
  expect(wrapper.getComponent(QualityFeedbackDetail).props('issueId')).toBe(1)
})

it('keeps team reports distinct from inspection IDs and opens their linked rework detail', async () => {
  const report: TeamProblem = {
    id: record.id,
    kind: 'team_report',
    serial_no: '691236-50',
    batch_no: 'TL-REWORK',
    source_transfer_id: 42,
    material_name: 'MoCu70',
    team_id: 2,
    team_name: '轧制',
    checked_at: record.checked_at,
    notes: '精轧后厚度偏大',
    failed_quantity: 20,
    weight: 2,
    created_by: '轧制班组长',
    involved_teams: [{ team_id: 2, name: '轧制', replied: true }],
    feedback_status: 'pending',
    disposition: 'rework',
    route_state: 'draft',
    rework_round: 1,
    rework_progress: {
      quantity: 20,
      completed_quantity: 0,
      passed_quantity: 0,
      state: 'awaiting_route',
      inspections: [],
    },
  }
  vi.mocked(qualityFeedbackApi.records).mockResolvedValue({
    items: [report, record],
    total: 2,
    pending_count: 2,
  })
  await render(true)
  expect(wrapper.text()).toContain('班组反馈')
  expect(wrapper.text()).toContain('未填写')
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  const exported = await source.load(new AbortController().signal, vi.fn())
  expect(exported[0]).toMatchObject({
    kind: '班组反馈',
    scope: '—',
    sample_quantity: '',
    problems: report.notes,
  })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '查看 / 处理')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent({ name: 'TeamProblemDetail' }).props('routeId')).toBe(report.id)
  expect(wrapper.findComponent(QualityFeedbackDetail).exists()).toBe(false)
})
it('opens the exact issue from a quality notification and passes its navigation key', async () => {
  route.query = { issue: '42', business_notice: 'quality:8', notice: 'quality-landing' }
  await render()
  expect(wrapper.getComponent(QualityFeedbackDetail).props()).toMatchObject({
    issueId: 42,
    noticeKey: 'quality-landing',
  })
})
it('clears the larger page while a smaller page is loading and after a failed request', async () => {
  const items = Array.from({ length: 23 }, (_, index) => ({ ...record, id: index + 1 }))
  const response = (size: number) => ({ items: items.slice(0, size), total: 23, pending_count: 23 })
  vi.mocked(qualityFeedbackApi.records).mockImplementation(async (params) =>
    response(params?.page_size || 10),
  )
  await render()
  wrapper.getComponent(ElPagination).vm.$emit('size-change', 20)
  await flushPromises()
  expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(20)
  let fail!: (error: Error) => void
  vi.mocked(qualityFeedbackApi.records).mockImplementationOnce(
    () => new Promise((_, reject) => (fail = reject)),
  )
  wrapper.getComponent(ElPagination).vm.$emit('size-change', 10)
  await flushPromises()
  expect(wrapper.getComponent(ElPagination).props('pageSize')).toBe(10)
  expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
  fail(new Error('读取失败'))
  await flushPromises()
  expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(0)
  expect(wrapper.text()).toContain('读取失败')
})
it('uses a selected problem for the list and export while preserving the original problem name', async () => {
  await render()
  wrapper.getComponent(FilterDialog).vm.$emit('open')
  wrapper.getComponent(FilterDialog).vm.$emit('update:modelValue', true)
  await flushPromises()
  wrapper.getComponent(InspectionProblemFilter).vm.$emit('update:modelValue', 11)
  wrapper.getComponent(FilterDialog).vm.$emit('apply')
  await flushPromises()
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: 2, problem_type_id: 11, page: 1 }),
  )
  expect(wrapper.getComponent(FilterDialog).props('count')).toBe(1)
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  const rows = await source.load(new AbortController().signal, vi.fn())
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: 2, problem_type_id: 11, page_size: 100 }),
  )
  expect(rows[0]).toMatchObject({ problems: '登记时的问题名称' })
  expect(wrapper.text()).toContain('登记时的问题名称')
  wrapper.getComponent(FilterDialog).vm.$emit('reset')
  wrapper.getComponent(FilterDialog).vm.$emit('apply')
  await flushPromises()
  expect(qualityFeedbackApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: 2, problem_type_id: undefined }),
  )
})
it('labels old unclassified failures in the table and export without guessing a category', async () => {
  vi.mocked(qualityFeedbackApi.records).mockResolvedValue({
    items: [{ ...record, problems: undefined }],
    total: 1,
    pending_count: 1,
  })
  await render()
  expect(wrapper.text()).toContain('历史未分类')
  const source = wrapper.getComponent(TableExportButton).props('source')()!
  const rows = await source.load(new AbortController().signal, vi.fn())
  expect(rows[0]).toMatchObject({ problems: '历史未分类' })
})

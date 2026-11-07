// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import TeamQualityFeedback from './TeamQualityFeedback.vue'
import FilterDialog from './FilterDialog.vue'
import InspectionProblemFilter from './InspectionProblemFilter.vue'
import TableExportButton from './TableExportButton.vue'
import { qualityFeedbackApi, type QualityFeedback } from '@/services/qualityFeedbackApi'
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
async function render() {
  wrapper = mount(TeamQualityFeedback, {
    props: { teamId: 2 },
    global: {
      stubs: {
        QualityFeedbackDetail: true,
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await flushPromises()
}
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

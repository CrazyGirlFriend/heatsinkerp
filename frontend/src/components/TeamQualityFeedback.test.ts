// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TeamQualityFeedback from './TeamQualityFeedback.vue'
import FilterDialog from './FilterDialog.vue'
import InspectionProblemFilter from './InspectionProblemFilter.vue'
import TableExportButton from './TableExportButton.vue'
import { qualityFeedbackApi, type QualityFeedback } from '@/services/qualityFeedbackApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
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
  vi.spyOn(qualityFeedbackApi, 'records').mockResolvedValue({
    items: [record],
    total: 1,
    pending_count: 1,
  })
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockResolvedValue([
    { id: 11, team_id: 8, name: '目录改名后', active: false, version: 2 },
  ])
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

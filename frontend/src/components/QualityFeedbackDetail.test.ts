// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElInput } from 'element-plus'
import QualityFeedbackDetail from './QualityFeedbackDetail.vue'
import {
  qualityFeedbackApi,
  type QualityFeedbackDetail as Detail,
} from '@/services/qualityFeedbackApi'
const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 2, name: '轧制', active: true },
      { id: 8, code: 'FACTORY-QC', name: '检验', active: true },
    ],
  }),
}))
const record: Detail = {
  id: 1,
  source_transfer_id: 42,
  team_id: 2,
  team_name: '轧制',
  serial_no: '805881-5',
  batch_no: 'TL42',
  material_name: 'W80',
  specification: null,
  inspector_employee_id: 9,
  inspector_name: '检验员',
  processing_record_id: 1,
  processor_name: '张师傅',
  checked_at: '2026-10-19T00:00:00Z',
  batch_quantity: 100,
  sample_quantity: 10,
  passed_quantity: 8,
  failed_quantity: 2,
  kind: 'patrol',
  scope: 'sample',
  methods: ['visual'],
  items: ['appearance'],
  dimension_result: '',
  weight_result: '',
  status: 'failed',
  blocks_outbound: false,
  notes: '',
  parent_id: null,
  released_at: null,
  created_by: '检验班组长',
  quality_issue_id: 1,
  feedback_status: 'pending',
  feedback_version: 0,
  disposition: 'pending',
  decision_notes: '',
  involved_teams: [{ team_id: 2, name: '轧制', replied: false }],
  events: [],
  rechecks: [],
}
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({
    isTeamAccount: true,
    currentUser: { team_id: 2, active: true },
    currentUserError: null,
  })
  vi.spyOn(qualityFeedbackApi, 'detail').mockResolvedValue(record)
  vi.spyOn(qualityFeedbackApi, 'reply').mockResolvedValue({
    ...record,
    feedback_version: 1,
    feedback_status: 'processing',
  })
  vi.spyOn(qualityFeedbackApi, 'decide').mockResolvedValue({ ...record, feedback_version: 1 })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(QualityFeedbackDetail, {
    props: { issueId: 1 },
    global: {
      stubs: {
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        RouterLink: true,
        InspectionRegistrationDialog: true,
      },
    },
  })
  await flushPromises()
}
const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)
it('lets an involved team reply but does not expose QC decisions', async () => {
  await render()
  expect(button('保存处理意见')).toBeUndefined()
  expect(button('登记复检')).toBeUndefined()
  await button('提交反馈')!.trigger('click')
  expect(qualityFeedbackApi.reply).not.toHaveBeenCalled()
  wrapper.getComponent(ElInput).vm.$emit('update:modelValue', '已核查，请检验班组长决定处理')
  await button('提交反馈')!.trigger('click')
  await flushPromises()
  expect(qualityFeedbackApi.reply).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ notes: '已核查，请检验班组长决定处理', expected_version: 0 }),
  )
  expect(qualityFeedbackApi.decide).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('不合格 2 件')
})
it('QC saves a manual decision and retains the inspection facts', async () => {
  state.auth.currentUser = { team_id: 8, active: true }
  await render()
  expect(button('提交反馈')).toBeUndefined()
  await button('保存处理意见')!.trigger('click')
  await flushPromises()
  expect(qualityFeedbackApi.decide).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      disposition: 'pending',
      status: 'pending',
      release_legacy_hold: false,
      involved_team_ids: [2],
    }),
  )
  expect(wrapper.text()).toContain('不合格 2 件')
  expect(qualityFeedbackApi.reply).not.toHaveBeenCalled()
})
it('losing team permissions removes write actions', async () => {
  await render()
  state.auth.currentUserError = '登录状态失效'
  await flushPromises()
  expect(button('提交反馈')).toBeUndefined()
  expect(button('保存处理意见')).toBeUndefined()
})

it('shows historical problem snapshots for the original check and every recheck', async () => {
  vi.mocked(qualityFeedbackApi.detail).mockResolvedValue({
    ...record,
    problems: [{ id: 11, name: '原检查问题名称' }],
    rechecks: [
      { ...record, id: 2, parent_id: 1, problems: [{ id: 11, name: '复检时的问题名称' }] },
      { ...record, id: 3, parent_id: 1, problems: [] },
      { ...record, id: 4, parent_id: 1, failed_quantity: 0, problems: [] },
    ],
  })
  await render()
  expect(wrapper.text()).toContain('原检查问题名称')
  expect(wrapper.text()).toContain('复检时的问题名称')
  expect(wrapper.text()).toContain('历史未分类')
  const rows = wrapper.findAll('.el-table__body-wrapper tbody tr')
  expect(rows[2]!.text()).toContain('—')
  expect(rows[2]!.text()).not.toContain('历史未分类')
})

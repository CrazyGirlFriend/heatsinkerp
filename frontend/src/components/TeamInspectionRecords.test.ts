// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInput, ElPagination, ElSelect } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TeamInspectionRecords from './TeamInspectionRecords.vue'
import FilterDialog from './FilterDialog.vue'
import InspectionProblemFilter from './InspectionProblemFilter.vue'
import TableExportButton from './TableExportButton.vue'
import InspectionRegistrationDialog from './InspectionRegistrationDialog.vue'
import { inspectionApi, type InspectionRecord } from '@/services/inspectionApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
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
const record: InspectionRecord = {
  kind: 'patrol',
  scope: 'sample',
  methods: ['visual'],
  items: ['appearance'],
  dimension_result: '',
  weight_result: '',
  blocks_outbound: true,
  quality_issue_id: 13,
  feedback_status: 'pending',
  feedback_version: 0,
  disposition: 'pending',
  decision_notes: '',
  id: 13,
  source_transfer_id: 42,
  team_id: 2,
  team_name: '轧制',
  serial_no: '805881-5',
  batch_no: 'TL42',
  material_name: 'W80',
  specification: null,
  inspector_employee_id: 9,
  inspector_name: '王检验',
  processing_record_id: 12,
  processor_name: '李师傅',
  checked_at: '2026-10-19T00:00:00Z',
  batch_quantity: 100,
  sample_quantity: 5,
  passed_quantity: 4,
  failed_quantity: 1,
  problems: [{ id: 14, name: '历史划伤名称' }],
  status: 'pending',
  notes: '',
  parent_id: null,
  released_at: null,
  created_by: '检验班组长',
}
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({
    isTeamAccount: true,
    currentUser: { team_id: 8, active: true },
    currentUserError: null,
  })
  vi.spyOn(inspectionApi, 'records').mockResolvedValue({
    items: [record],
    total: 1,
    page: 1,
    page_size: 10,
  })
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockResolvedValue([
    { id: 14, team_id: 8, name: '表面划伤', active: false, version: 2 },
  ])
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(
  props: { teamId: number; showAll?: boolean; sourceId?: number } = { teamId: 8, showAll: true },
) {
  wrapper = mount(TeamInspectionRecords, {
    props,
    global: {
      stubs: {
        InspectionRegistrationDialog: true,
        AppDialog: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
        },
      },
    },
  })
  await flushPromises()
}
function button(text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)!
}
it('shows QC cross-team inspection records and rechecks without choosing the batch again', async () => {
  await render()
  expect(inspectionApi.records).toHaveBeenCalledWith(
    expect.objectContaining({ team_id: undefined }),
  )
  expect(wrapper.text()).toContain('待处理 · 禁止转出')
  await button('复检').trigger('click')
  expect(wrapper.getComponent(InspectionRegistrationDialog).props('recheck')).toEqual(record)
  expect(wrapper.getComponent(InspectionRegistrationDialog).props('inspectionTeamId')).toBe(8)
})
it('keeps production users read-only and scopes their record list', async () => {
  state.auth.currentUser = { team_id: 2, active: true }
  await render({ teamId: 2 })
  expect(inspectionApi.records).toHaveBeenCalledWith(expect.objectContaining({ team_id: 2 }))
  expect(button('巡检登记')).toBeUndefined()
  expect(button('复检')).toBeUndefined()
  await button('本批记录').trigger('click')
  await flushPromises()
  expect(inspectionApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ team_id: 2, source_transfer_id: 42 }),
  )
})
it('includes upstream checks when opened from a current stock lot', async () => {
  await render({ teamId: 8, sourceId: 42 })
  expect(inspectionApi.records).toHaveBeenCalledWith(
    expect.objectContaining({ team_id: undefined, source_transfer_id: 42, kind: undefined }),
  )
})
it('uses the same search and filters for records and export and retains them in fullscreen', async () => {
  await render()
  wrapper.getComponent(ElInput).vm.$emit('update:modelValue', '805881-5')
  await button('查询').trigger('click')
  await flushPromises()
  wrapper.getComponent(FilterDialog).vm.$emit('open')
  wrapper.getComponent(FilterDialog).vm.$emit('update:modelValue', true)
  await flushPromises()
  const selects = wrapper.findAllComponents(ElSelect)
  selects[0]!.vm.$emit('update:modelValue', 2)
  selects[1]!.vm.$emit('update:modelValue', 'pending')
  wrapper.getComponent(InspectionProblemFilter).vm.$emit('update:modelValue', 14)
  wrapper.getComponent(FilterDialog).vm.$emit('apply')
  await flushPromises()
  await wrapper.setProps({ fullscreen: true })
  const data = wrapper.getComponent(TableExportButton).props('source')()!
  const exported = await data.load(new AbortController().signal, () => {})
  expect(inspectionApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({
      team_id: 2,
      status: 'pending',
      query: '805881-5',
      problem_type_id: 14,
    }),
  )
  expect(exported[0]).toMatchObject({
    passed_quantity: 4,
    failed_quantity: 1,
    inspector_name: '王检验',
    processor_name: '李师傅',
    problems: '历史划伤名称',
  })
  expect(wrapper.find('input[aria-label="检查搜索"]').exists()).toBe(true)
  expect(wrapper.getComponent(ElPagination).props('total')).toBe(1)
  expect(wrapper.getComponent(FilterDialog).props('count')).toBe(3)
  await button('明细').trigger('click')
  expect(wrapper.text()).toContain('历史划伤名称')
})

it('offers disabled categories for historical queries and clears them on reset', async () => {
  await render()
  wrapper.getComponent(FilterDialog).vm.$emit('open')
  wrapper.getComponent(FilterDialog).vm.$emit('update:modelValue', true)
  await flushPromises()
  const picker = wrapper.getComponent(InspectionProblemFilter)
  const option = picker
    .findAllComponents({ name: 'ElOption' })
    .find((item) => item.props('value') === 14)!
  expect(option.props('label')).toBe('表面划伤（已停用）')
  expect(option.props('disabled')).toBe(false)
  picker.vm.$emit('update:modelValue', 14)
  wrapper.getComponent(FilterDialog).vm.$emit('apply')
  await flushPromises()
  wrapper.getComponent(FilterDialog).vm.$emit('reset')
  wrapper.getComponent(FilterDialog).vm.$emit('apply')
  await flushPromises()
  expect(inspectionApi.records).toHaveBeenLastCalledWith(
    expect.objectContaining({ problem_type_id: undefined }),
  )
})

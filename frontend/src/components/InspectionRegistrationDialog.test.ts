// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ElInputNumber } from 'element-plus'
import InspectionRegistrationDialog from './InspectionRegistrationDialog.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import { inspectionApi, type InspectionRecord } from '@/services/inspectionApi'

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
const source = {
  source_transfer_id: 42,
  team_id: 2,
  serial_no: '805881-5',
  batch_no: 'TL42',
  material_name: 'W80',
  specification: '30 × 20 × 2 mm',
  quantity: 100,
  revision: 3,
  hold_id: null,
  processing_status: 'complete',
}
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({
    isTeamAccount: true,
    currentUser: { team_id: 8, active: true },
    currentUserError: null,
  })
  vi.spyOn(inspectionApi, 'sources').mockResolvedValue({
    items: [source],
    total: 1,
    page: 1,
    page_size: 8,
  })
  vi.spyOn(inspectionApi, 'recheckContext').mockResolvedValue(source)
  vi.spyOn(inspectionApi, 'create').mockResolvedValue({ id: 1 } as InspectionRecord)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(recheck?: InspectionRecord) {
  wrapper = mount(InspectionRegistrationDialog, {
    props: { inspectionTeamId: 8, initialTeamId: 2, recheck },
    global: {
      stubs: {
        TeamEmployeeInput: true,
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
      },
    },
  })
  await flushPromises()
  if (!recheck) {
    await button('选择').trigger('click')
    await flushPromises()
  }
}
function button(text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)!
}
function fillCounts() {
  wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 5)
  wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 1)
}
function choosePerson() {
  wrapper
    .getComponent(TeamEmployeeInput)
    .vm.$emit('update:modelValue', { id: 9, name: '王检验', team_id: 8 })
}
it('requires the QC employee and counts, showing invalid fields without sending a request', async () => {
  await render()
  await button('保存巡检').trigger('click')
  expect(wrapper.findAll('.is-error').length).toBeGreaterThanOrEqual(2)
  expect(wrapper.getComponent(TeamEmployeeInput).props('invalid')).toBe(true)
  expect(inspectionApi.create).not.toHaveBeenCalled()
  expect(wrapper.getComponent(TeamEmployeeInput).props('teamId')).toBe(8)
})
it('submits selected lot, real inspector, revision, and samples while preserving retry identity', async () => {
  vi.mocked(inspectionApi.create).mockRejectedValueOnce(new Error('连接中断'))
  await render()
  fillCounts()
  choosePerson()
  await flushPromises()
  expect(wrapper.text()).toContain('抽检合格 4 件')
  await button('保存巡检').trigger('click')
  await flushPromises()
  const first = vi.mocked(inspectionApi.create).mock.calls[0]![0]
  expect(first).toMatchObject({
    source_transfer_id: 42,
    expected_revision: 3,
    inspector_employee_id: 9,
    sample_quantity: 5,
    failed_quantity: 1,
  })
  expect(first.checked_at).toMatch(/Z$/)
  expect(wrapper.text()).toContain('连接中断')
  await button('保存巡检').trigger('click')
  await flushPromises()
  expect(inspectionApi.create).toHaveBeenLastCalledWith(first)
  expect(wrapper.emitted('saved')).toHaveLength(1)
})
it('loads the held lot automatically for recheck and releases through the original record', async () => {
  vi.mocked(inspectionApi.sources).mockResolvedValue({
    items: [{ ...source, hold_id: 13 }],
    total: 1,
    page: 1,
    page_size: 8,
  })
  await render({ id: 13, team_id: 2, source_transfer_id: 42, batch_no: 'TL42' } as InspectionRecord)
  expect(wrapper.find('.inspection-source-picker').exists()).toBe(false)
  expect(inspectionApi.recheckContext).toHaveBeenCalledWith(13)
  expect(inspectionApi.sources).not.toHaveBeenCalled()
  choosePerson()
  wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 5)
  await flushPromises()
  await button('复检合格并放行').trigger('click')
  await flushPromises()
  expect(inspectionApi.create).toHaveBeenCalledWith(
    expect.objectContaining({ parent_id: 13, source_transfer_id: 42, failed_quantity: 0 }),
  )
})
it('cannot submit after the actor loses inspection-team permissions', async () => {
  await render()
  fillCounts()
  choosePerson()
  state.auth.isTeamAccount = false
  await flushPromises()
  expect(button('保存巡检').attributes('disabled')).toBeDefined()
  expect(inspectionApi.create).not.toHaveBeenCalled()
})

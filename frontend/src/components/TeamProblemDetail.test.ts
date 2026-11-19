// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import TeamProblemDetail from './TeamProblemDetail.vue'
import { qualityFeedbackApi, type TeamProblem } from '@/services/qualityFeedbackApi'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'

const auth = vi.hoisted(() => ({
  get isAdmin() {
    return this.currentUser.role === 'ADMIN'
  },
  currentUser: {
    active: true,
    role: 'ADMIN',
    team: {
      active: true,
      code: 'FACTORY-PROCESS',
      kind: 'engineering',
    },
  },
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => auth,
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    loaded: true,
    items: [{ id: 2, name: '轧制', code: 'FACTORY-ROLL', kind: 'production', active: true }],
  }),
}))
const report: TeamProblem = {
  id: 12,
  kind: 'team_report',
  serial_no: '691236-50',
  batch_no: 'TL-REWORK',
  source_transfer_id: 42,
  material_name: 'MoCu70',
  team_id: 2,
  team_name: '轧制',
  checked_at: '2026-11-15T08:00:00Z',
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
let wrapper: VueWrapper
async function render(value: TeamProblem) {
  vi.spyOn(qualityFeedbackApi, 'teamProblem').mockResolvedValue(value)
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({
    id: 12,
    state: 'published',
  } as ProcessRoute)
  wrapper = mount(TeamProblemDetail, {
    props: { routeId: 12 },
    global: {
      stubs: {
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        ProcessRouteEditor: {
          name: 'ProcessRouteEditor',
          props: ['route', 'viewOnly'],
          template: '<div class="route-editor" :data-readonly="viewOnly" />',
        },
      },
    },
  })
  await flushPromises()
}
afterEach(() => {
  wrapper?.unmount()
  auth.currentUser.role = 'ADMIN'
  auth.currentUser.team.code = 'FACTORY-PROCESS'
  auth.currentUser.team.kind = 'engineering'
  vi.restoreAllMocks()
})
it('shows the reporting team and lets administrators author the unfilled route', async () => {
  await render(report)
  expect(wrapper.text()).toContain('轧制')
  expect(wrapper.text()).toContain('待检验判定')
  expect(wrapper.text()).toContain('精轧后厚度偏大')
  expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['关闭', '确定返修班组'])
  expect(processRouteApi.detail).not.toHaveBeenCalled()
})
it.each([
  ['ADMIN', true],
  ['TEAM', true],
] as const)(
  'opens the exact linked route with the correct permissions for %s',
  async (role, readOnly) => {
    auth.currentUser.role = role
    auth.currentUser.team.code = 'FACTORY-ROLL'
    auth.currentUser.team.kind = 'production'
    await render({
      ...report,
      route_state: 'published',
      feedback_status: 'processing',
      rework_progress: { ...report.rework_progress, state: 'processing', completed_quantity: 8 },
    })
    expect(wrapper.text()).toContain('已指定返修班组')
    expect(wrapper.text()).toContain('8 / 20 件')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '查看返修安排')!
      .trigger('click')
    await flushPromises()
    expect(processRouteApi.detail).toHaveBeenCalledWith(12)
    expect(wrapper.get('.route-editor').attributes('data-readonly')).toBe(String(readOnly))
  },
)
it('distinguishes the reporting team from the suspected upstream team', async () => {
  await render({ ...report, involved_teams: [{ team_id: 3, name: '线切割', replied: true }] })
  expect(wrapper.text()).toContain('轧制')
  expect(wrapper.text()).toContain('疑似涉及班组')
  expect(wrapper.text()).toContain('线切割')
})
it('engineering can read an issue while QC assigns its repair team', async () => {
  auth.currentUser.role = 'TEAM'
  await render(report)
  expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('确定返修班组')
  wrapper.unmount()
  auth.currentUser.team.code = 'FACTORY-QC'
  await render(report)
  const select = wrapper.getComponent((await import('./AppSelect.vue')).default)
  select.vm.$emit('update:modelValue', 2)
  const assign = vi
    .spyOn(qualityFeedbackApi, 'assignTeamProblem')
    .mockResolvedValue({ ...report, route_state: 'published' })
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '确定返修班组')!
    .trigger('click')
  await flushPromises()
  expect(assign).toHaveBeenCalledWith(12, 2)
  expect(wrapper.text()).toContain('已指定返修班组')
})

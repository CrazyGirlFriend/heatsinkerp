// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ProcessRoutesPage from './ProcessRoutesPage.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture, reworkRouteFixture } from '@/testFixtures/processRoute'
import ReworkRoutePicker from '@/components/ReworkRoutePicker.vue'
const state = vi.hoisted(() => ({ admin: true }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAdmin: state.admin,
    isTeamAccount: !state.admin,
    currentUser: { id: 1, active: true, team_id: 2 },
    currentUserError: '',
  }),
}))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [{ id: 9, code: 'FACTORY-PROCESS', name: '工艺', kind: 'engineering', active: true }],
    refreshTeamDirectory: async () => {},
  }),
}))
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))
let wrapper: VueWrapper
beforeEach(() => {
  state.admin = true
  vi.spyOn(processRouteApi, 'list').mockResolvedValue({
    items: [
      {
        ...routeFixture,
        state: 'published',
        engineering_employee_id: 11,
        engineering_employee_name: '张工',
        modified_employee_id: 12,
        modified_employee_name: '李工',
        created_at: '2026-10-23T01:00:00Z',
        updated_at: '2026-10-24T02:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(ProcessRoutesPage, {
    global: {
      directives: { loading: () => {} },
      stubs: { TeamBusinessDialog: true, ProcessRouteEditor: true, ReworkRoutePicker: true },
    },
  })
  await flushPromises()
}
it('keeps the common workspace shell without a full-width single tab or duplicate time columns', async () => {
  await render()
  expect(wrapper.get('.team-workspace__title').text()).toBe('工艺工作台')
  expect(wrapper.get('nav[aria-label="工艺功能"]').attributes('style')).toContain('display: none')
  expect(wrapper.findAll('thead th .cell').map((cell) => cell.text())).toEqual([
    '流水号',
    '工艺类型',
    '工艺人员',
    '修改人员',
    '更新时间',
    '操作',
  ])
  expect(wrapper.text()).toContain('张工')
  expect(wrapper.text()).toContain('李工')
  expect(wrapper.text()).not.toContain('Word 原文核对')
  expect(wrapper.text()).not.toContain('首次转出前须')
})
it('searches only after submission and refreshes the applied query', async () => {
  await render()
  await wrapper.get('input[aria-label="工艺记录搜索"]').setValue(' S-001 ')
  await wrapper.get('input[aria-label="工艺记录搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('S-001', 1, undefined, 'desc', 20, 'all')
})
it('does not expose import or roster writes to a warehouse or production account', async () => {
  state.admin = false
  await render()
  expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  expect(wrapper.findAll('button').some((button) => button.text() === '班组设置')).toBe(false)
})
it('offers both types from new process and opens the normal form without an import stage', async () => {
  await render()
  const { ElDropdown } = await import('element-plus')
  expect(wrapper.findAll('button').some((button) => button.text() === '新建工艺')).toBe(true)
  wrapper.getComponent(ElDropdown).vm.$emit('command', 'normal')
  await flushPromises()
  expect(wrapper.find('process-route-editor-stub').exists()).toBe(true)
  expect(wrapper.find('input[type=file]').exists()).toBe(false)
})

it('opens the matching record by clicking its serial and has no workflow status column', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
  expect(wrapper.get('process-route-editor-stub').attributes('route')).toBeDefined()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
  expect(wrapper.findAll('thead th .cell').map((item) => item.text())).not.toContain('状态')
})
it('opens editing directly from its action and returns to read-only when a serial is clicked', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  const revise = vi.spyOn(processRouteApi, 'revise')
  const save = vi.spyOn(processRouteApi, 'save')
  await render()
  expect(wrapper.text()).not.toContain('查看工艺')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '修改工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(true)
  expect(revise).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  wrapper.getComponent(ProcessRouteEditor).vm.$emit('close')
  await flushPromises()
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
})
it('omits editing actions for a production account while keeping serial details available', async () => {
  state.admin = false
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  expect(wrapper.text()).not.toContain('修改工艺')
  expect(wrapper.findAll('thead th .cell').map((cell) => cell.text())).not.toContain('操作')
  await wrapper.get('button.route-serial').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
})
it('requests global time ordering and resets to page one on sort or size changes', async () => {
  await render()
  const { ElPagination } = await import('element-plus')
  wrapper.getComponent(ElPagination).vm.$emit('current-change', 3)
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 3, undefined, 'desc', 20, 'all')
  wrapper
    .getComponent({ name: 'ElTable' })
    .vm.$emit('sort-change', { prop: 'updated_at', order: 'ascending' })
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'asc', 20, 'all')
  wrapper.getComponent(ElPagination).vm.$emit('size-change', 50)
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'asc', 50, 'all')
  expect(wrapper.find('.el-pagination').exists()).toBe(true)
  expect(wrapper.getComponent(ElPagination).props('pageSizes')).toEqual([10, 20, 50, 100])
  expect(wrapper.getComponent(ElPagination).props('layout')).toContain('jumper')
})

it('keeps rework in the common list and can filter and open its engineering form directly', async () => {
  const { ElSelect } = await import('element-plus')
  const rework = {
    ...routeFixture,
    route_kind: 'rework' as const,
    state: 'draft' as const,
    rework_batch_no: 'TL-REWORK-1',
    rework_quantity: 4,
    rework_weight: 40,
  }
  await render()
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [rework],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(rework)
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'rework')
  wrapper.getComponent(ElSelect).vm.$emit('change', 'rework')
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith('', 1, undefined, 'desc', 20, 'rework')
  expect(wrapper.text()).toContain('TL-REWORK-1')
  expect(wrapper.text()).toContain('4 件 · 40 kg')
  expect(wrapper.text()).toContain('新建工艺')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '制定返工工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(true)
})

it('creates rework from the main page with the chosen batch and original work prefilled', async () => {
  const { ElDropdown } = await import('element-plus')
  await render()
  wrapper.getComponent(ElDropdown).vm.$emit('command', 'rework')
  await flushPromises()
  expect(wrapper.findComponent(ReworkRoutePicker).exists()).toBe(true)
  expect(wrapper.findComponent(ProcessRouteEditor).exists()).toBe(false)
  const pending = { ...reworkRouteFixture, state: 'draft' as const }
  wrapper.getComponent(ReworkRoutePicker).vm.$emit('selected', pending)
  await flushPromises()
  expect(wrapper.findComponent(ReworkRoutePicker).exists()).toBe(false)
  expect(wrapper.getComponent(ProcessRouteEditor).props()).toMatchObject({
    route: pending,
    startEditing: true,
  })
})

it('shows normal and rework rows together by default, with rework scope in the serial cell', async () => {
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [
      routeFixture,
      {
        ...reworkRouteFixture,
        rework_batch_no: 'TL-REWORK-1',
        rework_quantity: 4,
        rework_weight: 40,
      },
    ],
    total: 2,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  await render()
  expect(processRouteApi.list).toHaveBeenCalledWith('', 1, undefined, 'desc', 20, 'all')
  expect(wrapper.text()).toContain('正常工艺')
  expect(wrapper.text()).toContain('返工工艺')
  expect(wrapper.get('.rework-scope').text()).toBe('TL-REWORK-1 · 4 件 · 40 kg')
})

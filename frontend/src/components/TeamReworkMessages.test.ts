// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import TeamReworkMessages from './TeamReworkMessages.vue'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import { reworkNoticeApi } from '@/services/reworkNoticeApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: () => ({}) }))
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(reworkNoticeApi, 'list').mockResolvedValue({
    total: 1,
    unread: 1,
    items: [
      {
        id: 3,
        kind: 'requested',
        route_id: 12,
        state: 'draft',
        serial_no: 'S-1',
        batch_no: 'TL1',
        problem: '厚度超差',
        submitting_team: '研磨',
        submitted_by: '李工',
        engineering_employee_name: null,
        created_at: '2026-10-26T01:00:00Z',
        read_at: null,
      },
    ],
  })
  vi.spyOn(reworkNoticeApi, 'read').mockResolvedValue({})
  vi.spyOn(reworkNoticeApi, 'route').mockResolvedValue({
    ...reworkRouteFixture,
    id: 12,
    state: 'draft',
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(engineering = true) {
  wrapper = mount(TeamReworkMessages, {
    props: { teamId: 9, engineering },
    global: {
      stubs: {
        AppDialog: { template: '<section><slot /><slot name="footer" /></section>' },
        ProcessRouteEditor: true,
      },
    },
  })
  await flushPromises()
}
it('shows the submitting team and issue, persists read, and opens engineering on the same request', async () => {
  await render()
  expect(wrapper.find('button[aria-label="返工消息，1 条未读"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('研磨')
  expect(wrapper.text()).toContain('厚度超差')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '制定工艺')!
    .trigger('click')
  await flushPromises()
  expect(reworkNoticeApi.route).toHaveBeenCalledWith(3)
  expect(reworkNoticeApi.read).toHaveBeenCalledWith(3)
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(true)
  expect(wrapper.getComponent(ProcessRouteEditor).props('viewOnly')).toBe(false)
})
it('does not mark a message read if its route cannot be opened', async () => {
  vi.mocked(reworkNoticeApi.route).mockRejectedValue(new Error('网络中断'))
  await render()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '制定工艺')!
    .trigger('click')
  await flushPromises()
  expect(reworkNoticeApi.read).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('网络中断')
})
it('opens an engineering reply as read-only for the receiving team', async () => {
  await render(false)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '查看工艺')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(ProcessRouteEditor).props('viewOnly')).toBe(true)
  expect(wrapper.getComponent(ProcessRouteEditor).props('startEditing')).toBe(false)
})

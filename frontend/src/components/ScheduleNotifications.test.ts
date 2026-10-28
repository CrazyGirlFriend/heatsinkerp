// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElPagination } from 'element-plus'
import ScheduleNotifications from './ScheduleNotifications.vue'
import { scheduleNoticeApi, type ScheduleNotice } from '@/services/scheduleNoticeApi'
vi.mock('@/services/scheduleNoticeApi', () => ({
  scheduleNoticeApi: { list: vi.fn(), refresh: vi.fn(), read: vi.fn(), readAll: vi.fn() },
}))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: () => ({ request: vi.fn() }) }))
const notice: ScheduleNotice = {
  id: 8,
  kind: 'overdue',
  message: '第 2 批已过交期 · 10-27 14:00',
  serial_no: '805881-5',
  team_name: '轧制',
  created_at: '2026-10-27T06:01:00Z',
  read_at: null,
  href: '/team-workspaces/2?tab=delivery-schedule&schedule_id=12',
}
const result = { items: [notice], total: 1, unread: 1, latest_id: 8 }
const wrappers: ReturnType<typeof mount>[] = []
async function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/production-schedules')
  await router.isReady()
  const wrapper = mount(ScheduleNotifications, {
    props: { teamId: 2 },
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        AppDrawer: {
          props: ['modelValue'],
          template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(scheduleNoticeApi.list).mockResolvedValue({ ...result })
  vi.mocked(scheduleNoticeApi.refresh).mockResolvedValue(undefined)
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})
describe('schedule inbox', () => {
  it('shows unread count, opens the correct team plan and marks only the opened notice', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.get('.notice-trigger').attributes('aria-label')).toContain('1 条未读')
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('第 2 批已过交期')
    await wrapper.get('.inbox-serial').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/team-workspaces/2')
    expect(router.currentRoute.value.query).toMatchObject({
      tab: 'delivery-schedule',
      schedule_id: '12',
    })
    expect(scheduleNoticeApi.read).toHaveBeenCalledWith(8)
    expect(scheduleNoticeApi.refresh).toHaveBeenCalledTimes(1)
  })
  it('filters unread, pages the inbox and uses the last loaded watermark for read-all', async () => {
    vi.mocked(scheduleNoticeApi.list).mockResolvedValue({ ...result, total: 42 })
    const { wrapper } = await setup()
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    await wrapper.findAll('.inbox-tabs button')[1]!.trigger('click')
    await flushPromises()
    expect(scheduleNoticeApi.list).toHaveBeenLastCalledWith(1, true)
    wrapper.getComponent(ElPagination).vm.$emit('update:current-page', 2)
    await flushPromises()
    expect(scheduleNoticeApi.list).toHaveBeenLastCalledWith(2, true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '全部已读')!
      .trigger('click')
    await flushPromises()
    expect(scheduleNoticeApi.readAll).toHaveBeenCalledWith(8)
  })
  it('reports a failed refresh without marking messages read or losing the last badge', async () => {
    const { wrapper } = await setup()
    vi.mocked(scheduleNoticeApi.list).mockRejectedValueOnce(new Error('连接中断'))
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('连接中断')
    expect(wrapper.get('.notice-trigger').attributes('aria-label')).toContain('1 条未读')
    expect(scheduleNoticeApi.read).not.toHaveBeenCalled()
  })
  it('ignores a response after the account component unmounts', async () => {
    let resolve: (value: typeof result) => void = () => {}
    vi.mocked(scheduleNoticeApi.list).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const { wrapper } = await setup()
    wrapper.unmount()
    resolve(result)
    await flushPromises()
    expect(scheduleNoticeApi.read).not.toHaveBeenCalled()
  })
})

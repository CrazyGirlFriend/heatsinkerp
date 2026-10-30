// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElCheckbox, ElPagination } from 'element-plus'
import ScheduleNotifications from './ScheduleNotifications.vue'
import { scheduleNoticeApi } from '@/services/scheduleNoticeApi'
import { businessNoticeApi, type BusinessNotice } from '@/services/businessNoticeApi'
import { noticeOpened, noticeFailed } from '@/utils/noticeFocus'
vi.mock('@/services/scheduleNoticeApi', () => ({
  scheduleNoticeApi: { list: vi.fn(), refresh: vi.fn(), read: vi.fn(), readAll: vi.fn() },
}))
vi.mock('@/services/businessNoticeApi', async (original) => ({
  ...(await original<object>()),
  businessNoticeApi: { list: vi.fn(), target: vi.fn(), read: vi.fn(), readAll: vi.fn() },
}))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: () => ({ request: vi.fn() }) }))
const notice: BusinessNotice = {
  id: 8,
  source: 'schedule',
  batch_no: null,
  kind: 'overdue',
  message: '第 2 批已过交期 · 10-27 14:00',
  serial_no: '805881-5',
  team_name: '轧制',
  created_at: '2026-10-27T06:01:00Z',
  read_at: null,
}
const result = { items: [notice], total: 1, unread: 1, latest: { schedule: 8, rework: 3 } }
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
  vi.mocked(businessNoticeApi.target).mockResolvedValue({
    href: '/team-workspaces/2?tab=delivery-schedule&schedule_id=12',
    schedule_id: 12,
    batch_id: 2,
  })
  vi.mocked(businessNoticeApi.list).mockResolvedValue({ ...result })
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
    expect(businessNoticeApi.read).not.toHaveBeenCalled()
    noticeOpened(String(router.currentRoute.value.query.notice))
    await flushPromises()
    expect(businessNoticeApi.read).toHaveBeenCalledWith('schedule', 8)
    expect(scheduleNoticeApi.refresh).toHaveBeenCalledTimes(1)
  })
  it('filters unread, pages the inbox and uses the last loaded watermark for read-all', async () => {
    vi.mocked(businessNoticeApi.list).mockResolvedValue({ ...result, total: 42 })
    const { wrapper } = await setup()
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    wrapper.getComponent(ElCheckbox).vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(businessNoticeApi.list).toHaveBeenLastCalledWith(1, true, 'all')
    wrapper.getComponent(ElPagination).vm.$emit('update:current-page', 2)
    await flushPromises()
    expect(businessNoticeApi.list).toHaveBeenLastCalledWith(2, true, 'all')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '全部已读')!
      .trigger('click')
    await flushPromises()
    expect(businessNoticeApi.readAll).toHaveBeenCalledWith({ schedule: 8, rework: 3 })
  })
  it('opens a whole message row and distinguishes matching IDs from different sources', async () => {
    vi.mocked(businessNoticeApi.list).mockResolvedValue({
      ...result,
      total: 2,
      items: [
        notice,
        {
          ...notice,
          source: 'rework',
          kind: 'requested',
          message: '厚度超差',
          read_at: notice.created_at,
        },
      ],
    })
    const { wrapper } = await setup()
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('button.inbox-item')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.attributes('aria-label')).toContain('未读')
    expect(rows[1]!.attributes('aria-label')).not.toContain('未读')
    expect(rows[0]!.find('.inbox-unread-dot').exists()).toBe(true)
    expect(rows[1]!.find('.inbox-unread-dot').exists()).toBe(false)
    await rows[1]!.get('.inbox-message').trigger('click')
    await flushPromises()
    expect(businessNoticeApi.target).toHaveBeenCalledWith('rework', 8)
  })
  it('reports a failed refresh without marking messages read or losing the last badge', async () => {
    const { wrapper } = await setup()
    vi.mocked(businessNoticeApi.list).mockRejectedValueOnce(new Error('连接中断'))
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('连接中断')
    expect(wrapper.get('.notice-trigger').attributes('aria-label')).toContain('1 条未读')
    expect(businessNoticeApi.read).not.toHaveBeenCalled()
  })
  it('filters rework and keeps failed destinations unread', async () => {
    vi.mocked(businessNoticeApi.list).mockResolvedValue({
      ...result,
      items: [{ ...notice, source: 'rework', kind: 'requested', message: '厚度超差' }],
    })
    vi.mocked(businessNoticeApi.target).mockResolvedValue({
      href: '/process-routes?rework_notice=8',
      section: 'problem',
    })
    const { wrapper, router } = await setup()
    await wrapper.get('.notice-trigger').trigger('click')
    await flushPromises()
    await wrapper.findAll('.inbox-tabs button')[1]!.trigger('click')
    await flushPromises()
    expect(businessNoticeApi.list).toHaveBeenLastCalledWith(1, false, 'rework')
    await wrapper.get('.inbox-serial').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/process-routes')
    noticeOpened('stale-navigation')
    expect(businessNoticeApi.read).not.toHaveBeenCalled()
    noticeFailed(String(router.currentRoute.value.query.notice), new Error('工艺读取失败'))
    await flushPromises()
    expect(wrapper.text()).toContain('工艺读取失败')
    expect(businessNoticeApi.read).not.toHaveBeenCalled()
  })
  it('ignores a response after the account component unmounts', async () => {
    let resolve: (value: typeof result) => void = () => {}
    vi.mocked(businessNoticeApi.list).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const { wrapper } = await setup()
    wrapper.unmount()
    resolve(result)
    await flushPromises()
    expect(businessNoticeApi.read).not.toHaveBeenCalled()
  })
})

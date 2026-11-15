// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed } from 'vue'
import PublishedProcessRoutePicker from './PublishedProcessRoutePicker.vue'
import AppDialog from './AppDialog.vue'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'

vi.mock('@/services/processRouteApi', () => ({
  processRouteApi: { list: vi.fn(), detail: vi.fn() },
}))
const pending = {
  ...reworkRouteFixture,
  state: 'draft' as const,
  rework_request: {
    ...reworkRouteFixture.rework_request!,
    requesting_team_name: '研磨',
    problem_names: ['尺寸偏差'],
  },
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [pending],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.mocked(processRouteApi.detail).mockResolvedValue(pending)
})
afterEach(() => {
  wrapper?.unmount()
  vi.clearAllMocks()
})
async function render() {
  wrapper = mount(PublishedProcessRoutePicker, {
    props: { pendingRework: true },
    global: {
      provide: { [workspaceAppearanceKey as symbol]: computed(() => 'watermelon') },
      stubs: { teleport: true },
    },
  })
  await flushPromises()
}
async function choose() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '制定')!
    .trigger('click')
  await flushPromises()
}
it('selects only pending rework and returns the complete submitted issue to the editor', async () => {
  await render()
  expect(wrapper.text()).toContain('选择返工问题')
  expect(wrapper.text()).toContain('尺寸偏差')
  expect(wrapper.text()).toContain('研磨')
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    '',
    1,
    'draft',
    'desc',
    20,
    'rework',
    'open',
    undefined,
  )
  await choose()
  expect(processRouteApi.detail).toHaveBeenCalledWith(pending.id)
  expect(wrapper.emitted('selected')).toEqual([[pending]])
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
})
it('keeps the picker open if another user has already published the selected draft', async () => {
  vi.mocked(processRouteApi.detail).mockResolvedValue(reworkRouteFixture)
  await render()
  await choose()
  expect(wrapper.emitted('selected')).toBeUndefined()
  expect(wrapper.text()).toContain('该问题的返工工艺已制定，请刷新后重新选择')
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(true)
})
it('shows an empty pending list without opening an unrelated normal route', async () => {
  vi.mocked(processRouteApi.list).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  await render()
  expect(wrapper.text()).toContain('暂无待制定的返工问题')
  expect(wrapper.findAll('button').some((button) => button.text() === '制定')).toBe(false)
  expect(processRouteApi.detail).not.toHaveBeenCalled()
})
it('allows retrying a failed detail request without losing the selected problem', async () => {
  vi.mocked(processRouteApi.detail).mockRejectedValueOnce(new Error('工艺读取失败'))
  await render()
  await choose()
  expect(wrapper.text()).toContain('工艺读取失败')
  expect(wrapper.emitted('selected')).toBeUndefined()
  await choose()
  expect(wrapper.emitted('selected')).toEqual([[pending]])
})

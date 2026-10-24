// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSelect } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProcessRouteLotDialog from './ProcessRouteLotDialog.vue'
import AppDialog from './AppDialog.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'

let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(processRouteApi, 'lot').mockResolvedValue({ current: null, route: null })
  vi.spyOn(processRouteApi, 'list').mockResolvedValue({
    items: [{ ...routeFixture, state: 'published' }],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.spyOn(processRouteApi, 'bind').mockResolvedValue({})
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(ProcessRouteLotDialog, {
    props: { lotId: 12, canBind: true },
    global: {
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div><slot/><slot name="footer"/></div>',
        },
        ProcessRouteSteps: true,
      },
    },
  })
  await flushPromises()
}
async function select(id: number) {
  const selector = wrapper.getComponent(ElSelect)
  selector.vm.$emit('update:modelValue', id)
  selector.vm.$emit('change', id)
  await flushPromises()
}
function bindButton() {
  return wrapper.findAll('button').find((button) => button.text() === '关联本批次')!
}

it('requires the chosen route preview to load before binding and clears an older preview on failure', async () => {
  vi.spyOn(processRouteApi, 'detail')
    .mockResolvedValueOnce({ ...routeFixture, state: 'published' })
    .mockRejectedValueOnce(new Error('所选工艺读取失败'))
  await render()
  await select(8)
  expect(wrapper.text()).toContain('首批派工')
  expect(bindButton().attributes('disabled')).toBeUndefined()
  await select(9)
  expect(wrapper.text()).toContain('所选工艺读取失败')
  expect(wrapper.find('h3').exists()).toBe(false)
  expect(wrapper.getComponent(ElSelect).props('modelValue')).toBeUndefined()
  expect(bindButton().attributes('disabled')).toBeDefined()
  await bindButton().trigger('click')
  expect(processRouteApi.bind).not.toHaveBeenCalled()
})

it('binds only the selected route after its matching preview has loaded', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  await render()
  await select(8)
  await bindButton().trigger('click')
  await flushPromises()
  expect(processRouteApi.bind).toHaveBeenCalledOnce()
  expect(processRouteApi.bind).toHaveBeenCalledWith(8, 12)
  expect(wrapper.emitted('changed')).toEqual([[]])
})

it('does not allow choosing or binding until the current lot has been checked', async () => {
  let finish!: (value: { current: null; route: null }) => void
  vi.mocked(processRouteApi.lot).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  await render()
  expect(wrapper.getComponent(ElSelect).props('disabled')).toBe(true)
  expect(bindButton().attributes('disabled')).toBeDefined()
  finish({ current: null, route: null })
  await flushPromises()
  expect(wrapper.getComponent(ElSelect).props('disabled')).toBe(false)
})

it('retains the route dialog until its closing transition finishes', async () => {
  await render()
  const dialog = wrapper.getComponent(AppDialog)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '关闭')!
    .trigger('click')
  expect(dialog.props('modelValue')).toBe(false)
  expect(wrapper.emitted('close')).toBeUndefined()
  dialog.vm.$emit('closed')
  expect(wrapper.emitted('close')).toEqual([[]])
})

it('keeps close controls disabled while a route is being bound', async () => {
  let finish!: (value: unknown) => void
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  vi.mocked(processRouteApi.bind).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
  await render()
  await select(8)
  await bindButton().trigger('click')
  const dialog = wrapper.getComponent(AppDialog)
  expect(dialog.attributes('close-on-press-escape')).toBe('false')
  expect(dialog.attributes('close-on-click-modal')).toBe('false')
  expect(dialog.attributes('show-close')).toBe('false')
  expect(
    wrapper
      .findAll('button')
      .find((button) => button.text() === '关闭')!
      .attributes('disabled'),
  ).toBeDefined()
  finish({})
  await flushPromises()
  expect(dialog.attributes('show-close')).toBe('true')
})

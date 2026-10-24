// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReworkRoutePicker from './ReworkRoutePicker.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'

const pending = {
  ...reworkRouteFixture,
  state: 'draft' as const,
  rework_batch_no: 'TL-REWORK-1',
  rework_quantity: 4,
  rework_weight: 40,
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(processRouteApi, 'list').mockResolvedValue({
    items: [pending],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(pending)
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(ReworkRoutePicker, {
    global: { stubs: { AppDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
}
async function choose() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '选择')!
    .trigger('click')
  await flushPromises()
}
it('lists only pending rework scopes and reloads the chosen instructions before opening', async () => {
  await render()
  expect(processRouteApi.list).toHaveBeenCalledWith('', 1, 'draft', 'desc', 20, 'rework')
  expect(wrapper.text()).toContain('TL-REWORK-1')
  await choose()
  expect(processRouteApi.detail).toHaveBeenCalledWith(27)
  expect(wrapper.emitted('selected')).toEqual([[pending]])
})
it('searches rework by batch and refuses a request already authored by another engineer', async () => {
  await render()
  await wrapper.get('input[aria-label="返工批次搜索"]').setValue(' TL-REWORK-1 ')
  await wrapper.get('input[aria-label="返工批次搜索"]').trigger('keyup', { key: 'Enter' })
  await flushPromises()
  expect(processRouteApi.list).toHaveBeenLastCalledWith(
    'TL-REWORK-1',
    1,
    'draft',
    'desc',
    20,
    'rework',
  )
  vi.mocked(processRouteApi.detail).mockResolvedValue(reworkRouteFixture)
  await choose()
  expect(wrapper.emitted('selected')).toBeUndefined()
  expect(wrapper.text()).toContain('本批返工工艺已制定')
})

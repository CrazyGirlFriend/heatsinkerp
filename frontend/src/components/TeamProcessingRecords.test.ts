// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElPagination } from 'element-plus'
import TeamProcessingRecords from './TeamProcessingRecords.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { ProcessingRecord } from '@/types/materialProcessing'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: { value: '' }, request: refresh } } }))
const record = (id = 1): ProcessingRecord => ({ id, source_transfer_id: 10, serial_no: 'YS-007', batch_no: 'TL001',
  material_name: '材料1', material_type: 'semi_finished', purpose_name: '切割业务1',
  before_quantity: 1, after_quantity: 20, delta_quantity: 19, weight: 100, reason: '切割为20件',
  created_by: '线切割班组长', created_at: '2026-10-09T01:00:00Z', on_hand_quantity: 12, on_hand_weight: 60,
  in_transit_quantity: 0, in_transit_weight: 0, processing_state: 'registered' })
let wrapper: VueWrapper
beforeEach(() => { vi.spyOn(teamMaterialApi, 'processingRecords').mockResolvedValue({ items: [record()], total: 21, page: 1, page_size: 10 }) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canWrite = true, path = '/team-workspaces/5?tab=processing') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/team-workspaces/:teamId', component: { template: '<div/>' } }] })
  await router.push(path)
  wrapper = mount(TeamProcessingRecords, { props: { teamId: 5, canWrite }, global: { plugins: [router], stubs: { QuantityAdjustmentDialog: true } } })
  await flushPromises()
  return router
}

describe('cutting processing records', () => {
  it('separates registered pieces from the current twelve-piece inventory', async () => {
    await render()
    expect(wrapper.text()).toContain('加工前件数')
    expect(wrapper.text()).toContain('加工后件数')
    expect(wrapper.text()).toContain('当前未转出件数')
    expect(wrapper.text()).toContain('已登记加工 · 未转出')
    const headings = wrapper.findAll('thead th').map(cell => cell.text())
    const cells = wrapper.find('tbody tr').findAll('td')
    expect(['加工前件数', '加工后件数', '当前未转出件数'].map(label => cells[headings.indexOf(label)]!.text())).toEqual(['1', '20', '12'])
    await wrapper.findAll('button').find(button => button.text() === '加工登记')!.trigger('click')
    expect(wrapper.emitted('register')).toHaveLength(1)
  })
  it('preserves filters on pagination and offers records to read-only administrators', async () => {
    const router = await render(false, '/team-workspaces/5?tab=processing&query=YS-007&date_from=2026-10-01&date_to=2026-10-09')
    expect(wrapper.findAll('button').some(button => button.text() === '加工登记')).toBe(false)
    wrapper.getComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'processing', query: 'YS-007', page: '2', date_from: '2026-10-01' })
    expect(teamMaterialApi.processingRecords).toHaveBeenLastCalledWith(5, expect.objectContaining({ page: 2, query: 'YS-007' }))
    await wrapper.findAll('button').find(button => button.text() === '记录')!.trigger('click')
    expect(wrapper.getComponent(QuantityAdjustmentDialog).props()).toMatchObject({ sourceId: 10, canWrite: false, processing: true, modelValue: true })
  })
  it('uses a fixed table header in fullscreen and retains results on failed live refresh', async () => {
    await render()
    await wrapper.setProps({ fullscreen: true })
    expect(wrapper.getComponent({ name: 'ElTable' }).props()).toMatchObject({ height: '100%', flexible: true })
    vi.mocked(teamMaterialApi.processingRecords).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow('offline')
    expect(wrapper.text()).toContain('YS-007')
  })
  it('ignores a response from the previous team', async () => {
    await render()
    let finish!: (result: Awaited<ReturnType<typeof teamMaterialApi.processingRecords>>) => void
    vi.mocked(teamMaterialApi.processingRecords).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const refresh = live.refresh()
    vi.mocked(teamMaterialApi.processingRecords).mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 10 })
    await wrapper.setProps({ teamId: 6 }); await flushPromises()
    finish({ items: [record()], total: 1, page: 1, page_size: 10 }); await refresh; await flushPromises()
    expect(wrapper.text()).not.toContain('YS-007')
  })
})

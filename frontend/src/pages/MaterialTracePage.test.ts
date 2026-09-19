// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPinia } from '@/stores/access'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import MaterialTracePage from './MaterialTracePage.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import type { MaterialTrace, TraceBatch } from '@/types/materialTrace'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks() })
function record(id: number): TraceBatch {
  return { ...normalizeMaterialTransfer({ id, batch_no: 'TL-' + id, serial_no: '000012', source_transfer_id: id > 1 ? 1 : null,
    source_team: { id: 2, name: '检验' }, next_team: { id: 1, name: '库房' }, quantity: 10, weight: 1,
    created_at: '2026-09-19T01:00:00Z', status: 'received' }), on_hand_quantity: 6, on_hand_weight: .6 }
}
function response(items = [record(1)]): MaterialTrace {
  return { serial_no: '000012', items, untracked_count: 0,
    positions: [{ team_id: 1, team_name: '库房', quantity: 6, weight: .6, batch_count: 1 }],
    totals: { on_hand: { quantity: 6, weight: .6 }, in_transit: { quantity: 4, weight: .4 }, external_pending: { quantity: 0, weight: 0 }, dispatched: { quantity: 0, weight: 0 }, lost: { quantity: 0, weight: 0 } } }
}
async function render(path = '/material-trace?serial_no=000012') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/material-trace', component: MaterialTracePage },
    { path: '/team-workspaces/:teamId', component: { template: '<div />' } },
  ] })
  await router.push(path)
  wrapper = mount(MaterialTracePage, { global: { plugins: [appPinia, router], stubs: { MaterialTransferDrawer: true } } })
  await flushPromises()
  return { page: wrapper, router }
}

describe('full serial trace and separate team scope', () => {
  it('loads the exact serial and refreshes the applied query without replacing its draft or graph', async () => {
    vi.spyOn(materialTransferApi, 'trace').mockResolvedValue(response())
    const { page } = await render()
    const chain = page.get('.trace-chain').element
    expect(materialTransferApi.trace).toHaveBeenCalledWith('000012')
    await page.get('input[aria-label="流水号"]').setValue('NOT-SUBMITTED')
    vi.mocked(materialTransferApi.trace).mockResolvedValue(response([record(1), record(2)]))
    await live.refresh(); await flushPromises()
    expect(page.get('.trace-chain').element).toBe(chain)
    expect(page.text()).toContain('TL-2')
    expect(materialTransferApi.trace).toHaveBeenLastCalledWith('000012')
    expect(page.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'NOT-SUBMITTED')
    vi.mocked(materialTransferApi.trace).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    expect(page.get('.trace-chain').element).toBe(chain)
  })
  it('shows all stock positions and opens the actual selected batch, not a latest-position summary', async () => {
    const data = response([record(1), record(2), record(3)])
    data.positions.push({ team_id: 2, team_name: '检验', quantity: 4, weight: .4, batch_count: 1 })
    vi.spyOn(materialTransferApi, 'trace').mockResolvedValue(data)
    const { page } = await render()
    expect(page.findAll('.trace-locations button')).toHaveLength(2)
    expect(page.findAll('.batch-node')).toHaveLength(3)
    expect(page.text()).not.toContain('最近确认位置')
    await page.findAll('.batch-node')[0]!.trigger('click')
    expect(page.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, batchNo: 'TL-2' })
    expect(page.find('table').exists()).toBe(false)
  })
  it('highlights dates but retains every branch and current stock', async () => {
    vi.spyOn(materialTransferApi, 'trace').mockResolvedValue(response([record(1), record(2)]))
    const { page, router } = await render()
    page.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-18', to: '2026-09-18' })
    await flushPromises()
    expect(router.currentRoute.value.query.date_from).toBe('2026-09-18')
    expect(page.findAll('.batch-node')).toHaveLength(2)
    expect(page.findAll('.batch-node.dimmed')).toHaveLength(2)
    expect(materialTransferApi.trace).toHaveBeenCalledTimes(1)
    expect(page.text()).toContain('保留完整来源链路')
  })
  it('keeps external shipment outside inventory and labels external destination', async () => {
    const shipment = { ...record(2), ...normalizeMaterialTransfer({ ...record(2), entry_kind: 'inspection_shipment', external_destination: '外部客户仓', next_team: null, status: 'dispatched' }), on_hand_quantity: null, on_hand_weight: null }
    vi.spyOn(materialTransferApi, 'trace').mockResolvedValue(response([record(1), shipment]))
    const { page } = await render()
    const node = page.findAll('.batch-node').find(node => node.text().includes('TL-2'))!
    expect(node.text()).toContain('已发货')
    expect(node.text()).toContain('外部客户仓')
    expect(node.text()).not.toContain('结存')
  })
  it('routes old scoped URLs to the local page without issuing a global request', async () => {
    vi.spyOn(materialTransferApi, 'trace')
    const { router } = await render('/material-trace?serial_no=000012&team_id=2&direction=outgoing&date_from=2026-09-18')
    expect(router.currentRoute.value.path).toBe('/team-workspaces/2')
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'history', serial_no: '000012', direction: 'outgoing', date_from: '2026-09-18' })
    expect(materialTransferApi.trace).not.toHaveBeenCalled()
  })
  it('does not widen invalid team links to a global query', async () => {
    vi.spyOn(materialTransferApi, 'trace')
    const { page } = await render('/material-trace?serial_no=000012&team_id=oops')
    expect(materialTransferApi.trace).not.toHaveBeenCalled()
    expect(page.text()).toContain('无效的班组范围')
  })
  it('ignores a late result after switching serials and retains leading zeroes', async () => {
    let finish!: (value: MaterialTrace) => void
    vi.spyOn(materialTransferApi, 'trace').mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue({ ...response(), serial_no: '000099' })
    const { page, router } = await render()
    await router.push('/material-trace?serial_no=000099'); await flushPromises()
    finish(response()); await flushPromises()
    expect(page.get('.trace-identity h2').text()).toBe('000099')
    expect(materialTransferApi.trace).toHaveBeenLastCalledWith('000099')
  })
})

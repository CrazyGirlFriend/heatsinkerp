// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPinia } from '@/stores/access'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import MaterialTracePage from './MaterialTracePage.vue'
const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks() })
function record(id: number) { return normalizeMaterialTransfer({ id, batch_no: `TL-${id}`, serial_no: 'FLOW-1', source_team: { id, name: `班组${id}` }, next_team: { id: 1, name: '库房' }, quantity: 1, weight: 0, status: 'pending' }) }
async function render(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/material-trace', component: MaterialTracePage }] })
  await router.push(path)
  wrapper = mount(MaterialTracePage, { global: { plugins: [appPinia, router], stubs: { MaterialTransferDrawer: true } } })
  await flushPromises()
  return { page: wrapper, router }
}

describe('team-scoped material trace', () => {
  it('updates the searched serial in place, not the unsubmitted search draft', async () => {
    vi.spyOn(materialTransferApi, 'list').mockResolvedValue({ items: [record(1)], total: 1, page: 1, page_size: 100 })
    const { page, router } = await render('/material-trace?serial_no=FLOW-1&team_id=2&direction=outgoing')
    const chain = page.get('.trace-chain').element
    await page.get('input[aria-label="流水号"]').setValue('NOT-SUBMITTED')
    vi.mocked(materialTransferApi.list).mockResolvedValue({ items: [record(1), record(2)], total: 2, page: 1, page_size: 100 })
    await live.refresh(); await flushPromises()
    expect(page.get('.trace-chain').element).toBe(chain)
    expect(page.text()).toContain('TL-2')
    expect(router.currentRoute.value.query.serial_no).toBe('FLOW-1')
    expect(page.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'NOT-SUBMITTED')
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ serial_no: 'FLOW-1', team_id: 2, direction: 'outgoing' }))
    vi.mocked(materialTransferApi.list).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    await flushPromises(); expect(page.get('.trace-chain').element).toBe(chain)
  })
  it('shows a terminal external shipment at its destination without implying another team receipt', async () => {
    vi.spyOn(materialTransferApi, 'list').mockResolvedValue({ items: [normalizeMaterialTransfer({ ...record(1), entry_kind: 'inspection_shipment', external_destination: '外部客户仓', next_team: null, status: 'dispatched', dispatched_by: '检验确认人', dispatched_at: '2026-09-07T01:00:00Z' })], total: 1, page: 1, page_size: 100 })
    const { page } = await render('/material-trace?serial_no=FLOW-1')
    expect(page.text()).toContain('已发货'); expect(page.text()).toContain('外部去向：外部客户仓')
    expect(page.text()).toContain('检验确认人'); expect(page.text()).not.toContain('等待外部客户仓确认接收')
    expect(page.get('.chain-item').text()).not.toContain('已接收')
  })
  it('includes a warehouse intake root with an explicit origin and stock status', async () => {
    vi.spyOn(materialTransferApi, 'list').mockResolvedValue({ items: [normalizeMaterialTransfer({ ...record(1), entry_kind: 'warehouse_receipt', source_team: null, status: 'received', locked: true })], total: 1, page: 1, page_size: 100 })
    const { page } = await render('/material-trace?serial_no=FLOW-1')
    expect(page.text()).toContain('入库来源：库房手工入库')
    expect(page.text()).toContain('最近已入库')
    expect(page.text()).not.toContain('未配置班组')
  })
  it('keeps team and direction on every page of a serial trace and in its URL', async () => {
    vi.spyOn(materialTransferApi, 'list').mockResolvedValueOnce({ items: [record(2)], total: 2, page: 1, page_size: 100 }).mockResolvedValueOnce({ items: [record(3)], total: 2, page: 2, page_size: 100 })
    const { page, router } = await render('/material-trace?serial_no=FLOW-1&team_id=2&direction=outgoing')
    expect(materialTransferApi.list).toHaveBeenCalledTimes(2)
    for (const [params] of vi.mocked(materialTransferApi.list).mock.calls) expect(params).toMatchObject({ serial_no: 'FLOW-1', team_id: 2, direction: 'outgoing', page_size: 100 })
    expect(router.currentRoute.value.query).toMatchObject({ team_id: '2', direction: 'outgoing' })
    expect(page.text()).toContain('所选班组范围内的最近流转状态')
    expect(page.text()).toContain('TL-2')
  })

  it('replaces a slow prior team query with the newly selected team', async () => {
    let finish!: (value: Awaited<ReturnType<typeof materialTransferApi.list>>) => void
    vi.spyOn(materialTransferApi, 'list').mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue({ items: [record(3)], total: 1, page: 1, page_size: 100 })
    const { page, router } = await render('/material-trace?serial_no=FLOW-1&team_id=2&direction=outgoing')
    await router.push('/material-trace?serial_no=FLOW-1&team_id=3&direction=incoming'); await flushPromises()
    finish({ items: [record(2)], total: 1, page: 1, page_size: 100 }); await flushPromises()
    expect(materialTransferApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ team_id: 3, direction: 'incoming' }))
    expect(page.text()).toContain('TL-3')
    expect(page.text()).not.toContain('TL-2')
  })

  it('does not turn an invalid team link into an unscoped global search', async () => {
    vi.spyOn(materialTransferApi, 'list')
    const { page } = await render('/material-trace?serial_no=FLOW-1&team_id=oops')
    expect(materialTransferApi.list).not.toHaveBeenCalled()
    expect(page.text()).toContain('无效的班组范围')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import TeamSerialHistory from './TeamSerialHistory.vue'
import TeamFlowTimeline from './TeamFlowTimeline.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { SerialHistory, SerialHistoryGroup } from '@/types/teamBusiness'

const live = vi.hoisted(() => ({ refresh: undefined as undefined | (() => Promise<void>) }))
vi.mock('@/composables/useLiveRefresh', () => ({ useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }))
const group = (name: string): SerialHistoryGroup => ({ key: name, name, purpose_id: 1, incoming_quantity: 10, incoming_weight: 1, outgoing_quantity: 4, outgoing_weight: .4, lost_quantity: 0, lost_weight: 0, on_hand_quantity: 6, on_hand_weight: .6, baseline_quantity: 0, baseline_weight: 0, events: [{ id: 'event-1', at: '2026-09-18T01:00:00Z', kind: 'outgoing', batch_no: 'TL1', source_batch_no: 'TL0', counterpart: '库房', material_type: 'finished', source_material_type: 'semi_finished', quantity: 4, weight: .4, delta_quantity: -4, delta_weight: -.4, balance_quantity: 6, balance_weight: .6, status: 'pending' }] })
const result = (): SerialHistory => ({ serial_no: '000012', team_name: '检验', found: true, groups: [group('检验'), group('去毛刺')], date_from: null, date_to: null, pending_incoming_count: 1, untracked_count: 0,
  flows: [{ id: 'outgoing-1', group_key: '检验', direction: 'outgoing', batch_no: 'TL1', at: '2026-09-18T01:00:00Z', from_name: '检验', to_name: '库房', quantity: 4, weight: .4, status: 'pending', entry_kind: 'transfer' }] })
let wrapper: VueWrapper
beforeEach(() => { vi.spyOn(teamMaterialApi, 'serialHistory').mockResolvedValue(result()) })
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(query = '') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/material-trace', component: { template: '<div />' } }] })
  await router.push('/'+query); await router.isReady()
  wrapper = mount(TeamSerialHistory, { props: { teamId: 2 }, global: { plugins: [router], stubs: { TeamFlowTimeline: true, MaterialTransferDrawer: true, ElDrawer: { template: '<div><slot /></div>' } } } })
  await flushPromises()
}
async function search(serial = '000012') { await wrapper.get('input[aria-label="历史流水号"]').setValue(serial); await wrapper.get('form').trigger('submit'); await flushPromises() }

describe('team serial history', () => {
  it('starts empty, queries the exact leading-zero identity, and renders purpose charts instead of a table', async () => {
    await render()
    expect(teamMaterialApi.serialHistory).not.toHaveBeenCalled()
    await search(' 000012 ')
    expect(teamMaterialApi.serialHistory).toHaveBeenCalledWith(2, { serial_no: '000012', date_from: '', date_to: '' })
    expect(wrapper.findAllComponents(TeamFlowTimeline)).toHaveLength(1)
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('1 批待本班组接收')
    expect(wrapper.text()).toContain('当前结存')
    expect(wrapper.getComponent(TeamFlowTimeline).props('history').groups).toHaveLength(2)
    expect(wrapper.find('a.chain-link').exists()).toBe(false)
  })
  it('uses explicit dates and opens the actual batch from a chart point', async () => {
    await render()
    wrapper.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-18', to: '2026-09-18' })
    await search()
    expect(teamMaterialApi.serialHistory).toHaveBeenLastCalledWith(2, { serial_no: '000012', date_from: '2026-09-18', date_to: '2026-09-18' })
    wrapper.getComponent(TeamFlowTimeline).vm.$emit('select', 'TL1'); await flushPromises()
    expect(wrapper.getComponent(MaterialTransferDrawer).props()).toMatchObject({ modelValue: true, batchNo: 'TL1', traceScope: { team_id: 2 } })
  })
  it('refreshes applied queries without replacing the user draft and ignores an old team response', async () => {
    await render('?serial_no=000012')
    await wrapper.get('input').setValue('未查询的新编号')
    await live.refresh!(); await flushPromises()
    expect(teamMaterialApi.serialHistory).toHaveBeenLastCalledWith(2, expect.objectContaining({ serial_no: '000012' }))
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('未查询的新编号')
    let finish!: (value: SerialHistory) => void
    vi.mocked(teamMaterialApi.serialHistory).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await search()
    await wrapper.setProps({ teamId: 3 })
    finish(result()); await flushPromises()
    expect(wrapper.findComponent(TeamFlowTimeline).exists()).toBe(false)
  })
  it('distinguishes unknown serials from existing unposted or exhausted histories', async () => {
    await render()
    vi.mocked(teamMaterialApi.serialHistory).mockResolvedValueOnce({ ...result(), found: false, groups: [], pending_incoming_count: 0 })
    await search(); expect(wrapper.text()).toContain('当前班组未找到该流水号')
    vi.mocked(teamMaterialApi.serialHistory).mockResolvedValueOnce({ ...result(), groups: [], untracked_count: 2 })
    await search(); expect(wrapper.text()).toContain('2 条历史记录未纳入库存台账')
    expect(wrapper.text()).toContain('暂无已入账收发记录')
  })
  it('keeps the same timeline on live refresh without adding another chart or global link', async () => {
    await render('?serial_no=000012')
    const canvas = wrapper.getComponent(TeamFlowTimeline).element
    await live.refresh!(); await flushPromises()
    expect(wrapper.getComponent(TeamFlowTimeline).element).toBe(canvas)
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('a[href*="material-trace"]').exists()).toBe(false)
  })
})

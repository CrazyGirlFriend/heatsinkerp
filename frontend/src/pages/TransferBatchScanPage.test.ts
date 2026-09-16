// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TransferBatchScanPage from './TransferBatchScanPage.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import type { MaterialDispatchDocument } from '@/types/teamMaterials'
const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, currentUser: { id: 41, team_id: 2, team: { name: '轧制' } } } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 41, team_id: 2, team: { name: '轧制' } } })
  vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture())
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(dispatchFixture().items[0]!)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/transfer-batches/scan', component: TransferBatchScanPage }] })
  await router.push('/transfer-batches/scan')
  wrapper = mount(TransferBatchScanPage, { global: { plugins: [router], stubs: { MaterialDispatchDrawer: true, MaterialTransferDrawer: true } } }); await flushPromises()
}
describe('group and historical barcode routing', () => {
  it('reads CK as a complete group and records it without calling the TL service', async () => {
    await render(); await wrapper.get('input[aria-label="转料批次条形码"]').setValue('ck-group'); await wrapper.get('input[aria-label="转料批次条形码"]').trigger('keyup.enter'); await flushPromises()
    expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP'); expect(materialTransferApi.get).not.toHaveBeenCalled()
    expect(wrapper.getComponent(MaterialDispatchDrawer).props()).toMatchObject({ modelValue: true, dispatchNo: 'CK-GROUP' })
    expect(wrapper.text()).toContain('2 条物料明细')
  })
  it('keeps a historical TL available as a traceable line', async () => {
    await render(); await wrapper.get('input[aria-label="转料批次条形码"]').setValue('TL-GROUP-1'); await wrapper.get('input[aria-label="转料批次条形码"]').trigger('keyup.enter'); await flushPromises()
    expect(materialTransferApi.get).toHaveBeenCalledWith('TL-GROUP-1'); expect(materialDispatchApi.get).not.toHaveBeenCalled()
    expect(wrapper.getComponent(MaterialTransferDrawer).props('modelValue')).toBe(true)
  })
  it('accepts a keyboard scanner CK sequence outside the input', async () => {
    await render()
    for (const key of [...'CK-GROUP', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await flushPromises(); expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP')
  })
  it('discards a late group lookup when the account changes', async () => {
    let finish!: (value: MaterialDispatchDocument) => void
    vi.mocked(materialDispatchApi.get).mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(); await wrapper.get('input[aria-label="转料批次条形码"]').setValue('CK-GROUP'); await wrapper.get('input[aria-label="转料批次条形码"]').trigger('keyup.enter')
    state.auth.currentUser.id = 99; await flushPromises(); finish(dispatchFixture()); await flushPromises()
    expect(wrapper.getComponent(MaterialDispatchDrawer).props('modelValue')).toBe(false); expect(wrapper.text()).not.toContain('2 条物料明细')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialStockActionDialog from './MaterialStockActionDialog.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type { MaterialDispatch, MaterialLoss, StockBatch } from '@/types/teamMaterials'
const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, currentUser: { team_id: 2 }, currentUserError: '', refreshCurrentUser: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => ({ items: [{ id: 2, name: '轧制', active: true }, { id: 3, name: '退火', active: true }, { id: 1, name: '库房', kind: 'warehouse', active: true }] }) }))
function source(id = 10, type: 'semi_finished' | null = 'semi_finished'): StockBatch {
  return { transfer: normalizeMaterialTransfer({ id, batch_no: `TL${id}`, serial_no: `SERIAL${id}`, material_name: id === 10 ? '铜钼' : '钨铜', source_team: { id: 1, name: '库房' }, material_type: type, source_batch_no: `RAW${id}` }), available_quantity: 100, available_weight: 10 } as StockBatch
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([])
  state.auth = reactive({ isTeamAccount: true, currentUser: { team_id: 2 }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  vi.spyOn(teamMaterialApi, 'createDispatch').mockResolvedValue({ dispatch_no: 'CK1', line_count: 2 } as MaterialDispatch)
  vi.spyOn(teamMaterialApi, 'createLoss').mockResolvedValue({ loss_no: 'LS1' } as MaterialLoss)
  vi.spyOn(teamMaterialApi, 'refreshSource').mockImplementation(async (_id, row) => ({ ...row, available_quantity: 5, available_weight: 0.5 }))
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(mode: 'dispatch' | 'loss' = 'dispatch', sources = [source(), source(11)]) {
  wrapper = mount(MaterialStockActionDialog, { props: { modelValue: true, teamId: 2, mode, sources }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function submit() { await wrapper.findAll('button').find(button => /^(确认出库|确认登记丢失)$/.test(button.text()))!.trigger('click'); await flushPromises() }
async function destination(id = 3) { wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', id); await flushPromises() }

describe('source batch dispatch and loss drafts', () => {
  it('requires a destination purpose per batch and clears choices when the destination changes', async () => {
    vi.mocked(teamMaterialApi.purposes).mockResolvedValue([{ id: 31, team_id: 3, name: '检验', active: true, version: 1 }, { id: 32, team_id: 3, name: '去毛刺', active: true, version: 1 }])
    await render(); await destination()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请为每行物料选择')
    const selects = wrapper.findAllComponents(ElSelect).filter(select => select.props('ariaLabel')?.endsWith('转料用途'))
    selects[0]!.vm.$emit('update:modelValue', 31); selects[1]!.vm.$emit('update:modelValue', 32)
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].lines.map(line => line.purpose_id)).toEqual([31, 32])
    await destination(1)
    expect(selects[0]!.props('modelValue')).toBeUndefined()
    expect(selects[1]!.props('modelValue')).toBeUndefined()
  })
  it('cannot silently bypass a failed purpose lookup', async () => {
    vi.mocked(teamMaterialApi.purposes).mockRejectedValue(new Error('用途读取失败'))
    await render(); await destination(); await submit()
    expect(wrapper.text()).toContain('用途读取失败')
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
  })
  it('splits one source into two typed lines and validates their combined quantity', async () => {
    await render('dispatch', [source()]); await destination(1)
    await wrapper.findAll('button').find(button => button.text() === '拆分物料')!.trigger('click')
    await flushPromises()
    const inputs = wrapper.findAllComponents(ElInputNumber)
    inputs[0]!.vm.$emit('update:modelValue', 80); inputs[1]!.vm.$emit('update:modelValue', 8)
    inputs[2]!.vm.$emit('update:modelValue', 21); inputs[3]!.vm.$emit('update:modelValue', 2)
    wrapper.findAllComponents(ElSelect).filter(select => select.props('ariaLabel')?.endsWith('物料类型'))[1]!.vm.$emit('update:modelValue', 'waste')
    await wrapper.get('textarea').setValue('加工废料回库'); await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('拆分明细合计超过')
    inputs[2]!.vm.$emit('update:modelValue', 20); await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(2, expect.objectContaining({ next_team_id: 1, lines: [
      { source_transfer_id: 10, quantity: 80, weight: 8, material_type: 'semi_finished' },
      { source_transfer_id: 10, quantity: 20, weight: 2, material_type: 'waste' },
    ] }))
  })
  it('requires scrap reasons and excludes production destinations', async () => {
    await render('dispatch', [source()]); await destination(3)
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'waste')
    await submit(); expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择一个启用的接收班组')
    await destination(1); await submit()
    expect(wrapper.text()).toContain('转废或废料处理原因')
  })
  it('sends one atomic bulk request with separate source identities and amounts', async () => {
    await render(); await destination()
    const inputs = wrapper.findAllComponents(ElInputNumber)
    inputs[0]!.vm.$emit('update:modelValue', 5); inputs[1]!.vm.$emit('update:modelValue', 0)
    inputs[2]!.vm.$emit('update:modelValue', 0); inputs[3]!.vm.$emit('update:modelValue', 1.005)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(2, { next_team_id: 3, notes: null, idempotency_key: expect.any(String), lines: [{ source_transfer_id: 10, quantity: 5, weight: 0, material_type: 'semi_finished' }, { source_transfer_id: 11, quantity: 0, weight: 1.005, material_type: 'semi_finished' }] })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('preserves all drafts on 409, refreshes balances and refuses unchanged excessive quantities', async () => {
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValueOnce(new TeamMaterialApiError('余额不足', 409))
    await render(); await destination(); await submit()
    expect(teamMaterialApi.refreshSource).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('填写内容已保留')
    expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('modelValue')).toBe(100)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('超过当前可用余量')
    wrapper.findAllComponents(ElInputNumber).forEach(input => input.vm.$emit('update:modelValue', 0.0))
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 1)
    wrapper.findAllComponents(ElInputNumber)[2]!.vm.$emit('update:modelValue', 1)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(2)
  })
  it('reuses the same idempotency key after uncertain network failure and regenerates when content changes', async () => {
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValue(new TeamMaterialApiError('网络错误'))
    await render(); await destination(); await submit(); await submit()
    const calls = vi.mocked(teamMaterialApi.createDispatch).mock.calls
    expect(calls[0]![1].idempotency_key).toBe(calls[1]![1].idempotency_key)
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 2)
    await submit()
    expect(calls[2]![1].idempotency_key).not.toBe(calls[1]![1].idempotency_key)
  })
  it('requires material type for a legacy source returning to warehouse and requires loss reason', async () => {
    await render('dispatch', [source(10, null)]); await destination(1); await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择物料类型')
    await wrapper.setProps({ mode: 'loss' })
    const inputs = wrapper.findAllComponents(ElInputNumber)
    inputs[0]!.vm.$emit('update:modelValue', 0); inputs[1]!.vm.$emit('update:modelValue', 0.005)
    await submit(); expect(teamMaterialApi.createLoss).not.toHaveBeenCalled()
    await wrapper.get('textarea').setValue('实物清点短缺')
    await submit()
    expect(teamMaterialApi.createLoss).toHaveBeenCalledWith(2, { source_transfer_id: 10, quantity: 0, weight: 0.005, reason: '实物清点短缺', idempotency_key: expect.any(String) })
  })
  it('closes a draft and makes no write when the current account is rebound during verification', async () => {
    await render(); await destination()
    state.auth.refreshCurrentUser.mockImplementation(async () => { state.auth.currentUser.team_id = 3 })
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, currentUser: { id: 2, team_id: 2, active: true }, currentUserError: '' } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
const context = (revision = 0): QuantityAdjustmentContext => ({ source_transfer_id: 10, batch_no: 'TL001', quantity: 10, weight: 100, revision, as_of: '2026-09-27T00:00:00Z', items: [], total: 0, page: 1, page_size: 10 })
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 2, team_id: 2, active: true }, currentUserError: '' })
  vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue(context())
  vi.spyOn(teamMaterialApi, 'changeQuantity').mockResolvedValue({ id: 1, source_transfer_id: 10, before_quantity: 10, after_quantity: 100, delta_quantity: 90, weight: 100, reason: '切割', created_by: '班组长', created_at: '2026-09-27T00:00:00Z' })
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(canWrite = true) {
  wrapper = mount(QuantityAdjustmentDialog, { props: { modelValue: true, teamId: 2, sourceId: 10, canWrite }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function click(label: string) { await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click'); await flushPromises() }
async function edit() {
  wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 100)
  await wrapper.get('textarea').setValue('切割为100件')
}

describe('processing piece adjustment', () => {
  it('saves a guarded piece change with no editable weight or receipt rewrite', async () => {
    await render(); await edit(); await click('保存件数')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(2, { source_transfer_id: 10, quantity: 100, expected_revision: 0, reason: '切割为100件', idempotency_key: expect.any(String) })
    expect(wrapper.findAllComponents(ElInputNumber)).toHaveLength(1)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
  it('retains drafts on conflict and requires an explicit fresh snapshot before retry', async () => {
    vi.mocked(teamMaterialApi.changeQuantity).mockRejectedValueOnce(new TeamMaterialApiError('库存已变化', 409))
    await render(); await edit(); await click('保存件数')
    expect(wrapper.get('textarea').element.value).toBe('切割为100件')
    await click('保存件数')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledTimes(1)
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({ ...context(3), quantity: 6, weight: 60 })
    await click('刷新并核对')
    expect(wrapper.getComponent(ElInputNumber).props('modelValue')).toBe(100)
    await click('保存件数')
    expect(vi.mocked(teamMaterialApi.changeQuantity).mock.calls[1]![1].expected_revision).toBe(3)
  })
  it('retries uncertain writes with the same key and validates reason and unchanged count', async () => {
    await render(); await click('保存件数')
    expect(wrapper.text()).toContain('件数未发生变化')
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 100)
    await click('保存件数')
    expect(wrapper.text()).toContain('请填写加工说明')
    await edit()
    vi.mocked(teamMaterialApi.changeQuantity).mockRejectedValue(new Error('网络错误'))
    await click('保存件数'); await click('保存件数')
    const calls = vi.mocked(teamMaterialApi.changeQuantity).mock.calls
    expect(calls[0]![1].idempotency_key).toBe(calls[1]![1].idempotency_key)
  })
  it('provides read-only history and blocks foreign-team writes', async () => {
    await render(false)
    expect(wrapper.findAllComponents(ElInputNumber)).toHaveLength(0)
    expect(wrapper.text()).not.toContain('保存件数')
    await wrapper.setProps({ canWrite: true })
    state.auth.currentUser.team_id = 99
    await flushPromises()
    expect(wrapper.text()).not.toContain('保存件数')
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
  it('keeps exhausted lots readable but disables piece changes', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({ ...context(), quantity: 0, weight: 0 })
    await render()
    expect(wrapper.text()).toContain('本批暂无在库物料')
    expect(wrapper.findAll('button').find(button => button.text() === '保存件数')!.attributes('disabled')).toBeDefined()
    expect(wrapper.findComponent(ElInputNumber).exists()).toBe(false)
  })
  it('does not load or submit when closed and cannot repopulate another batch with a stale request', async () => {
    let finish!: (value: QuantityAdjustmentContext) => void
    vi.mocked(teamMaterialApi.quantityContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await render()
    await wrapper.setProps({ sourceId: 11 })
    await flushPromises()
    finish({ ...context(), batch_no: 'STALE' }); await flushPromises()
    expect(wrapper.text()).not.toContain('STALE')
    await wrapper.setProps({ modelValue: false })
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  })
})

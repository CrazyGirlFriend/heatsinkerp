// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber } from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SerialReallocationDialog from './SerialReallocationDialog.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { StockBatch } from '@/types/teamMaterials'

const state = vi.hoisted(() => ({ auth: { isTeamAccount: true, currentUser: { id: 41, team_id: 2, active: true }, currentUserError: '', refreshCurrentUser: vi.fn() }, team: { id: 2, name: '检验', code: 'FACTORY-QC', kind: 'production', active: true } }))
vi.mock('@/services/materialInputApi', () => ({ materialSuggestions: vi.fn().mockResolvedValue([]) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => ({ items: [state.team] }) }))
const source = (): StockBatch => ({ transfer: normalizeMaterialTransfer({ id: 10, batch_no: 'TL10', serial_no: '000A', material_name: '材料1', material_type: 'finished', next_team: { id: 2, name: '检验' }, status: 'received' }), available_quantity: 100, available_weight: 20 } as StockBatch)
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({ isTeamAccount: true, currentUser: { id: 41, team_id: 2, active: true }, currentUserError: '', refreshCurrentUser: vi.fn().mockResolvedValue(undefined) })
  state.team = { id: 2, name: '检验', code: 'FACTORY-QC', kind: 'production', active: true }
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [] })
  vi.spyOn(teamMaterialApi, 'reallocate').mockResolvedValue(normalizeMaterialTransfer({ id: 11, batch_no: 'TL11', entry_kind: 'serial_reallocation', serial_no: '000B', source_serial_no: '000A', source_transfer_id: 10, status: 'received' }))
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(row = source()) {
  wrapper = mount(SerialReallocationDialog, { props: { modelValue: true, teamId: 2, source: row }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function fill(serial = '000B') {
  await wrapper.get('input[aria-label="转投目标流水号"]').setValue(serial)
  await wrapper.get('textarea[aria-label="转投原因"]').setValue('订单物料调整')
}
async function submit() { await wrapper.findAll('button').find(button => button.text() === '确认转投')!.trigger('click'); await flushPromises() }

it('validates the target and reason, preserves leading zeroes, and retains the existing no-cap policy', async () => {
  await render(); await submit()
  expect(wrapper.get('[role="alert"]').text()).toContain('目标流水号')
  await fill('000A'); await submit()
  expect(wrapper.get('[role="alert"]').text()).toContain('不能与当前流水号相同')
  await fill(); await wrapper.get('textarea').setValue(' '); await submit()
  expect(teamMaterialApi.reallocate).not.toHaveBeenCalled()
  await fill(' 000B ')
  const numbers = wrapper.findAllComponents(ElInputNumber)
  numbers[0]!.vm.$emit('update:modelValue', 130); numbers[1]!.vm.$emit('update:modelValue', 21)
  await submit()
  expect(teamMaterialApi.reallocate).toHaveBeenCalledWith(2, expect.objectContaining({ source_transfer_id: 10, serial_no: '000B', quantity: 130, weight: 21, reason: '订单物料调整' }))
  expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ serial_no: '000B', source_serial_no: '000A' })
  expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
})

it('keeps the same idempotency key for a failed retry and prevents duplicate in-flight submissions', async () => {
  await render(); await fill()
  vi.mocked(teamMaterialApi.reallocate).mockRejectedValueOnce(new Error('网络中断'))
  await submit()
  expect(wrapper.get('[role="alert"]').text()).toContain('网络中断')
  let complete!: (value: Awaited<ReturnType<typeof teamMaterialApi.reallocate>>) => void
  vi.mocked(teamMaterialApi.reallocate).mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
  await submit(); await submit()
  expect(teamMaterialApi.reallocate).toHaveBeenCalledTimes(2)
  expect(vi.mocked(teamMaterialApi.reallocate).mock.calls[0]![1].idempotency_key).toBe(vi.mocked(teamMaterialApi.reallocate).mock.calls[1]![1].idempotency_key)
  complete(normalizeMaterialTransfer({ id: 11 })); await flushPromises()
  expect(wrapper.emitted('saved')).toHaveLength(1)
})

it.each(['FACTORY-QC', 'FACTORY-PLATE', 'FACTORY-WAREHOUSE'])('accepts the official %s team and selects warehouse slots using B identity', async code => {
  state.team = { ...state.team, code, kind: code === 'FACTORY-WAREHOUSE' ? 'warehouse' : 'production' }
  await render(); await fill()
  if (code === 'FACTORY-WAREHOUSE') {
    const selector = wrapper.getComponent(WarehouseLocationSelect)
    expect(selector.props()).toMatchObject({ serialNo: '000B', materialName: '材料1', materialType: 'finished', active: true })
    selector.vm.$emit('update:modelValue', 'B区01'); selector.vm.$emit('update:reservationKey', 'lease-B'); await flushPromises()
  }
  await submit()
  expect(teamMaterialApi.reallocate).toHaveBeenCalled()
  if (code === 'FACTORY-WAREHOUSE') expect(vi.mocked(teamMaterialApi.reallocate).mock.calls[0]![1]).toMatchObject({ warehouse_location: 'B区01', warehouse_location_reservation_key: 'lease-B' })
})

it('disallows other teams and stops a draft if the account changes before submission', async () => {
  state.team = { ...state.team, code: 'FACTORY-ROLL' }
  await render(); await fill(); await submit()
  expect(teamMaterialApi.reallocate).not.toHaveBeenCalled()
  wrapper.unmount(); state.team = { ...state.team, code: 'FACTORY-QC' }; await render(); await fill()
  state.auth.refreshCurrentUser.mockImplementationOnce(async () => { state.auth.currentUser.team_id = 9 })
  await submit()
  expect(teamMaterialApi.reallocate).not.toHaveBeenCalled()
  expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
})

it('retains the source sludge ratio and sends effective weight with the measured gross weight', async () => {
  const row = source()
  row.transfer.material_type = 'sludge'; row.transfer.sludge_content_percent = 20; row.transfer.sludge_gross_weight = 10
  row.scrap_available_quantity = 0; row.scrap_available_weight = 2; row.sludge_available_gross_weight = 10
  await render(row); await fill()
  const gross = wrapper.get('input[aria-label="转投废泥实重"]')
  await gross.setValue('5'); await gross.trigger('change'); await submit()
  expect(teamMaterialApi.reallocate).toHaveBeenCalledWith(2, expect.objectContaining({ quantity: 0, weight: 1, sludge_gross_weight: 5, sludge_content_percent: 20 }))
})

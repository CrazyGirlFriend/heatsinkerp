// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElOption, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseLocationApi, type WarehouseLease, type WarehouseLocation, type WarehouseLeaseGroup } from '@/services/warehouseLocationApi'

const slot: WarehouseLocation = { id: 1, team_id: 1, name: 'A区-01', active: true, version: 1, status: 'available', has_stock: false, batches: [] }
const claim: WarehouseLease = { id: 1, name: slot.name, key: 'test-reservation-key', expires_at: '', hold_until: '' }
let wrapper: VueWrapper<InstanceType<typeof WarehouseLocationSelect>>
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [slot] })
  vi.spyOn(warehouseLocationApi, 'reserve').mockResolvedValue(claim)
  vi.spyOn(warehouseLocationApi, 'release').mockResolvedValue(undefined)
})
afterEach(async () => { wrapper?.unmount(); await flushPromises(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render(extra = {}) {
  wrapper = mount(WarehouseLocationSelect, { props: { modelValue: '', teamId: 1,
    ...extra,
    'onUpdate:modelValue': (value: string) => { void wrapper.setProps({ modelValue: value }) },
    'onUpdate:reservationKey': (value: string) => { void wrapper.setProps({ reservationKey: value }) },
  } })
  await flushPromises()
}
async function choose(name = slot.name) { wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', name); await flushPromises() }

describe('warehouse location selector', () => {
  const material = { serialNo: 'YS-007', materialName: '材料1', materialType: 'semi_finished' }
  const filled: WarehouseLocation = { ...slot, id: 2, name: 'Z-已有库存', status: 'occupied', has_stock: true, draft_locked: false, batches: [
    { id: 10, batch_no: 'TL10', serial_no: 'YS-007', material_name: '材料1', material_type: 'semi_finished', quantity: 20, weight: 3, status: 'received' },
    { id: 11, batch_no: 'TL11', serial_no: 'YS-007', material_name: '材料1', material_type: 'semi_finished', quantity: 10, weight: 2, status: 'pending' },
  ] }
  it('defaults to matching stock ahead of an empty slot and shows physical stock separately from pending arrivals', async () => {
    vi.mocked(teamMaterialApi.warehouseLocations).mockResolvedValue({ items: [slot, filled] })
    vi.mocked(warehouseLocationApi.reserve).mockImplementation(async (id, key) => ({ ...claim, id, name: filled.name, key }))
    await render(material)
    expect(wrapper.props('modelValue')).toBe(filled.name)
    expect(warehouseLocationApi.reserve).toHaveBeenCalledWith(2, expect.any(String), { serial_no: 'YS-007', material_name: '材料1', material_type: 'semi_finished' })
    expect(wrapper.text()).toContain('当前库存 20 件 · 3 kg')
    expect(wrapper.text()).toContain('TL10')
    expect(wrapper.text()).toContain('TL11')
    expect(wrapper.text()).toContain('待签收')
  })
  it('releases the old selection when material changes and rejects incompatible existing stock', async () => {
    vi.mocked(teamMaterialApi.warehouseLocations).mockResolvedValue({ items: [filled] })
    vi.mocked(warehouseLocationApi.reserve).mockImplementation(async (id, key) => ({ ...claim, id, name: filled.name, key }))
    await render(material)
    const oldKey = wrapper.props('reservationKey')
    await wrapper.setProps({ materialType: 'finished' }); await flushPromises()
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(2, oldKey, true)
    expect(wrapper.props('modelValue')).toBe('')
    expect(warehouseLocationApi.reserve).toHaveBeenCalledTimes(1)
    expect(wrapper.getComponent(ElOption).props('disabled')).toBe(true)
  })
  it('shares one key between compatible lines in a form and releases only after both close', async () => {
    const group: WarehouseLeaseGroup = new Map()
    vi.mocked(warehouseLocationApi.reserve).mockImplementation(async (id, key) => ({ ...claim, id, key }))
    await render({ ...material, leaseGroup: group })
    const second = mount(WarehouseLocationSelect, { props: { modelValue: '', teamId: 1, ...material, leaseGroup: group } })
    try {
      await flushPromises()
      const calls = vi.mocked(warehouseLocationApi.reserve).mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[0]![1]).toBe(calls[1]![1])
      await wrapper.setProps({ active: false }); await flushPromises()
      expect(warehouseLocationApi.release).not.toHaveBeenCalled()
      await second.setProps({ active: false }); await flushPromises()
      expect(warehouseLocationApi.release).toHaveBeenCalledTimes(1)
      expect(group.size).toBe(0)
    } finally { second.unmount() }
  })
  it('does not reuse a stale empty option reserved by another material line in the same form', async () => {
    const group: WarehouseLeaseGroup = new Map()
    vi.mocked(warehouseLocationApi.reserve).mockImplementation(async (id, key) => ({ ...claim, id, key }))
    await render({ ...material, leaseGroup: group })
    const second = mount(WarehouseLocationSelect, { props: { modelValue: '', teamId: 1, ...material, materialType: 'finished', leaseGroup: group } })
    try {
      await flushPromises()
      expect(warehouseLocationApi.reserve).toHaveBeenCalledTimes(1)
      expect(second.getComponent(ElOption).props('disabled')).toBe(true)
      expect(second.emitted('update:modelValue')).toBeUndefined()
    } finally { second.unmount() }
  })
  it('locks immediately before publishing the selection and releases on form close', async () => {
    let resolve!: (value: WarehouseLease) => void
    vi.mocked(warehouseLocationApi.reserve).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await render()
    expect(wrapper.getComponent(ElSelect).props('allowCreate')).toBe(false)
    await choose()
    expect(warehouseLocationApi.reserve).toHaveBeenCalledWith(1, expect.any(String), undefined)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.getComponent(ElSelect).props('disabled')).toBe(true)
    resolve(claim); await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([[slot.name]])
    expect(wrapper.emitted('update:reservationKey')).toEqual([[claim.key]])
    await wrapper.setProps({ active: false }); await flushPromises()
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(1, claim.key, true)
  })

  it('releases a claim that finishes after the form has already closed', async () => {
    let resolve!: (value: WarehouseLease) => void
    vi.mocked(warehouseLocationApi.reserve).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await render(); await choose(); await wrapper.setProps({ active: false })
    resolve(claim); await flushPromises()
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(1, claim.key, true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('keeps the old lock if a new choice is taken by somebody else', async () => {
    vi.mocked(teamMaterialApi.warehouseLocations).mockResolvedValue({ items: [slot, { ...slot, id: 2, name: 'A区-02' }] })
    await render(); await choose()
    vi.mocked(warehouseLocationApi.reserve).mockRejectedValueOnce(new Error('该仓位已被其他表单锁定'))
    await choose('A区-02')
    expect(wrapper.get('[role="alert"]').text()).toContain('其他表单锁定')
    expect(wrapper.props().modelValue).toBe(slot.name)
    expect(warehouseLocationApi.release).not.toHaveBeenCalledWith(1, claim.key, true)
    await choose('')
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(1, claim.key, true)
    expect(wrapper.props().modelValue).toBe('')
  })

  it('renews while filling, then clears an expired selection and stops renewing on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await render(); await choose()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(warehouseLocationApi.reserve).toHaveBeenLastCalledWith(1, claim.key, undefined)
    vi.mocked(warehouseLocationApi.reserve).mockRejectedValueOnce(new Error('仓位选择已失效'))
    await vi.advanceTimersByTimeAsync(45_000); await flushPromises()
    expect(wrapper.props().modelValue).toBe('')
    expect(wrapper.props().reservationKey).toBe('')
    expect(wrapper.text()).toContain('仓位选择已失效')
    await wrapper.setProps({ active: false })
    const calls = vi.mocked(warehouseLocationApi.reserve).mock.calls.length
    await vi.advanceTimersByTimeAsync(90_000)
    expect(warehouseLocationApi.reserve).toHaveBeenCalledTimes(calls)
  })

  it('expires at ten minutes even when heartbeats continue', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.mocked(warehouseLocationApi.reserve).mockResolvedValue({ ...claim, hold_until: new Date(Date.now() + 600_000).toISOString() })
    await render(); await choose()
    expect(wrapper.text()).toContain('已锁定 · 10:00 后释放')
    await vi.advanceTimersByTimeAsync(540_000)
    expect(wrapper.get('.location-countdown-warning').text()).toContain('01:00 后释放，请及时提交')
    await vi.advanceTimersByTimeAsync(59_000)
    expect(wrapper.props().modelValue).toBe(slot.name)
    await vi.advanceTimersByTimeAsync(1_000); await flushPromises()
    expect(wrapper.props().modelValue).toBe('')
    expect(wrapper.text()).toContain('10 分钟未提交')
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(1, claim.key, true)
  })

  it('releases a heartbeat response arriving after cancellation', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await render(); await choose()
    let resolve!: (value: WarehouseLease) => void
    vi.mocked(warehouseLocationApi.reserve).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await vi.advanceTimersByTimeAsync(45_000)
    await wrapper.setProps({ active: false }); await flushPromises()
    expect(warehouseLocationApi.release).toHaveBeenCalledTimes(1)
    resolve(claim); await flushPromises()
    expect(warehouseLocationApi.release).toHaveBeenCalledTimes(2)
    expect(wrapper.props().modelValue).toBe('')
  })

  it('allows leaving the field blank when no managed slot is available', async () => {
    vi.mocked(teamMaterialApi.warehouseLocations).mockResolvedValue({ items: [] })
    await render()
    expect(wrapper.text()).toContain('暂无可用仓位，可不填写')
    await choose('未建档仓位')
    expect(warehouseLocationApi.reserve).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('ignores a late response from the previous warehouse', async () => {
    let resolve!: (value: { items: WarehouseLocation[] }) => void
    vi.mocked(teamMaterialApi.warehouseLocations).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await render()
    vi.mocked(teamMaterialApi.warehouseLocations).mockResolvedValue({ items: [] })
    await wrapper.setProps({ teamId: 2 }); await flushPromises()
    resolve({ items: [slot] }); await flushPromises()
    expect(wrapper.findAllComponents(ElOption)).toHaveLength(0)
  })

  it('cleans up on pagehide and cannot free a later committed document with another key', async () => {
    await render(); await choose()
    window.dispatchEvent(new Event('pagehide')); await flushPromises()
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(1, claim.key, true)
    expect(wrapper.props().modelValue).toBe('')
    expect(wrapper.props().reservationKey).toBe('')
  })
})

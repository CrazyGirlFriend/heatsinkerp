// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElOption, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseLocationApi, type WarehouseLease, type WarehouseLocation } from '@/services/warehouseLocationApi'

const slot: WarehouseLocation = { id: 1, team_id: 1, name: 'A区-01', active: true, version: 1, status: 'available', has_stock: false, batches: [] }
const claim: WarehouseLease = { id: 1, name: slot.name, key: 'test-reservation-key', expires_at: '', hold_until: '' }
let wrapper: VueWrapper<InstanceType<typeof WarehouseLocationSelect>>
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [slot] })
  vi.spyOn(warehouseLocationApi, 'reserve').mockResolvedValue(claim)
  vi.spyOn(warehouseLocationApi, 'release').mockResolvedValue(undefined)
})
afterEach(async () => { wrapper?.unmount(); await flushPromises(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render() {
  wrapper = mount(WarehouseLocationSelect, { props: { modelValue: '', teamId: 1,
    'onUpdate:modelValue': (value: string) => { void wrapper.setProps({ modelValue: value }) },
    'onUpdate:reservationKey': (value: string) => { void wrapper.setProps({ reservationKey: value }) },
  } })
  await flushPromises()
}
async function choose(name = slot.name) { wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', name); await flushPromises() }

describe('warehouse location selector', () => {
  it('locks immediately before publishing the selection and releases on form close', async () => {
    let resolve!: (value: WarehouseLease) => void
    vi.mocked(warehouseLocationApi.reserve).mockReturnValueOnce(new Promise(done => { resolve = done }))
    await render()
    expect(wrapper.getComponent(ElSelect).props('allowCreate')).toBe(false)
    await choose()
    expect(warehouseLocationApi.reserve).toHaveBeenCalledWith(1, expect.any(String))
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
    expect(warehouseLocationApi.release).not.toHaveBeenCalled()
    await choose('')
    expect(warehouseLocationApi.release).toHaveBeenCalledWith(1, claim.key, true)
    expect(wrapper.props().modelValue).toBe('')
  })

  it('renews while filling, then clears an expired selection and stops renewing on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await render(); await choose()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(warehouseLocationApi.reserve).toHaveBeenLastCalledWith(1, claim.key)
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
    expect(wrapper.text()).toContain('暂无空闲仓位，可不填写')
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

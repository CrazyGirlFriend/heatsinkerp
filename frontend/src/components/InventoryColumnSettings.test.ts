// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElCheckbox, ElMessage, ElPopover } from 'element-plus'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import { defaultInventoryColumns, inventoryColumns, normalizeInventoryColumns, type InventoryColumnChoice } from '@/types/inventoryColumns'
import { serialFixture } from '@/testFixtures/materialAnalytics'

let wrapper: VueWrapper
const key = 'heatsink.inventory-columns.v1:1:914'
beforeEach(() => localStorage.clear())
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); localStorage.clear() })
async function render(storageKey: string | null = key) {
  wrapper = mount(InventoryColumnSettings, { props: { storageKey }, global: { stubs: { ElPopover: { template: '<div><slot name="reference"/><slot/></div>' } } } })
  await flushPromises()
}
function button(text: string) { return wrapper.findAll('button').find(item => item.text() === text)! }
function check(label: string, value: boolean) { wrapper.findAllComponents(ElCheckbox).find(item => item.text() === label)!.vm.$emit('update:modelValue', value) }
const latest = () => wrapper.emitted('change')!.at(-1)![0] as InventoryColumnChoice[]

describe('inventory display columns', () => {
  it('keeps current defaults and never offers batch-level columns', async () => {
    await render()
    expect(latest().filter(item => item.visible).map(item => item.key)).toEqual(['material_name', 'transfer_specification', 'available_quantity', 'available_weight'])
    expect(wrapper.text()).not.toMatch(/批次号|上序|下序|原单批号/)
    expect(inventoryColumns.map(column => column.key)).not.toContain('source_batch_no')
    expect(wrapper.text()).toContain('流水号、操作列始终显示')
  })
  it('saves only on apply, retains ordering and reloads by account and team', async () => {
    await render()
    check('材质', false); check('客户编号', true)
    await wrapper.get('button[aria-label="上移客户编号"]').trigger('click')
    await button('取消').trigger('click')
    expect(localStorage.getItem(key)).toBeNull()
    expect(latest()).toEqual(defaultInventoryColumns())
    wrapper.getComponent(ElPopover).vm.$emit('update:visible', true); await flushPromises()
    expect(wrapper.findAllComponents(ElCheckbox).find(item => item.text() === '材质')!.props('modelValue')).toBe(true)
    expect(wrapper.findAllComponents(ElCheckbox).find(item => item.text() === '客户编号')!.props('modelValue')).toBe(false)
    check('材质', false); check('客户编号', true)
    await wrapper.get('button[aria-label="上移客户编号"]').trigger('click')
    await button('应用').trigger('click')
    expect(latest().filter(item => item.visible).map(item => item.key)).toEqual(['transfer_specification', 'available_quantity', 'customer_code', 'available_weight'])
    const saved = latest()
    wrapper.unmount(); await render()
    expect(latest()).toEqual(saved)
    await wrapper.setProps({ storageKey: 'heatsink.inventory-columns.v1:1:915' })
    expect(latest()).toEqual(defaultInventoryColumns())
    await wrapper.setProps({ storageKey: 'heatsink.inventory-columns.v1:2:914' })
    expect(latest()).toEqual(defaultInventoryColumns())
    await wrapper.setProps({ storageKey: key })
    expect(latest()).toEqual(saved)
    await button('恢复默认').trigger('click'); await button('应用').trigger('click')
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(defaultInventoryColumns())
  })
  it('allows all optional fields to be hidden and preserves the choice', async () => {
    await render()
    for (const checkbox of wrapper.findAllComponents(ElCheckbox)) checkbox.vm.$emit('update:modelValue', false)
    await button('应用').trigger('click')
    wrapper.unmount(); await render()
    expect(latest().some(item => item.visible)).toBe(false)
  })
  it('does not overwrite a quick edit when the opening animation finishes', async () => {
    await render()
    const popover = wrapper.getComponent(ElPopover)
    popover.vm.$emit('update:visible', true); await flushPromises()
    check('产品编号', true)
    popover.vm.$emit('show'); await flushPromises()
    await button('应用').trigger('click')
    expect(latest().find(item => item.key === 'product_code')?.visible).toBe(true)
    popover.vm.$emit('update:visible', true); await flushPromises()
    await button('恢复默认').trigger('click')
    popover.vm.$emit('show'); await flushPromises()
    await button('应用').trigger('click')
    expect(latest()).toEqual(defaultInventoryColumns())
  })
  it('falls back safely for invalid storage, deduplicates keys and drops batch fields', async () => {
    localStorage.setItem(key, '{broken')
    await render()
    expect(latest()).toEqual(defaultInventoryColumns())
    const normalized = normalizeInventoryColumns([{ key: 'product_code', visible: true }, { key: 'product_code', visible: false }, { key: 'batch_no', visible: true }, null, { key: 'available_weight', visible: 'yes' }])
    expect(normalized).toHaveLength(inventoryColumns.length)
    expect(normalized[0]).toEqual({ key: 'product_code', visible: true })
    expect(normalized.some(item => String(item.key) === 'batch_no')).toBe(false)
  })
  it('does not fail rendering or applying when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close: () => {} }))
    await render(); check('产品编号', true); await button('应用').trigger('click')
    expect(latest().find(item => item.key === 'product_code')?.visible).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未能保存'))
  })
  it('shows missing, conflicting and aggregate values without inventing a batch value', () => {
    const row = serialFixture()
    const display = (key: string) => inventoryColumns.find(column => column.key === key)!.format(row)
    expect(display('customer_code')).toBe('—')
    expect(display('transfer_specification')).toBe('多规格')
    expect(display('finished_quantity')).toBe('100')
    row.finished_quantity_count = 2
    expect(display('finished_quantity')).toBe('多值')
    expect(display('pending_incoming_quantity')).toBe('15')
    expect(display('last_activity_at')).toBe('2026-09-12 08:00')
  })
})

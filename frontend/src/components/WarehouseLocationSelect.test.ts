// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElOption, ElSelect } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'

let wrapper: VueWrapper
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
function render() { wrapper = mount(WarehouseLocationSelect, { props: { modelValue: '', teamId: 1 } }) }

describe('warehouse location selector', () => {
  it('loads on opening, preserves stock-first ordering and accepts a new manual location', async () => {
    const request = vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [
      { name: 'B区-01', has_stock: true }, { name: 'A区-01', has_stock: false },
    ] })
    render()
    expect(request).not.toHaveBeenCalled()
    wrapper.getComponent(ElSelect).vm.$emit('visible-change', true)
    await flushPromises()
    expect(request).toHaveBeenCalledWith(1, '')
    expect(wrapper.findAllComponents(ElOption).map(item => item.props('label'))).toEqual(['B区-01', 'A区-01'])
    expect(wrapper.getComponent(ElSelect).props('allowCreate')).toBe(true)
    wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', ' C区-03 ')
    expect(wrapper.emitted('update:modelValue')).toEqual([['C区-03']])
  })

  it('allows manual entry if suggestions fail', async () => {
    vi.spyOn(teamMaterialApi, 'warehouseLocations').mockRejectedValue(new Error('offline'))
    render(); wrapper.getComponent(ElSelect).vm.$emit('visible-change', true)
    await flushPromises()
    expect(wrapper.text()).toContain('仍可手动输入')
    expect(wrapper.getComponent(ElSelect).props('disabled')).toBe(false)
  })

  it('ignores a late response after switching warehouses', async () => {
    let resolve!: (value: { items: { name: string; has_stock: boolean }[] }) => void
    vi.spyOn(teamMaterialApi, 'warehouseLocations').mockReturnValue(new Promise(done => { resolve = done }))
    render(); wrapper.getComponent(ElSelect).vm.$emit('visible-change', true)
    await wrapper.setProps({ teamId: 2 })
    resolve({ items: [{ name: '旧仓位', has_stock: true }] }); await flushPromises()
    expect(wrapper.findAllComponents(ElOption)).toHaveLength(0)
  })
})

// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WatermelonWarehouseToolbar from './WatermelonWarehouseToolbar.vue'
import WarehouseManagement from '../WarehouseManagement.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseLocationApi } from '@/services/warehouseLocationApi'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'stock').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
  })
})
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('Watermelon warehouse controls', () => {
  it('opens from the trigger, supports arrow selection, and returns focus on Escape', async () => {
    wrapper = mount(WatermelonWarehouseToolbar, {
      props: { state: 'occupied' },
      attachTo: document.body,
    })
    const trigger = wrapper.get<HTMLButtonElement>('.wm-filter-trigger')
    await trigger.trigger('click')
    await flushPromises()
    const selected = document.querySelector<HTMLButtonElement>('[aria-checked="true"]')!
    expect(selected.textContent).toContain('有料')
    expect(document.activeElement).toBe(selected)
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement?.textContent).toContain('空闲')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
  })

  it('applies a selected status to the existing warehouse request and resets it', async () => {
    const list = vi
      .spyOn(warehouseLocationApi, 'list')
      .mockResolvedValue({ page: 1, page_size: 20, items: [], total: 0, team_id: 1 })
    wrapper = mount(WarehouseManagement, {
      props: { canManage: true, teamId: 1 },
      global: { stubs: { WatermelonDialog: true } },
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper.get('input[aria-label="搜索仓位"]').setValue('A-01')
    await wrapper.get('.wm-warehouse-actions').trigger('submit')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith('A-01', 1, 20, undefined)
    await wrapper.get('.wm-filter-trigger').trigger('click')
    await flushPromises()
    const occupied = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((el) => el.textContent?.includes('有料'))!
    occupied.click()
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith('A-01', 1, 20, 'occupied')
    await wrapper.get('.wm-reset').trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith('', 1, 20, undefined)
  })

  it('keeps the existing warehouse permission gate', async () => {
    const list = vi.spyOn(warehouseLocationApi, 'list')
    wrapper = mount(WarehouseManagement, { props: { canManage: false } })
    await flushPromises()
    expect(wrapper.text()).toContain('仅库房账号和管理员')
    expect(wrapper.find('.wm-warehouse-toolbar').exists()).toBe(false)
    expect(list).not.toHaveBeenCalled()
  })

  it('validates the editor before saving through the existing warehouse API', async () => {
    vi.spyOn(warehouseLocationApi, 'list').mockResolvedValue({
      page: 1,
      page_size: 20,
      items: [],
      total: 0,
      team_id: 1,
    })
    const save = vi.spyOn(warehouseLocationApi, 'save').mockRejectedValue(new Error('名称已存在'))
    wrapper = mount(WarehouseManagement, {
      props: { canManage: true, teamId: 1 },
      attachTo: document.body,
      global: {
        stubs: {
          WatermelonDialog: {
            props: ['modelValue'],
            template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>',
          },
        },
      },
    })
    await flushPromises()
    await wrapper.get('.warehouse-add').trigger('click')
    const saveButton = () => wrapper!.findAll('button').find((button) => button.text() === '保存')!
    await saveButton().trigger('click')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写仓位名称')
    await wrapper.get('input[aria-label="仓位名称"]').setValue('A-12')
    await saveButton().trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ name: 'A-12', active: true }, undefined)
    expect(wrapper.get('input[aria-label="仓位名称"]').element).toHaveProperty('value', 'A-12')
    expect(wrapper.text()).toContain('名称已存在')
  })
})

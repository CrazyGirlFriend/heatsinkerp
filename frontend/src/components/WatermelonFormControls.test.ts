// @vitest-environment jsdom
import { ElSelect } from 'element-plus'
import { computed } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ElInputNumber } from 'element-plus'
import { describe, expect, it, vi } from 'vitest'
import WeightInput from './WeightInput.vue'
import PublishedProcessRoutePicker from './PublishedProcessRoutePicker.vue'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import { routeFixture } from '@/testFixtures/processRoute'
import { processRouteApi } from '@/services/processRouteApi'
vi.mock('@/services/processRouteApi', () => ({
  processRouteApi: { list: vi.fn(), detail: vi.fn() },
}))
const global = {
  provide: { [workspaceAppearanceKey as symbol]: computed(() => 'watermelon') },
  stubs: { teleport: true },
}

describe('warehouse form controls', () => {
  it('keeps kilogram precision and unit conversion with the shared number control', async () => {
    const wrapper = mount(WeightInput, {
      props: { modelValue: 0.000123, ariaLabel: '入库重量', max: 12 },
      // Exercise the real popper; stubbing Teleport makes native ElSelect recurse on disable.
      global: { ...global, stubs: {} },
    })
    try {
      wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'g')
      await flushPromises()
      const input = wrapper.getComponent(ElInputNumber)
      expect(input.props('modelValue')).toBe(0.123)
      expect(input.props('max')).toBe(12000)
      input.vm.$emit('update:modelValue', 0.125)
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([0.000125])
      await wrapper.setProps({ disabled: true })
      expect(wrapper.get('input').attributes('disabled')).toBeDefined()
      expect(wrapper.getComponent(ElSelect).props('disabled')).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })
  it('uses the themed picker without changing published-route selection or failure handling', async () => {
    const route = { ...structuredClone(routeFixture), state: 'published' as const }
    vi.mocked(processRouteApi.list).mockResolvedValue({
      items: [route],
      total: 1,
      page: 1,
      page_size: 20,
      enforced_after: null,
    })
    vi.mocked(processRouteApi.detail)
      .mockRejectedValueOnce(new Error('工艺读取失败'))
      .mockResolvedValueOnce(route)
    const wrapper = mount(PublishedProcessRoutePicker, { global })
    try {
      await flushPromises()
      expect(wrapper.find('.wm-data-table').exists()).toBe(true)
      expect(wrapper.find('.business-table').exists()).toBe(false)
      await wrapper.get('input[aria-label="工艺搜索"]').setValue('691236')
      await wrapper.get('input[aria-label="工艺搜索"]').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(processRouteApi.list).toHaveBeenLastCalledWith('691236', 1, 'published')
      const select = wrapper.findAll('button').find((button) => button.text() === '选择')!
      await select.trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('工艺读取失败')
      expect(wrapper.emitted('selected')).toBeUndefined()
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '选择')!
        .trigger('click')
      await flushPromises()
      expect(wrapper.emitted('selected')).toEqual([[route]])
    } finally {
      wrapper.unmount()
    }
  })
})

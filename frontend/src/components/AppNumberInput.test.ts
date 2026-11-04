// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { computed, h, ref } from 'vue'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import AppNumberInput from './AppNumberInput.vue'

describe('shared quantity input', () => {
  it('preserves precision, limits and model updates when using the themed step controls', async () => {
    const quantity = ref<number | undefined>(0.2)
    const wrapper = mount(
      {
        render: () =>
          h(AppNumberInput, {
            modelValue: quantity.value,
            'onUpdate:modelValue': (value) => (quantity.value = value),
            min: 0.1,
            max: 0.3,
            step: 0.1,
            precision: 1,
          }),
      },
      { global: { provide: { [workspaceAppearanceKey as symbol]: computed(() => 'watermelon') } } },
    )
    async function press(selector: string) {
      await wrapper.get(selector).trigger('mousedown', { button: 0 })
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    }
    try {
      await press('.el-input-number__increase')
      expect(quantity.value).toBe(0.3)
      await press('.el-input-number__increase')
      expect(quantity.value).toBe(0.3)
      await press('.el-input-number__decrease')
      await press('.el-input-number__decrease')
      await press('.el-input-number__decrease')
      expect(quantity.value).toBe(0.1)
      expect(wrapper.get('input').element.value).toBe('0.1')
    } finally {
      wrapper.unmount()
    }
  })
})

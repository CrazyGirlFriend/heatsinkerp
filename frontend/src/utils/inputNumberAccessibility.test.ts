// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElForm, ElFormItem, ElInputNumber } from 'element-plus'
import { afterEach, expect, it } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { installInputNumberAccessibility } from './inputNumberAccessibility'

let wrapper: VueWrapper | undefined
let dispose: (() => void) | undefined
afterEach(() => {
  wrapper?.unmount()
  dispose?.()
  document.body.innerHTML = ''
})
async function settle() {
  await nextTick()
  await flushPromises()
}

it('keeps real form loading changes accessible without remounting or changing values', async () => {
  const state = reactive({ disabled: true, amount: 12 })
  dispose = installInputNumberAccessibility(document.body)
  wrapper = mount(
    defineComponent({
      components: { ElForm, ElFormItem, ElInputNumber },
      setup: () => ({ state }),
      template:
        '<ElForm :disabled="state.disabled"><ElFormItem><ElInputNumber v-model="state.amount" /></ElFormItem></ElForm>',
    }),
    { attachTo: document.body },
  )
  await settle()
  const input = wrapper.get('input[role="spinbutton"]').element as HTMLInputElement
  expect(input.disabled).toBe(true)
  expect(input.getAttribute('aria-disabled')).toBe('true')
  state.disabled = false
  await settle()
  expect(wrapper.get('input[role="spinbutton"]').element).toBe(input)
  expect(input.disabled).toBe(false)
  expect(input.getAttribute('aria-disabled')).toBe('false')
  await wrapper.get('input[role="spinbutton"]').setValue('7')
  expect(state.amount).toBe(7)
  state.disabled = true
  await settle()
  expect(input.disabled).toBe(true)
  expect(input.getAttribute('aria-disabled')).toBe('true')
  expect(input.value).toBe('7')
})

it('covers dynamically inserted teleported number inputs and releases its observer', async () => {
  const state = reactive({ visible: false, disabled: false, amount: 5 })
  dispose = installInputNumberAccessibility(document.body)
  wrapper = mount(
    defineComponent({
      components: { ElInputNumber },
      setup: () => ({ state }),
      template:
        '<Teleport to="body"><ElInputNumber v-if="state.visible" v-model="state.amount" :disabled="state.disabled" /></Teleport>',
    }),
    { attachTo: document.body },
  )
  state.visible = true
  await settle()
  const input = document.body.querySelector<HTMLInputElement>('input[role="spinbutton"]')!
  expect(input.getAttribute('aria-disabled')).toBe('false')
  state.disabled = true
  await settle()
  expect(input.disabled).toBe(true)
  expect(input.getAttribute('aria-disabled')).toBe('true')
  dispose()
  state.disabled = false
  await settle()
  expect(input.disabled).toBe(false)
  expect(input.getAttribute('aria-disabled')).toBe('true')
})

it('leaves unrelated inputs and their business disabled states untouched', async () => {
  document.body.innerHTML =
    '<input disabled aria-disabled="true"><div class="el-input-number"><input role="spinbutton" disabled></div>'
  dispose = installInputNumberAccessibility(document.body)
  const inputs = document.body.querySelectorAll('input')
  inputs[0]!.disabled = false
  inputs[1]!.disabled = false
  await settle()
  expect(inputs[0]!.getAttribute('aria-disabled')).toBe('true')
  expect(inputs[1]!.getAttribute('aria-disabled')).toBe('false')
  expect(inputs[0]!.disabled).toBe(false)
  expect(inputs[1]!.disabled).toBe(false)
})

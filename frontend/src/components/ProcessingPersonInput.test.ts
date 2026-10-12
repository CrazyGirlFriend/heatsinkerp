// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { ElDialog, ElForm } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProcessingPersonInput from './ProcessingPersonInput.vue'

let wrapper: VueWrapper
const people = ['王师傅', '李师傅', ...Array.from({ length: 46 }, (_, i) => `员工${i + 1}`)]
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})
async function render(value = '', options = people) {
  wrapper = mount(ProcessingPersonInput, {
    attachTo: document.body,
    props: {
      modelValue: value,
      options,
      'onUpdate:modelValue': (name: string) => wrapper.setProps({ modelValue: name }),
    },
    global: { stubs: { teleport: true } },
  })
  await open()
}
async function open() {
  await wrapper.get('.person-trigger').trigger('click')
  await vi.waitFor(() => expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(true))
  await flushPromises()
}

describe('processing employee picker', () => {
  it('filters a team roster and selects only an existing employee in one click', async () => {
    await render()
    expect(wrapper.findAll('.person-choice')).toHaveLength(48)
    await wrapper.get('input[aria-label="搜索加工人"]').setValue(' 王 ')
    expect(wrapper.findAll('.person-choice').map((item) => item.text())).toEqual(['王师傅'])
    await wrapper.get('.person-choice').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['王师傅']])
    expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(false)
  })

  it('marks the current employee, resets search on reopening, and allows clearing', async () => {
    await render('李师傅')
    expect(wrapper.get('.person-choice[aria-pressed="true"]').text()).toBe('李师傅')
    await wrapper.get('input[aria-label="搜索加工人"]').setValue('王')
    await wrapper.get('.person-panel').trigger('keydown', { key: 'Escape' })
    await open()
    expect(wrapper.get('input').element.value).toBe('')
    expect(wrapper.findAll('.person-choice')).toHaveLength(48)
    await wrapper.get('.person-panel-header button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
    expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(false)
  })

  it('distinguishes an empty roster from a search with no matches', async () => {
    await render('', [])
    expect(wrapper.get('[role="status"]').text()).toBe('请先在班组设置中添加员工')
    await wrapper.setProps({ options: people })
    await wrapper.get('input[aria-label="搜索加工人"]').setValue('未登记的人')
    expect(wrapper.get('[role="status"]').text()).toBe('未找到匹配的员工')
    expect(wrapper.findAll('.person-choice')).toHaveLength(0)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('closes on Escape without clearing the existing employee or closing the parent form', async () => {
    await render('王师傅')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    wrapper.get('input').element.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('inherits form disabled state and closes an already open picker during submission', async () => {
    const formDisabled = ref(false)
    wrapper = mount(
      defineComponent({
        components: { ElForm, ProcessingPersonInput },
        setup: () => ({ formDisabled, name: ref('王师傅'), people }),
        template:
          '<ElForm :disabled="formDisabled"><ProcessingPersonInput v-model="name" :options="people" /></ElForm>',
      }),
      { attachTo: document.body, global: { stubs: { teleport: true } } },
    )
    await open()
    expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(true)
    formDisabled.value = true
    await flushPromises()
    expect(wrapper.get('.person-trigger').attributes('disabled')).toBeDefined()
    expect(wrapper.getComponent(ElDialog).props('modelValue')).toBe(false)
    expect(wrapper.getComponent(ProcessingPersonInput).emitted('update:modelValue')).toBeUndefined()
  })
})

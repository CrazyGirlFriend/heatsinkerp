// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ElOption } from 'element-plus'
import FilterDialog from './FilterDialog.vue'
import AppSelect from './AppSelect.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})

it('keeps nested choices open independently and returns focus when Escape closes the filters', async () => {
  const cancel = vi.fn()
  wrapper = mount(
    {
      components: { FilterDialog, AppSelect, ElOption },
      setup: () => ({ opened: ref(false), value: ref(''), cancel }),
      template: `
        <FilterDialog v-model="opened" title="库存筛选" @cancel="cancel">
          <template #default="{ appendTo }">
            <AppSelect v-model="value" :append-to="appendTo" aria-label="物料类型">
              <ElOption value="finished" label="成品" />
            </AppSelect>
          </template>
        </FilterDialog>`,
    },
    { attachTo: document.body },
  )
  const trigger = wrapper.get<HTMLButtonElement>('.filter-dialog-trigger')
  await trigger.trigger('click')
  await vi.waitFor(() => expect(trigger.attributes('aria-expanded')).toBe('true'))

  const select = wrapper.getComponent(AppSelect)
  await select.get('.el-select__wrapper').trigger('click')
  await vi.waitFor(() => expect(select.get('input').attributes('aria-expanded')).toBe('true'))
  await select.get('input').trigger('keydown', { key: 'Escape', code: 'Escape' })
  await flushPromises()
  expect(cancel).not.toHaveBeenCalled()
  expect(trigger.attributes('aria-expanded')).toBe('true')

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
  expect(cancel).toHaveBeenCalledOnce()
  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger.element)
})

it('retains the draft after choosing a person in a separate dialog, then closes on an outside click', async () => {
  const cancel = vi.fn()
  wrapper = mount(
    {
      components: { FilterDialog, ProcessingPersonInput },
      setup: () => ({ opened: ref(false), choosing: ref(false), person: ref(''), cancel }),
      template: `
        <FilterDialog v-model="opened" :suspended="choosing" @cancel="cancel">
          <ProcessingPersonInput v-model="person" :options="['张工']" @open-change="choosing = $event" />
        </FilterDialog>`,
    },
    { attachTo: document.body },
  )
  await wrapper.get('.filter-dialog-trigger').trigger('click')
  const picker = wrapper.getComponent(ProcessingPersonInput)
  await picker.get('.person-trigger').trigger('click')
  await vi.waitFor(() => expect(document.querySelector('.person-choice')).not.toBeNull())
  const choice = document.querySelector<HTMLButtonElement>('.person-choice')!
  choice.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  choice.click()
  await flushPromises()
  // Popover outside-click handlers run after a child dialog has already closed.
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(picker.props('modelValue')).toBe('张工')
  expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(true)
  expect(cancel).not.toHaveBeenCalled()

  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  await flushPromises()
  expect(cancel).toHaveBeenCalledOnce()
  expect(wrapper.getComponent(FilterDialog).props('modelValue')).toBe(false)
})

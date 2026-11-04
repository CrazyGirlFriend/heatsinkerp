// @vitest-environment jsdom
import { computed, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ElDatePicker,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTableColumn,
} from 'element-plus'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'
import AppInput from './AppInput.vue'
import AppSelect from './AppSelect.vue'
import AppDatePicker from './AppDatePicker.vue'
import AppSwitch from './AppSwitch.vue'
import AppTabs from './AppTabs.vue'
import AppSkeleton from './AppSkeleton.vue'
import AppButton from './AppButton.vue'
import WatermelonDataTable from './watermelon/WatermelonDataTable.vue'

const global = { provide: { [workspaceAppearanceKey as symbol]: computed(() => 'watermelon') } }
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

describe('shared control adapters preserve business interaction', () => {
  it('forwards typing, clearing, disabled state and focus through the input adapter', async () => {
    const value = ref('691236-50')
    const wrapper = mount(
      {
        render: () =>
          h(AppInput, {
            modelValue: value.value,
            'onUpdate:modelValue': (next: string) => (value.value = next),
            clearable: true,
          }),
      },
      { global, attachTo: document.body },
    )
    wrappers.push(wrapper)
    await wrapper.get('input').setValue('691236-51')
    expect(value.value).toBe('691236-51')
    wrapper.getComponent(AppInput).vm.focus()
    expect(document.activeElement).toBe(wrapper.get('input').element)
    wrapper.getComponent(ElInput).vm.clear()
    await nextTick()
    expect(value.value).toBe('')
  })

  it('keeps multiple selections, remote loading, custom options and popup classes', async () => {
    const change = vi.fn()
    const wrapper = mount(AppSelect, {
      global,
      attrs: {
        modelValue: ['a'],
        multiple: true,
        filterable: true,
        loading: true,
        popperClass: 'business-menu',
        onChange: change,
      },
      slots: { default: () => h(ElOption, { value: 'a', label: '库房' }) },
    })
    wrappers.push(wrapper)
    const native = wrapper.getComponent(ElSelect)
    expect(native.props()).toMatchObject({
      multiple: true,
      filterable: true,
      loading: true,
      modelValue: ['a'],
    })
    expect(native.props('popperClass')).toContain('business-menu')
    expect(native.props('popperClass')).toContain('wm-control-menu')
    native.vm.$emit('change', ['a', 'b'])
    expect(change).toHaveBeenCalledOnce()
    expect(change).toHaveBeenCalledWith(['a', 'b'])
  })

  it.each(['date', 'datetime', 'daterange', 'datetimerange'])(
    'preserves %s precision, constraints and emitted values',
    async (type) => {
      const disabledDate = (date: Date) => date.getFullYear() < 2026
      const change = vi.fn()
      const wrapper = mount(AppDatePicker, {
        global,
        attrs: {
          type,
          valueFormat: 'YYYY-MM-DD HH:mm:ss',
          disabledDate,
          clearable: false,
          popperClass: 'order-date',
          'onUpdate:modelValue': change,
        },
      })
      wrappers.push(wrapper)
      const native = wrapper.getComponent(ElDatePicker)
      expect(native.props('type')).toBe(type)
      expect(native.props('disabledDate')).toBe(disabledDate)
      expect(native.props('valueFormat')).toBe('YYYY-MM-DD HH:mm:ss')
      expect(native.props('clearable')).toBe(false)
      expect(native.props('popperClass')).toContain('order-date')
      const value = type.includes('range')
        ? ['2026-11-05 08:00:00', '2026-11-06 17:00:00']
        : '2026-11-05 08:00:00'
      native.vm.$emit('update:modelValue', value)
      expect(change).toHaveBeenCalledOnce()
      expect(change).toHaveBeenCalledWith(value)
    },
  )

  it('respects a rejected switch change and a disabled switch', async () => {
    const change = vi.fn()
    const wrapper = mount(AppSwitch, {
      global,
      attrs: { modelValue: false, beforeChange: () => false, onChange: change },
    })
    wrappers.push(wrapper)
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(change).not.toHaveBeenCalled()
    await wrapper.setProps({ disabled: true })
    expect(wrapper.getComponent(ElSwitch).props('disabled')).toBe(true)
  })

  it('does not bypass beforeLeave when animating tab changes', async () => {
    const value = ref('one')
    const wrapper = mount(
      {
        render: () =>
          h(
            AppTabs,
            {
              modelValue: value.value,
              'onUpdate:modelValue': (next: string) => (value.value = next),
              beforeLeave: () => false,
            },
            () => [
              h(ElTabPane, { name: 'one', label: '基本信息' }, () => '当前内容'),
              h(ElTabPane, { name: 'two', label: '修改密码' }),
            ],
          ),
      },
      { global },
    )
    wrappers.push(wrapper)
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(value.value).toBe('one')
    expect(wrapper.text()).toContain('当前内容')
  })

  it('shows a skeleton initially and retains rows while refreshing', async () => {
    const wrapper = mount(WatermelonDataTable, {
      global,
      props: { loading: true, data: [] },
      slots: { default: () => h(ElTableColumn, { prop: 'serial', label: '流水号' }) },
    })
    wrappers.push(wrapper)
    expect(wrapper.findComponent(AppSkeleton).exists()).toBe(true)
    await wrapper.setProps({ data: [{ serial: '691236-50' }], loading: false })
    await flushPromises()
    expect(wrapper.text()).toContain('691236-50')
    await wrapper.setProps({ loading: true })
    expect(wrapper.text()).toContain('691236-50')
    expect(wrapper.classes()).toContain('is-refreshing')
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })

  it('retains custom document skeletons and resolves to real content', async () => {
    const wrapper = mount(AppSkeleton, {
      props: { loading: true },
      slots: {
        template: '<div class="document-placeholder">预览加载中</div>',
        default: '<article>文件原稿</article>',
      },
    })
    wrappers.push(wrapper)
    expect(wrapper.find('.document-placeholder').exists()).toBe(true)
    await wrapper.setProps({ loading: false })
    await flushPromises()
    expect(wrapper.text()).toContain('文件原稿')
  })

  it('disables repeated saves while preserving button width content and accessible name', async () => {
    const click = vi.fn()
    const wrapper = mount(AppButton, {
      global,
      props: { loading: true },
      attrs: { onClick: click, 'aria-label': '保存排期' },
      slots: { default: '保存排期' },
    })
    wrappers.push(wrapper)
    await wrapper.get('button').trigger('click')
    expect(click).not.toHaveBeenCalled()
    expect(wrapper.text()).toBe('保存排期')
    expect(wrapper.attributes('aria-busy')).toBe('true')
    await wrapper.setProps({ loading: false })
    await wrapper.get('button').trigger('click')
    expect(click).toHaveBeenCalledOnce()
  })
})

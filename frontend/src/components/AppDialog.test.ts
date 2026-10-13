// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppDialog from './AppDialog.vue'
import AppDrawer from './AppDrawer.vue'

const glass = vi.hoisted(() => ({ enhance: vi.fn() }))
vi.mock('@/utils/glassDialog', () => ({ enhanceGlassDialog: glass.enhance }))

function surfaceStub(name: string, rootClass: string) {
  return defineComponent({
    name,
    props: [
      'modelValue',
      'title',
      'width',
      'size',
      'top',
      'alignCenter',
      'appendToBody',
      'appendTo',
      'destroyOnClose',
      'showClose',
      'closeOnClickModal',
      'closeOnPressEscape',
      'modal',
      'modalClass',
      'lockScroll',
    ],
    emits: ['update:modelValue', 'open', 'opened', 'close', 'closed'],
    setup(props, { emit, slots }) {
      return () =>
        props.modelValue
          ? h('section', { class: rootClass }, [
              h(
                'header',
                slots.header
                  ? slots.header({
                      close: () => emit('update:modelValue', false),
                      titleId: 'surface-title',
                      titleClass: `${rootClass}__title`,
                    })
                  : props.title,
              ),
              h('main', slots.default?.()),
              slots.footer ? h('footer', { class: `${rootClass}__footer` }, slots.footer()) : null,
            ])
          : null
    },
  })
}
const DialogStub = surfaceStub('ElDialog', 'el-dialog')
const DrawerStub = surfaceStub('ElDrawer', 'el-drawer')
const stubs = { ElDialog: DialogStub, ElDrawer: DrawerStub }
const wrappers: VueWrapper[] = []
const hosts: HTMLElement[] = []
function host() {
  const node = document.createElement('div')
  document.body.append(node)
  hosts.push(node)
  return node
}
async function settle() {
  await vi.dynamicImportSettled()
  await flushPromises()
}
beforeEach(() => {
  glass.enhance.mockReset().mockImplementation(() => vi.fn())
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  for (const node of hosts.splice(0)) node.remove()
})

for (const [name, component, native, rootClass] of [
  ['dialog', AppDialog, DialogStub, 'el-dialog'],
  ['drawer', AppDrawer, DrawerStub, 'el-drawer'],
] as const) {
  describe(`App ${name} presentation shell`, () => {
    it('forwards layout, close protections, fullscreen target and scoped slots without changing the form', async () => {
      const appendTo = host()
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        attrs: {
          title: '库存明细',
          width: '84vw',
          size: 380,
          top: '5vh',
          alignCenter: true,
          appendToBody: true,
          appendTo,
          destroyOnClose: true,
          showClose: false,
          closeOnClickModal: false,
          closeOnPressEscape: false,
          modal: false,
          modalClass: 'business-overlay',
          lockScroll: false,
          class: 'business-dialog',
          'data-purpose': 'stock',
        },
        slots: {
          header: ({ close, titleId, titleClass }) =>
            h(
              'button',
              {
                id: titleId,
                class: titleClass,
                onClick: close,
              },
              '自定义标题',
            ),
          default: () => h('input', { value: '业务输入', 'aria-label': '流水号' }),
          footer: () => h('button', '确认'),
        },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      expect(element.props()).toMatchObject({
        title: '库存明细',
        width: '84vw',
        size: 380,
        top: '5vh',
        alignCenter: true,
        appendToBody: true,
        appendTo,
        destroyOnClose: true,
        showClose: false,
        closeOnClickModal: false,
        closeOnPressEscape: false,
        modal: false,
        lockScroll: false,
      })
      expect(element.props('modalClass')).toBe(
        name === 'drawer' ? 'business-overlay' : 'app-glass-overlay business-overlay',
      )
      expect(wrapper.get(`.${rootClass}`).classes()).toEqual(
        expect.arrayContaining(['business-dialog', 'app-glass-surface', `app-glass-${name}`]),
      )
      expect(wrapper.get(`.${rootClass}`).attributes('data-purpose')).toBe('stock')
      expect(wrapper.get('#surface-title').classes()).toContain(`${rootClass}__title`)
      expect((wrapper.get('input').element as HTMLInputElement).value).toBe('业务输入')
      expect(wrapper.get('footer').text()).toBe('确认')
      await wrapper.get('#surface-title').trigger('click')
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
      expect(glass.enhance).not.toHaveBeenCalled()
    })

    it('does not insert an empty footer and preserves slots added after mounting', async () => {
      const Parent = defineComponent({
        props: { footer: Boolean },
        setup: (props) => () =>
          h(
            component,
            { modelValue: true, title: '默认标题' },
            {
              default: () => h('p', '内容'),
              ...(props.footer ? { footer: () => h('button', '保存') } : {}),
            },
          ),
      })
      const wrapper = mount(Parent, { attachTo: host(), global: { stubs } })
      wrappers.push(wrapper)
      expect(wrapper.getComponent(native).props('modalClass')).toBe('app-glass-overlay')
      expect(wrapper.get('header').text()).toBe('默认标题')
      expect(wrapper.find('footer').exists()).toBe(false)
      await wrapper.setProps({ footer: true })
      expect(wrapper.get('footer').text()).toBe('保存')
      await wrapper.setProps({ footer: false })
      expect(wrapper.find('footer').exists()).toBe(false)
    })

    it('forwards lifecycle events once and cleans up immediately when closing', async () => {
      const events = { onOpen: vi.fn(), onOpened: vi.fn(), onClose: vi.fn(), onClosed: vi.fn() }
      const cleanup = vi.fn()
      glass.enhance.mockReturnValue(cleanup)
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        attrs: events,
        slots: { default: '内容' },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      element.vm.$emit('open')
      element.vm.$emit('opened')
      expect(events.onOpen).toHaveBeenCalledOnce()
      expect(events.onOpened).toHaveBeenCalledOnce()
      expect(glass.enhance).not.toHaveBeenCalled()
      await settle()
      expect(glass.enhance).toHaveBeenCalledOnce()
      expect(glass.enhance).toHaveBeenCalledWith(wrapper.get(`.${rootClass}`).element)
      element.vm.$emit('close')
      expect(cleanup).toHaveBeenCalledOnce()
      element.vm.$emit('closed')
      await wrapper.setProps({ modelValue: false })
      wrapper.unmount()
      expect(events.onClose).toHaveBeenCalledOnce()
      expect(events.onClosed).toHaveBeenCalledOnce()
      expect(cleanup).toHaveBeenCalledOnce()
    })

    it('discards a closed opening before enhancement settles and can reopen normally', async () => {
      const cleanup = vi.fn()
      glass.enhance.mockReturnValue(cleanup)
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      element.vm.$emit('opened')
      element.vm.$emit('close')
      await wrapper.setProps({ modelValue: false })
      await settle()
      expect(glass.enhance).not.toHaveBeenCalled()
      await wrapper.setProps({ modelValue: true })
      element.vm.$emit('opened')
      await settle()
      expect(glass.enhance).toHaveBeenCalledOnce()
      await wrapper.setProps({ modelValue: false })
      expect(cleanup).toHaveBeenCalledOnce()
    })

    it('does not enhance an unmounted surface or duplicate concurrent opening events', async () => {
      const cleanup = vi.fn()
      glass.enhance.mockReturnValue(cleanup)
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      element.vm.$emit('opened')
      element.vm.$emit('opened')
      await settle()
      expect(glass.enhance).toHaveBeenCalledOnce()
      element.vm.$emit('opened')
      expect(cleanup).toHaveBeenCalledOnce()
      wrapper.unmount()
      await settle()
      expect(glass.enhance).toHaveBeenCalledOnce()
      expect(cleanup).toHaveBeenCalledOnce()
    })

    it('keeps the original form and close actions usable if the optional effect fails', async () => {
      glass.enhance.mockImplementation(() => {
        throw new Error('WebGL unavailable')
      })
      const onClose = vi.fn()
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        attrs: { onClose },
        slots: { default: () => h('input', { 'aria-label': '流水号' }) },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      element.vm.$emit('opened')
      await settle()
      await wrapper.get('input').setValue('YS-001')
      expect((wrapper.get('input').element as HTMLInputElement).value).toBe('YS-001')
      element.vm.$emit('close')
      expect(onClose).toHaveBeenCalledOnce()
    })
  })
}

it('binds nested shells to their own connected roots and closing the child keeps the parent active', async () => {
  const parentCleanup = vi.fn()
  const childCleanup = vi.fn()
  glass.enhance.mockImplementation((root: HTMLElement) =>
    root.classList.contains('el-dialog') ? parentCleanup : childCleanup,
  )
  const wrapper = mount(AppDialog, {
    attachTo: host(),
    props: { modelValue: true },
    slots: {
      default: () => h(AppDrawer, { modelValue: true }, () => h('input', { value: '内层' })),
    },
    global: { stubs },
  })
  wrappers.push(wrapper)
  const parent = wrapper.getComponent(DialogStub)
  const child = wrapper.getComponent(DrawerStub)
  parent.vm.$emit('opened')
  child.vm.$emit('opened')
  await settle()
  expect(glass.enhance).toHaveBeenCalledTimes(2)
  expect(glass.enhance).toHaveBeenCalledWith(wrapper.get('.el-dialog').element)
  expect(glass.enhance).toHaveBeenCalledWith(wrapper.get('.el-drawer').element)
  child.vm.$emit('close')
  child.vm.$emit('closed')
  expect(childCleanup).toHaveBeenCalledOnce()
  expect(parentCleanup).not.toHaveBeenCalled()
  wrapper.unmount()
  expect(parentCleanup).toHaveBeenCalledOnce()
  expect(childCleanup).toHaveBeenCalledOnce()
})

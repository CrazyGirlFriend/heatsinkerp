// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppDialog from './AppDialog.vue'
import AppDrawer from './AppDrawer.vue'

const glass = vi.hoisted(() => ({ enhance: vi.fn() }))
vi.mock('@/utils/glassDialog', () => ({ enhanceGlassDialog: glass.enhance }))

function surfaceStub(name: string, rootClass: string, withOverlay = false) {
  return defineComponent({
    name,
    inheritAttrs: false,
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
      'transition',
      'zIndex',
    ],
    emits: ['update:modelValue', 'open', 'opened', 'close', 'closed'],
    setup(props, { attrs, emit, slots }) {
      return () => {
        const content = props.modelValue
          ? h('section', { ...attrs, class: [rootClass, attrs.class] }, [
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
        return withOverlay
          ? h('div', { class: ['el-overlay', props.modalClass], style: { zIndex: props.zIndex } }, [
              content,
            ])
          : content
      }
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

    it('forwards lifecycle events once and preserves the optical layer until the exit finishes', async () => {
      const events = { onOpen: vi.fn(), onOpened: vi.fn(), onClose: vi.fn(), onClosed: vi.fn() }
      const cleanup = Object.assign(vi.fn(), { freeze: vi.fn() })
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
      expect(events.onClose).toHaveBeenCalledOnce()
      expect(cleanup.freeze).toHaveBeenCalledOnce()
      expect(cleanup).not.toHaveBeenCalled()
      await wrapper.setProps({ modelValue: false })
      expect(cleanup).not.toHaveBeenCalled()
      element.vm.$emit('closed')
      expect(cleanup).toHaveBeenCalledOnce()
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
      expect(cleanup).not.toHaveBeenCalled()
      element.vm.$emit('closed')
      expect(cleanup).toHaveBeenCalledOnce()
    })

    it('cancels pending enhancement when closing without waiting for the model update', async () => {
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      element.vm.$emit('opened')
      element.vm.$emit('close')
      await settle()
      expect(glass.enhance).not.toHaveBeenCalled()
      element.vm.$emit('closed')
    })

    it('replaces the retained layer once when reopened before the previous exit finishes', async () => {
      const firstCleanup = vi.fn()
      const secondCleanup = vi.fn()
      glass.enhance.mockReturnValueOnce(firstCleanup).mockReturnValueOnce(secondCleanup)
      const wrapper = mount(component, {
        attachTo: host(),
        props: { modelValue: true },
        global: { stubs },
      })
      wrappers.push(wrapper)
      const element = wrapper.getComponent(native)
      element.vm.$emit('opened')
      await settle()
      element.vm.$emit('close')
      await wrapper.setProps({ modelValue: false })
      expect(firstCleanup).not.toHaveBeenCalled()
      await wrapper.setProps({ modelValue: true })
      element.vm.$emit('opened')
      await settle()
      expect(firstCleanup).toHaveBeenCalledOnce()
      expect(glass.enhance).toHaveBeenCalledTimes(2)
      expect(glass.enhance).toHaveBeenLastCalledWith(wrapper.get(`.${rootClass}`).element)
      expect(secondCleanup).not.toHaveBeenCalled()
      element.vm.$emit('close')
      await wrapper.setProps({ modelValue: false })
      expect(secondCleanup).not.toHaveBeenCalled()
      element.vm.$emit('closed')
      wrapper.unmount()
      expect(firstCleanup).toHaveBeenCalledOnce()
      expect(secondCleanup).toHaveBeenCalledOnce()
    })

    it('releases a retained layer if its owner unmounts before the exit finishes', async () => {
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
      await settle()
      element.vm.$emit('close')
      await wrapper.setProps({ modelValue: false })
      expect(cleanup).not.toHaveBeenCalled()
      wrapper.unmount()
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

it('uses the shared dialog transition while preserving native transition overrides', async () => {
  const wrapper = mount(AppDialog, {
    attachTo: host(),
    props: { modelValue: true },
    global: { stubs },
  })
  wrappers.push(wrapper)
  const element = wrapper.getComponent(DialogStub)
  expect(element.props('transition')).toBe('app-dialog')
  await wrapper.setProps({ transition: 'custom-dialog' })
  expect(element.props('transition')).toBe('custom-dialog')
  const transition = { name: 'custom-dialog', onAfterEnter: vi.fn() }
  await wrapper.setProps({ transition })
  expect(element.props('transition')).toEqual(transition)
})

for (const [parentName, parentComponent, parentNative] of [
  ['dialog', AppDialog, DialogStub],
  ['drawer', AppDrawer, DrawerStub],
] as const) {
  for (const [childName, childComponent, childNative] of [
    ['dialog', AppDialog, DialogStub],
    ['drawer', AppDrawer, DrawerStub],
  ] as const) {
    it(`uses a lighter nested overlay for a ${childName} inside a ${parentName}`, () => {
      const wrapper = mount(parentComponent, {
        attachTo: host(),
        props: { modelValue: true },
        slots: {
          default: () =>
            h(childComponent, { modelValue: true, modalClass: 'child-overlay' }, () => '内容'),
        },
        global: { stubs },
      })
      wrappers.push(wrapper)
      expect(wrapper.getComponent(parentNative).props('modalClass')).toBe('app-glass-overlay')
      const child = wrapper.findAllComponents(childNative).at(-1)!
      expect(child.props('modalClass')).toBe(
        'app-glass-overlay app-glass-overlay--nested child-overlay',
      )
    })
  }
}

it('does not count a nonmodal drawer as an existing overlay and reacts when it becomes modal', async () => {
  const wrapper = mount(AppDrawer, {
    attachTo: host(),
    props: { modelValue: true, modal: false, modalClass: 'drawer-overlay' },
    slots: { default: () => h(AppDialog, { modelValue: true }, () => '内容') },
    global: { stubs },
  })
  wrappers.push(wrapper)
  const drawer = wrapper.getComponent(DrawerStub)
  const dialog = wrapper.getComponent(DialogStub)
  expect(drawer.props('modalClass')).toBe('drawer-overlay')
  expect(dialog.props('modalClass')).toBe('app-glass-overlay')
  await wrapper.setProps({ modal: true })
  expect(drawer.props('modalClass')).toBe('app-glass-overlay drawer-overlay')
  expect(dialog.props('modalClass')).toBe('app-glass-overlay app-glass-overlay--nested')
})

it('does not add an optical overlay to a nonmodal drawer nested inside a dialog', () => {
  const wrapper = mount(AppDialog, {
    attachTo: host(),
    props: { modelValue: true },
    slots: {
      default: () =>
        h(AppDrawer, { modelValue: true, modal: false, modalClass: 'drawer-overlay' }, () =>
          h(AppDialog, { modelValue: true }, () => '内容'),
        ),
    },
    global: { stubs },
  })
  wrappers.push(wrapper)
  expect(wrapper.getComponent(DrawerStub).props('modalClass')).toBe('drawer-overlay')
  const dialogs = wrapper.findAllComponents(DialogStub)
  expect(dialogs[0]!.props('modalClass')).toBe('app-glass-overlay')
  expect(dialogs[1]!.props('modalClass')).toBe('app-glass-overlay app-glass-overlay--nested')
})

describe('visible sibling modal overlays', () => {
  const ModalDialogStub = surfaceStub('ElDialog', 'el-dialog', true)
  const ModalDrawerStub = surfaceStub('ElDrawer', 'el-drawer', true)
  const modalStubs = { ElDialog: ModalDialogStub, ElDrawer: ModalDrawerStub }
  let rects: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { length: this.isConnected ? 1 : 0 } as DOMRectList
    })
  })
  afterEach(() => rects.mockRestore())

  for (const [name, component, native] of [
    ['dialog', AppDialog, ModalDialogStub],
    ['drawer', AppDrawer, ModalDrawerStub],
  ] as const) {
    it(`gives a logical sibling ${name} a nested overlay before its entrance finishes`, async () => {
      const onOpen = vi.fn()
      const Parent = defineComponent({
        props: { childOpen: Boolean },
        setup: (props) => () =>
          h('div', [
            h(AppDialog, { modelValue: true, zIndex: 2000 }, () => '背景详情'),
            h(component, { modelValue: props.childOpen, zIndex: 2001, onOpen }, () => '人员选择'),
          ]),
      })
      const wrapper = mount(Parent, { attachTo: host(), global: { stubs: modalStubs } })
      wrappers.push(wrapper)
      await wrapper.setProps({ childOpen: true })
      const child = wrapper.findAllComponents(native).at(-1)!
      child.vm.$emit('open')
      expect(onOpen).toHaveBeenCalledOnce()
      await settle()
      expect(child.props('modalClass')).toBe('app-glass-overlay app-glass-overlay--nested')
      expect(wrapper.findAllComponents(ModalDialogStub)[0]!.props('modalClass')).toBe(
        'app-glass-overlay',
      )
      child.vm.$emit('opened')
      await settle()
      expect(onOpen).toHaveBeenCalledOnce()
    })
  }

  for (const hidden of ['display', 'visibility', 'hidden'] as const) {
    it(`does not count a sibling modal hidden by ${hidden}`, async () => {
      const Parent = defineComponent({
        setup: () => () =>
          h('div', [
            h(AppDialog, { modelValue: true, zIndex: 2000 }, () => '隐藏详情'),
            h(AppDrawer, { modelValue: true, zIndex: 2001 }, () => '独立抽屉'),
          ]),
      })
      const wrapper = mount(Parent, { attachTo: host(), global: { stubs: modalStubs } })
      wrappers.push(wrapper)
      const background = wrapper.getComponent(ModalDialogStub).element as HTMLElement
      if (hidden === 'display') background.style.display = 'none'
      else if (hidden === 'visibility') background.style.visibility = 'hidden'
      else background.hidden = true
      const drawer = wrapper.getComponent(ModalDrawerStub)
      drawer.vm.$emit('open')
      await settle()
      expect(drawer.props('modalClass')).toBe('app-glass-overlay')
    })
  }

  it('does not count a nonmodal sibling drawer as a background modal', async () => {
    const Parent = defineComponent({
      setup: () => () =>
        h('div', [
          h(AppDrawer, { modelValue: true, modal: false, zIndex: 2000 }, () => '无模态抽屉'),
          h(AppDialog, { modelValue: true, zIndex: 2001 }, () => '独立对话框'),
        ]),
    })
    const wrapper = mount(Parent, { attachTo: host(), global: { stubs: modalStubs } })
    wrappers.push(wrapper)
    const dialog = wrapper.getComponent(ModalDialogStub)
    dialog.vm.$emit('open')
    await settle()
    expect(dialog.props('modalClass')).toBe('app-glass-overlay')
  })

  it('does not restyle a background modal when its sibling is above it', async () => {
    const Parent = defineComponent({
      setup: () => () =>
        h('div', [
          h(AppDialog, { modelValue: true, zIndex: 2000 }, () => '背景详情'),
          h(AppDrawer, { modelValue: true, zIndex: 2001 }, () => '上层抽屉'),
        ]),
    })
    const wrapper = mount(Parent, { attachTo: host(), global: { stubs: modalStubs } })
    wrappers.push(wrapper)
    const dialog = wrapper.getComponent(ModalDialogStub)
    dialog.vm.$emit('open')
    await settle()
    expect(dialog.props('modalClass')).toBe('app-glass-overlay')
  })
})

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

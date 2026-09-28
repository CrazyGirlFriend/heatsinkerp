// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import MaterialTransferDetailFrame from './MaterialTransferDetailFrame.vue'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())
async function render(busy = false) {
  wrapper = mount(MaterialTransferDetailFrame, {
    props: { modelValue: true, busy },
    slots: { header: '<h2>批次详情</h2>', default: '<p>原单资料</p>', footer: '<button>确认签收</button>' },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return wrapper.getComponent({ name: 'ElDialog' })
}

describe('centered material detail frame', () => {
  it('uses a centered modal with original header, document and footer rather than a side panel', async () => {
    const dialog = await render()
    expect(dialog.props()).toMatchObject({ alignCenter: true, appendToBody: true, modal: true, lockScroll: true, width: 'min(1080px, calc(100vw - 32px))' })
    for (const text of ['批次详情', '原单资料', '确认签收']) expect(wrapper.text()).toContain(text)
    expect(wrapper.find('aside, .el-drawer').exists()).toBe(false)
    dialog.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('retains confirmation and mutation close protection', async () => {
    const dialog = await render(true)
    expect(dialog.props()).toMatchObject({ showClose: false, closeOnClickModal: false, closeOnPressEscape: false })
    dialog.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ busy: false })
    expect(dialog.props()).toMatchObject({ showClose: true, closeOnClickModal: true, closeOnPressEscape: true })
    dialog.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('does not close the document when it is temporarily hidden for a historical group', async () => {
    const dialog = await render()
    await wrapper.setProps({ modelValue: false })
    await flushPromises()
    dialog.vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ modelValue: true })
    expect(dialog.props('modelValue')).toBe(true)
  })
})

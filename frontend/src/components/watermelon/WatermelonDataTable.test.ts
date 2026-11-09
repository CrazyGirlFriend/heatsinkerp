// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { ElTableColumn } from 'element-plus'
import { afterEach, describe, expect, it } from 'vitest'
import WatermelonDataTable from './WatermelonDataTable.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('WatermelonDataTable horizontal scrolling', () => {
  it.each([
    { name: 'empty', data: [] },
    { name: 'populated', data: [{ serial: '691236-50' }] },
  ])('forwards header and Shift-wheel gestures in a $name table', async ({ data }) => {
    const wrapper = mount(WatermelonDataTable, {
      props: { data },
      slots: { default: '<ElTableColumn prop="serial" label="流水号" width="1200" />' },
      global: { components: { ElTableColumn } },
    })
    wrappers.push(wrapper)
    await flushPromises()
    const wrap = wrapper.get('.el-scrollbar__wrap').element
    Object.defineProperties(wrap, {
      clientWidth: { value: 600 },
      scrollWidth: { value: 1200 },
    })
    const header = wrapper.get('.el-table__header-wrapper .cell').element
    const wheel = (element: Element, options: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options })
      element.dispatchEvent(event)
      return event
    }

    expect(wheel(header, { deltaX: 180 }).defaultPrevented).toBe(true)
    expect(wrap.scrollLeft).toBe(180)
    expect(wheel(wrap, { deltaY: 120, shiftKey: true }).defaultPrevented).toBe(true)
    expect(wrap.scrollLeft).toBe(300)

    // Ordinary body scrolling and browser zoom retain their native behavior.
    expect(wheel(wrap, { deltaY: 100 }).defaultPrevented).toBe(false)
    expect(wheel(wrap, { deltaX: 100 }).defaultPrevented).toBe(false)
    expect(wheel(wrap, { deltaX: 100, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(wrap.scrollLeft).toBe(300)
  })
})

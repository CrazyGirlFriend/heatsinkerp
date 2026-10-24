// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ImportedDocumentPreview from './ImportedDocumentPreview.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import AppDialog from './AppDialog.vue'
import { routeFixture } from '@/testFixtures/processRoute'

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())
function render(currentValues?: Record<string, string | number | null | undefined>) {
  const route = structuredClone(routeFixture)
  route.source_data.receipt_fields = {
    serial_no: {
      value: 'S-001',
      label: '流水号',
      source_row: '1:1',
      source_label: '流水号',
    },
    pieces: {
      value: 41,
      label: '来料件数',
      source_row: '1:2',
      source_label: '来料数量',
    },
  }
  route.source_data.field_warnings = ['来料重量未注明单位，请核对']
  wrapper = mount(ImportedDocumentPreview, {
    props: { route, currentValues },
    global: {
      stubs: {
        WordDocumentPreview: { props: ['route'], template: '<div>只读 Word 原件</div>' },
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
      },
    },
  })
  return route
}
async function tab(label: string) {
  await wrapper
    .findAll('[role="tab"]')
    .find((item) => item.text() === label)!
    .trigger('click')
  await flushPromises()
}

describe('导入工艺单原件与字段对照', () => {
  it('opens the original file by default rather than rebuilding it from parsed fields', () => {
    const route = render()
    expect(wrapper.getComponent(WordDocumentPreview).props('route')).toEqual(route)
    expect(wrapper.find('[aria-label="导入字段对照"]').exists()).toBe(false)
    expect(
      wrapper
        .findAll('[role="tab"]')
        .find((item) => item.text() === '原文件')!
        .attributes('aria-selected'),
    ).toBe('true')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('shows comparison only after selecting its tab and preserves source values after edits', async () => {
    const route = render({ serial_no: 'S-001', pieces: '41' })
    await tab('字段对照')
    const serial = wrapper.get('[data-field="serial_no"]')
    expect(serial.text()).toContain('流水号')
    expect(serial.text()).toContain('已带入')
    expect(wrapper.get('[data-field="pieces"]').text()).toContain('已带入')
    await wrapper.setProps({ currentValues: { serial_no: 'S-002', pieces: undefined } })
    expect(serial.text()).toContain('S-001')
    expect(serial.text()).toContain('S-002')
    expect(serial.text()).toContain('已修改')
    expect(wrapper.get('[data-field="pieces"]').text()).toContain('未填写')
    expect(route.source_data.receipt_fields!.serial_no!.value).toBe('S-001')
    expect(wrapper.text()).toContain('来料重量未注明单位，请核对')
  })

  it('locates the form field and retains its source row when returning to the original file', async () => {
    render()
    await tab('字段对照')
    await wrapper.get('[data-field="pieces"] button').trigger('click')
    expect(wrapper.emitted('focus-field')).toEqual([['pieces']])
    expect(wrapper.get('[data-field="pieces"] button').classes()).toContain(
      'document-preview-field--active',
    )
    await tab('原文件')
    expect(wrapper.get('.document-preview-selected').text()).toBe('来料件数 · 原表 1 · 第 2 行')
    expect(wrapper.findAllComponents(WordDocumentPreview)).toHaveLength(1)
  })

  it('retains the larger read-only original during exit and destroys it after closed', async () => {
    const route = render()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '放大预览')!
      .trigger('click')
    expect(wrapper.getComponent(AppDialog).attributes('width')).toBe('min(1320px, 96vw)')
    expect(wrapper.findAllComponents(WordDocumentPreview)).toHaveLength(2)
    expect(wrapper.findAllComponents(WordDocumentPreview)[1]!.props('route')).toEqual(route)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '关闭预览')!
      .trigger('click')
    expect(wrapper.findComponent(AppDialog).exists()).toBe(true)
    expect(wrapper.getComponent(AppDialog).attributes('modelvalue')).toBe('false')
    expect(wrapper.findAllComponents(WordDocumentPreview)).toHaveLength(2)
    wrapper.getComponent(AppDialog).vm.$emit('closed')
    await flushPromises()
    expect(wrapper.findComponent(AppDialog).exists()).toBe(false)
    expect(wrapper.findAllComponents(WordDocumentPreview)).toHaveLength(1)
    expect(wrapper.findAll('input,textarea')).toHaveLength(0)
  })

  it('keeps the original available when an older draft has no extracted comparison fields', async () => {
    const route = render()
    delete route.source_data.receipt_fields
    await wrapper.setProps({ route: { ...route } })
    expect(wrapper.getComponent(WordDocumentPreview).props('route').filename).toBe('工艺.docx')
    await tab('字段对照')
    expect(wrapper.find('[aria-label="导入字段对照"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂无可对照的导入字段')
  })

  it('renders extracted comparison content as safe text', async () => {
    const route = render()
    const untrusted = '<img src=x onerror="alert(1)">'
    route.source_data.receipt_fields!.serial_no!.value = untrusted
    await wrapper.setProps({ route: { ...route } })
    await tab('字段对照')
    expect(wrapper.text()).toContain(untrusted)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
  })
})

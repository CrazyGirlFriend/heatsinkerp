// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, reactive } from 'vue'
import { ElCheckbox, ElInput, ElTableColumn } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ColumnManagedTable from './ColumnManagedTable.vue'
import TableColumnFilter from './TableColumnFilter.vue'
import { useTableQuery } from '@/composables/useTableQuery'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import AppDetailTable from './AppDetailTable.vue'
import { tableColumnScopeKey } from '@/utils/tableColumnLayout'

const account = reactive({ currentUser: { id: 7 } })
let wrapper: VueWrapper
const global = {
  provide: { [tableColumnScopeKey as symbol]: computed(() => account.currentUser.id) },
  stubs: { ElPopover: { template: '<span><slot name="reference"/><aside><slot/></aside></span>' } },
}
beforeEach(() => {
  localStorage.clear()
  account.currentUser.id = 7
})
afterEach(() => wrapper?.unmount())
function header() {
  return wrapper
    .findAll('.el-table__header th .cell')
    .map((cell) =>
      cell.find('.table-column-heading__label').exists()
        ? cell.get('.table-column-heading__label').text()
        : cell.text(),
    )
}
async function open() {
  const settings = wrapper.getComponent({ name: 'InventoryColumnSettings' })
  ;(settings.vm as unknown as { open: () => void }).open()
  await flushPromises()
  return settings
}
async function apply() {
  const settings = wrapper.getComponent({ name: 'InventoryColumnSettings' })
  await settings
    .findAll('button')
    .find((button) => button.text() === '应用')!
    .trigger('click')
  await flushPromises()
}
async function render(key = 'test-records') {
  wrapper = mount(
    defineComponent({
      components: { ColumnManagedTable, ElTableColumn, ElInput },
      data: () => ({ rows: [{ serial: '691236-50', quantity: 30 }], edited: '', selected: [] }),
      template: `<ColumnManagedTable columns-key="${key}" :data="rows" :required-columns="['数量']"
      @selection-change="selected = $event">
      <ElTableColumn type="selection"/>
      <ElTableColumn prop="serial" label="流水号"/>
      <ElTableColumn prop="quantity" label="数量"/>
      <ElTableColumn label="备注"><template #default><ElInput v-model="edited" aria-label="备注"/></template></ElTableColumn>
      <ElTableColumn label="操作"><template #default><button>查看</button></template></ElTableColumn>
    </ColumnManagedTable>`,
    }),
    { global },
  )
  await flushPromises()
}

describe('shared table columns', () => {
  it('offers query menus on fixed and normal columns without evaluating body slots early', async () => {
    const query = useTableQuery(
      { serial: { field: 'serial' }, quantity: { field: 'quantity', kind: 'number' } },
      () => {},
    )
    wrapper = mount(
      defineComponent({
        components: { ColumnManagedTable, ElTableColumn },
        setup: () => ({ query }),
        template: `<ColumnManagedTable :column-settings="false" :column-query="query.controller.value" :data="[{serial:'A', quantity:10}]">
        <ElTableColumn prop="serial" label="流水号" fixed/><ElTableColumn prop="quantity" label="数量"/>
        <ElTableColumn label="操作"><template #default>查看</template></ElTableColumn>
      </ColumnManagedTable>`,
      }),
      { global },
    )
    await flushPromises()
    const controls = wrapper.findAllComponents(TableColumnFilter)
    expect(controls.map((item) => item.props('label'))).toEqual(['流水号', '数量'])
    controls[1]!.vm.$emit('apply', '5', '20')
    controls[1]!.vm.$emit('sort', 'desc')
    await flushPromises()
    expect(query.state.value.filters[0]?.field).toBe('quantity')
    expect(query.state.value.sort).toEqual({ field: 'quantity', direction: 'desc' })
    expect(wrapper.get('.el-table__body').text()).toContain('A')
  })

  it('reorders and hides columns without mixing up cells, selections or edit values', async () => {
    await render()
    await wrapper.get('input[aria-label="备注"]').setValue('已核对')
    await wrapper.get('.el-table__body .el-checkbox input').setValue(true)
    const settings = await open()
    expect(
      settings
        .findAllComponents(ElCheckbox)
        .find((item) => item.text() === '数量')!
        .props('disabled'),
    ).toBe(true)
    await settings.get('[aria-label="上移数量"]').trigger('click')
    settings
      .findAllComponents(ElCheckbox)
      .find((item) => item.text() === '流水号')!
      .vm.$emit('update:modelValue', false)
    await apply()
    expect(header().slice(1)).toEqual(['数量', '备注', '操作'])
    expect(wrapper.get('.el-table__body').text()).toContain('30')
    expect((wrapper.get('input[aria-label="备注"]').element as HTMLInputElement).value).toBe(
      '已核对',
    )
    expect((wrapper.vm as unknown as { selected: unknown[] }).selected).toHaveLength(1)
    expect(wrapper.get('.el-table__body').text()).not.toContain('691236-50')
  })

  it('remembers choices separately for each table and account, and restores defaults', async () => {
    await render()
    const settings = await open()
    settings
      .findAllComponents(ElCheckbox)
      .find((item) => item.text() === '备注')!
      .vm.$emit('update:modelValue', false)
    await apply()
    wrapper.unmount()
    await render()
    expect(wrapper.find('input[aria-label="备注"]').exists()).toBe(false)
    account.currentUser.id = 8
    await flushPromises()
    expect(wrapper.find('input[aria-label="备注"]').exists()).toBe(true)
    wrapper.unmount()
    account.currentUser.id = 7
    await render('other-records')
    expect(wrapper.find('input[aria-label="备注"]').exists()).toBe(true)
    wrapper.unmount()
    await render()
    const restored = await open()
    await restored
      .findAll('button')
      .find((button) => button.text() === '恢复默认')!
      .trigger('click')
    await apply()
    expect(wrapper.find('input[aria-label="备注"]').exists()).toBe(true)
  })

  it('reorders native header, column widths and body together, including full-width details', async () => {
    wrapper = mount(
      defineComponent({
        components: { AppDetailTable },
        data: () => ({ quantity: 123 }),
        template: `<AppDetailTable columns-key="native">
        <colgroup><col style="width:100px"/><col style="width:200px"/><col/></colgroup>
        <thead><tr><th>流水号</th><th>数量</th><th>操作</th></tr></thead>
        <tbody><tr><td>691236-50</td><td>{{ quantity }}</td><td><button>查看</button></td></tr>
          <tr><td colspan="2">备料与转出</td><td><button>查看库房</button></td></tr>
          <tr><td colspan="3">完整详情</td></tr></tbody>
      </AppDetailTable>`,
      }),
      { global },
    )
    await flushPromises()
    const settings = await open()
    await settings.get('[aria-label="上移数量"]').trigger('click')
    settings
      .findAllComponents(ElCheckbox)
      .find((item) => item.text() === '流水号')!
      .vm.$emit('update:modelValue', false)
    await apply()
    expect(wrapper.findAll('tbody tr:first-child td').map((cell) => cell.text())).toEqual([
      '123',
      '查看',
    ])
    expect(wrapper.get('col').attributes('style')).toContain('200px')
    expect(wrapper.get('tbody tr:last-child td').attributes('colspan')).toBe('2')
    expect(wrapper.get('thead th').text()).toContain('数量')
    const merged = wrapper.get('tbody tr:nth-child(2)')
    expect(merged.findAll('td').map((cell) => cell.text())).toEqual(['备料与转出', '查看库房'])
    expect(merged.get('td').attributes('colspan')).toBe('1')
    await wrapper.setData({ quantity: 456 })
    expect(wrapper.get('tbody tr:first-child td').text()).toBe('456')
  })

  it('keeps changes when the first header is hidden without persistent storage', async () => {
    wrapper = mount(ColumnManagedTable, {
      props: { data: [{ serial: '691236-50', quantity: 30 }] },
      global: { ...global, provide: {}, components: { ElTableColumn } },
      slots: {
        default:
          '<ElTableColumn prop="serial" label="流水号"/><ElTableColumn prop="quantity" label="数量"/>',
      },
    })
    await flushPromises()
    const settings = await open()
    settings
      .findAllComponents(ElCheckbox)
      .find((item) => item.text() === '流水号')!
      .vm.$emit('update:modelValue', false)
    await apply()
    expect(header()).toEqual(['数量'])
    expect(wrapper.get('.el-table__body').text()).toContain('30')
  })

  it('does not add a duplicate control to managed lists or document field layouts', async () => {
    wrapper = mount(ColumnManagedTable, {
      props: { columnSettings: false },
      global: { components: { ElTableColumn } },
      slots: { default: '<ElTableColumn label="流水号"/>' },
    })
    expect(wrapper.findComponent(InventoryColumnSettings).exists()).toBe(false)
    wrapper.unmount()
    wrapper = mount(AppDetailTable, {
      props: { fields: true },
      slots: { default: '<tbody><tr><th>流水号</th><td>691236-50</td></tr></tbody>' },
    })
    expect(wrapper.findComponent(InventoryColumnSettings).exists()).toBe(false)
    expect(wrapper.text()).toBe('流水号691236-50')
  })
})

// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { ElButton, ElTableColumn } from 'element-plus'
import WorkspaceTable from './WorkspaceTable.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('WorkspaceTable', () => {
  it('preserves row selection, expansion, sorting and business actions', async () => {
    const wrapper = mount(
      defineComponent({
        components: { WorkspaceTable, ElTableColumn, ElButton },
        data: () => ({
          rows: [{ id: 1, serial: '901030-07' }],
          selected: [],
          order: '',
          opened: 0,
        }),
        template: `<WorkspaceTable :data="rows" row-key="id" aria-label="加工记录"
          @selection-change="selected = $event" @sort-change="order = $event.order">
          <ElTableColumn type="selection" />
          <ElTableColumn type="expand"><template #default="{ row }"><p>工艺详情 {{ row.serial }}</p></template></ElTableColumn>
          <ElTableColumn prop="serial" label="流水号" sortable="custom" />
          <ElTableColumn label="操作"><template #default="{ row }"><ElButton link @click="opened = row.id">明细</ElButton></template></ElTableColumn>
        </WorkspaceTable>`,
      }),
    )
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('.el-table__body .el-checkbox input').setValue(true)
    expect(wrapper.vm.selected).toEqual([{ id: 1, serial: '901030-07' }])
    await wrapper.get('.el-table__expand-icon').trigger('click')
    expect(wrapper.find('.el-table__expanded-cell').text()).toContain('工艺详情 901030-07')
    await wrapper.get('.sort-caret.ascending').trigger('click')
    expect(wrapper.vm.order).toBe('ascending')
    await wrapper.getComponent(ElButton).trigger('click')
    expect(wrapper.vm.opened).toBe(1)
    expect(wrapper.attributes('aria-label')).toBe('加工记录')
  })

  it('preserves empty and appended content when data changes', async () => {
    const wrapper = mount(WorkspaceTable, {
      props: { data: [] },
      slots: {
        default: '<ElTableColumn prop="serial" label="流水号" />',
        empty: '暂无加工记录',
        append: '<p>统计结果</p>',
      },
      global: { components: { ElTableColumn } },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('暂无加工记录')
    await wrapper.setProps({ data: [{ serial: '901030-07' }] })
    await flushPromises()
    expect(wrapper.get('.el-table__body').text()).toContain('901030-07')
    expect(wrapper.get('.el-table__append-wrapper').text()).toBe('统计结果')
  })
})

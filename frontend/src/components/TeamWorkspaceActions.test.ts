// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import TeamWorkspaceActions from './TeamWorkspaceActions.vue'
import { workspaceAppearanceKey } from '@/composables/useWorkspaceAppearance'

describe.each(['glass', 'watermelon'] as const)('workspace actions in %s', (appearance) => {
  it('keeps permissions, busy protection and section actions when sharing buttons', async () => {
    const wrapper = mount(TeamWorkspaceActions, {
      props: {
        section: 'stock',
        canWrite: true,
        canReceive: true,
        warehouse: true,
        canReallocate: true,
        openingReceipt: true,
        openingDispatch: false,
        loading: false,
      },
      global: { provide: { [workspaceAppearanceKey as symbol]: computed(() => appearance) } },
    })
    const button = (text: string) => wrapper.findAll('button').find((item) => item.text() === text)!
    try {
      expect(button('新建入库').classes()).not.toContain('el-button--primary')
      await button('新建入库').trigger('click')
      expect(wrapper.emitted('receipt')).toBeUndefined()
      await wrapper.setProps({ openingReceipt: false })
      await button('新建入库').trigger('click')
      await button('新建出库').trigger('click')
      await button('扫码入库').trigger('click')
      expect(wrapper.emitted('receipt')).toHaveLength(1)
      expect(wrapper.emitted('dispatch')).toHaveLength(1)
      expect(wrapper.emitted('scan')).toHaveLength(1)
      await wrapper.setProps({ warehouse: false, canReceive: false })
      expect(button('新建出库').classes()).not.toContain('el-button--primary')
      await wrapper.setProps({ section: 'outgoing' })
      expect(button('新建出库').classes()).not.toContain('el-button--primary')
      await wrapper.setProps({ section: 'losses' })
      expect(wrapper.text()).not.toContain('新建出库')
      expect(button('登记丢失').classes()).not.toContain('el-button--primary')
      await button('登记丢失').trigger('click')
      expect(wrapper.emitted('loss')).toHaveLength(1)
      await wrapper.setProps({ section: 'reallocations' })
      expect(button('新建转投').classes()).not.toContain('el-button--primary')
      await button('新建转投').trigger('click')
      expect(wrapper.emitted('reallocate')).toHaveLength(1)
      await wrapper.setProps({ loading: true })
      await wrapper.get('[aria-label="刷新工作台"]').trigger('click')
      expect(wrapper.emitted('refresh')).toBeUndefined()
      await wrapper.setProps({ loading: false })
      await wrapper.get('[aria-label="刷新工作台"]').trigger('click')
      expect(wrapper.emitted('refresh')).toHaveLength(1)
      await wrapper.setProps({
        section: 'stock',
        canWrite: false,
        canReceive: false,
        canReallocate: false,
        showRefresh: false,
      })
      expect(wrapper.findAll('button')).toHaveLength(0)
    } finally {
      wrapper.unmount()
    }
  })
})

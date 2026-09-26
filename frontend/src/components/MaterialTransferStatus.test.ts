// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialTransferStatus from './MaterialTransferStatus.vue'

describe('transfer status perspective', () => {
  it('uses sender receipt wording without changing receiver or external status', async () => {
    const wrapper = mount(MaterialTransferStatus, { props: { status: 'pending', entryKind: 'transfer', outgoing: true } })
    try {
      expect(wrapper.text()).toBe('转出待签收')
      await wrapper.setProps({ status: 'received' }); expect(wrapper.text()).toBe('已签收')
      await wrapper.setProps({ status: 'pending', outgoing: false }); expect(wrapper.text()).toBe('待接收')
      await wrapper.setProps({ entryKind: 'warehouse_outbound', outgoing: true }); expect(wrapper.text()).toBe('待出库确认')
    } finally { wrapper.unmount() }
  })
})

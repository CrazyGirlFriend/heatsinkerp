// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialTransferHistory from './MaterialTransferHistory.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'

describe('quantity clearance audit', () => {
  it('shows the reason, actual piece delta and related batches without calling it a loss', () => {
    const transfer = normalizeMaterialTransfer({ id: 1, batch_no: 'TL-SOURCE', history: [{
      id: 2, action: 'quantity_changed', actor: '轧制班组长', occurred_at: '2026-09-29T01:00:00Z',
      changes: {
        stock_quantity: { before: 20, after: 0 },
        reason: { before: null, after: '加工后实际件数减少，重量已全部转出' },
        outbound_batches: { before: null, after: ['TL-OUT-1', 'TL-OUT-2'] },
      },
    }] })
    const wrapper = mount(MaterialTransferHistory, { props: { transfer } })
    try {
      expect(wrapper.text()).toContain('出库余数清零')
      expect(wrapper.text()).toContain('清零原因')
      expect(wrapper.text()).toContain('20 件 → 0 件')
      expect(wrapper.text()).toContain('轧制班组长')
      expect(wrapper.text()).toContain('加工后实际件数减少，重量已全部转出')
      expect(wrapper.text()).toContain('TL-OUT-1、TL-OUT-2')
      expect(wrapper.text()).not.toContain('丢失')
    } finally { wrapper.unmount() }
  })
})

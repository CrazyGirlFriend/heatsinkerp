// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialTransferHistory from './MaterialTransferHistory.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'

describe('quantity clearance audit', () => {
  it('shows the reason, actual piece delta and related batches without calling it a loss', () => {
    const transfer = normalizeMaterialTransfer({
      id: 1,
      batch_no: 'TL-SOURCE',
      history: [
        {
          id: 2,
          action: 'quantity_changed',
          actor: '轧制班组长',
          occurred_at: '2026-09-29T01:00:00Z',
          changes: {
            stock_quantity: { before: 20, after: 0 },
            reason: { before: null, after: '加工后实际件数减少，重量已全部转出' },
            outbound_batches: { before: null, after: ['TL-OUT-1', 'TL-OUT-2'] },
          },
        },
      ],
    })
    const wrapper = mount(MaterialTransferHistory, { props: { transfer } })
    try {
      expect(wrapper.text()).toContain('出库余数清零')
      expect(wrapper.text()).toContain('清零原因')
      expect(wrapper.text()).toContain('20 件 → 0 件')
      expect(wrapper.text()).toContain('轧制班组长')
      expect(wrapper.text()).toContain('加工后实际件数减少，重量已全部转出')
      expect(wrapper.text()).toContain('TL-OUT-1、TL-OUT-2')
      expect(wrapper.text()).not.toContain('丢失')
    } finally {
      wrapper.unmount()
    }
  })
})

it('preserves and displays inspection audit facts in batch history', () => {
  const transfer = normalizeMaterialTransfer({
    id: 1,
    batch_no: 'TL42',
    history: [
      {
        id: 2,
        action: 'inspection_rechecked',
        actor: '检验班组长',
        occurred_at: '2026-10-19T01:00:00Z',
        changes: {
          inspection: {
            before: null,
            after: { inspector: '王检验', sample: 5, failed: 0, released: true },
          },
        },
      },
    ],
  })
  const wrapper = mount(MaterialTransferHistory, { props: { transfer } })
  try {
    expect(wrapper.text()).toContain('复检登记')
    expect(wrapper.text()).toContain('王检验 · 抽检 5 件 · 不合格 0 件 · 历史锁定已解除')
  } finally {
    wrapper.unmount()
  }
})

it('retains route binding audit and presents its process step in business wording', () => {
  const transfer = normalizeMaterialTransfer({
    id: 1,
    batch_no: 'TL42',
    history: [
      {
        id: 3,
        action: 'route_bound',
        actor: '库房班长',
        occurred_at: '2026-10-23T01:00:00Z',
        changes: {
          process_route: {
            before: null,
            after: { title: '首批派工', sequence_no: 0, step_name: '备料' },
          },
        },
      },
    ],
  })
  const wrapper = mount(MaterialTransferHistory, { props: { transfer } })
  try {
    expect(wrapper.text()).toContain('关联派工工艺')
    expect(wrapper.text()).toContain('首批派工 · 0 · 备料')
  } finally {
    wrapper.unmount()
  }
})

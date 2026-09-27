// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { ElPopover } from 'element-plus'
import TraceStockSummary from './TraceStockSummary.vue'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { MaterialTrace } from '@/types/materialTrace'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount() })
const amount = { quantity: 0, weight: 0 }
const trace: MaterialTrace = {
  serial_no: 'YS-017', positions: [], untracked_count: 0,
  totals: { on_hand: amount, in_transit: amount, external_pending: amount, dispatched: amount, lost: amount },
  holdings: [
    { team_id: 1, team_code: 'FACTORY-WAREHOUSE', team_name: '库房班组', material_types: [
      { material_type: 'finished_surplus', quantity: 6, weight: .96 },
      { material_type: 'semi_finished_surplus', quantity: 12, weight: 1.92 },
      { material_type: 'scrap_chips', quantity: 0, weight: 18.577 },
      { material_type: 'defective', quantity: 6, weight: .96 },
    ] },
    { team_id: 8, team_code: 'FACTORY-QC', team_name: '检验', material_types: [
      { material_type: 'finished', quantity: 317, weight: 47.229 },
      { material_type: 'scrap_chips', quantity: 0, weight: 1 },
    ] },
  ],
  items: ['dispatched', 'pending', 'voided'].flatMap((status, id) => ['finished', 'scrap_chips'].map(material_type => ({
    ...normalizeMaterialTransfer({ id, status, material_type, quantity: 30, weight: 3, entry_kind: 'inspection_shipment' }),
    on_hand_quantity: null, on_hand_weight: null,
  }))),
}
function render(data = trace) {
  wrapper = mount(TraceStockSummary, { props: { trace: data, teams: ['库房', '轧制', '检验', '外部 · 客户'], metric: 'quantity', range: { start: 0, end: 100 } } })
  return wrapper
}
it('totals reusable stock across batches and excludes waste and external shipments', async () => {
  const page = render()
  expect(page.get('[data-team="库房"]').text()).toContain('18件')
  expect(page.get('[data-team="检验"]').text()).toContain('317件')
  expect(page.get('[data-team="轧制"]').text()).toContain('0 件')
  expect(page.get('[data-team="外部 · 客户"]').text()).toContain('—')
  expect(page.get('.stock-total').text()).toBe('正常料合计335 件')
  expect(page.get('.stock-shipped').text()).toBe('成品已发货30 件')
  expect(page.get('.stock-waste').text()).toContain('20.537 kg')
  await page.get('.stock-unit button:last-child').trigger('click')
  expect(page.emitted('update:metric')).toEqual([['weight']])
  await page.setProps({ metric: 'weight' })
  expect(page.get('.stock-total').text()).toBe('正常料合计50.109 kg')
  expect(page.get('[data-team="检验"]').text()).toContain('47.229kg')
})
it('breaks down reusable natures and waste by team, including weight-only waste', async () => {
  const page = render()
  const popovers = page.findAllComponents(ElPopover)
  expect(popovers[0]!.text()).toContain('18')
  await page.get('.stock-waste').trigger('click')
  await flushPromises()
  const waste = document.body.querySelector('.stock-waste-details')!
  expect(waste.textContent).toContain('废屑')
  expect(waste.textContent).toContain('19.577 kg')
  expect(waste.textContent).toContain('库房')
  expect(waste.textContent).toContain('检验')
})
it('keeps each row aligned with a zoomed team viewport without changing current totals', async () => {
  const page = render()
  expect(page.get('[data-team="检验"]').attributes('style')).toContain('top: 62.5%')
  await page.setProps({ range: { start: 25, end: 75 } })
  expect(page.get('[data-team="检验"]').attributes('style')).toContain('top: 75%')
  expect(page.get('.stock-total').text()).toBe('正常料合计335 件')
})
it('distinguishes an unavailable older response from a verified zero balance', async () => {
  const page = render({ ...trace, holdings: undefined })
  expect(page.get('.stock-total').text()).toBe('正常料合计—')
  await page.setProps({ trace: { ...trace, holdings: [] } })
  expect(page.get('.stock-total').text()).toBe('正常料合计0 件')
})

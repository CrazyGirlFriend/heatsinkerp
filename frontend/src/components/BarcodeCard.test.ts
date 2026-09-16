// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const renderBarcode = vi.hoisted(() => vi.fn((element: SVGSVGElement, value: string) => {
  element.setAttribute('width', String(value.length * 24))
  element.setAttribute('height', '72')
}))

vi.mock('jsbarcode', () => ({ default: renderBarcode }))

import BarcodeCard from './BarcodeCard.vue'

describe('BarcodeCard', () => {
  it('keeps a large barcode at a readable width inside a horizontal scroller', async () => {
    const wrapper = mount(BarcodeCard, { props: { value: 'TL202609050000000000000000000001' } })
    await flushPromises()

    const svg = wrapper.get('svg')
    expect(Number(svg.attributes('width'))).toBeGreaterThan(320)
    expect(wrapper.classes()).toContain('barcode-card--scrollable')
    expect(renderBarcode).toHaveBeenLastCalledWith(expect.any(SVGSVGElement), 'TL202609050000000000000000000001', expect.objectContaining({ width: 1.7, height: 52 }))
  })

  it('retains the compact rendering profile for list previews', async () => {
    const wrapper = mount(BarcodeCard, { props: { value: 'TL20260905000042', compact: true } })
    await flushPromises()

    expect(wrapper.classes()).toContain('barcode-card--compact')
    expect(renderBarcode).toHaveBeenLastCalledWith(expect.any(SVGSVGElement), 'TL20260905000042', expect.objectContaining({ width: 1.15, height: 28 }))
  })
})

// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import type { SerialUrgency } from '@/types/recordFilters'

const urgency: SerialUrgency = { urgent: true, reason: '交期提前', version: 1, updated_by: '系统管理员', updated_at: '2026-09-12T12:00:00Z' }
let wrapper: VueWrapper
function render(value: SerialUrgency | null) {
  wrapper = mount(SerialUrgencyBadge, { props: { urgency: value }, global: { stubs: { ElPopover: { template: '<div><slot name="reference"/><slot/></div>' } } } })
}
afterEach(() => wrapper?.unmount())

describe('animated serial urgency badge', () => {
  it('keeps a labelled button and stable text separate from the decorative flag', () => {
    render(urgency)
    expect(wrapper.get('button').attributes()).toMatchObject({ type: 'button', 'aria-label': '查看加急原因' })
    expect(wrapper.get('.serial-urgency-badge__flag').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.serial-urgency-badge__label').text()).toBe('加急')
    expect(wrapper.text()).toContain('交期提前')
    expect(wrapper.text()).toContain('系统管理员')
  })
  it('removes the complete badge when urgency is cancelled', async () => {
    render(urgency)
    await wrapper.setProps({ urgency: { ...urgency, urgent: false } })
    expect(wrapper.find('.serial-urgency-badge').exists()).toBe(false)
  })
  it('does not mark an ordinary record and preserves missing-reason text', async () => {
    render(null)
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ urgency: { ...urgency, reason: null } })
    expect(wrapper.text()).toContain('未填写原因')
  })
})

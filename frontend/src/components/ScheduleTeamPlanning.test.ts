// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ScheduleTeamPlanning from './ScheduleTeamPlanning.vue'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule } from '@/types/productionSchedule'

it('fills the warehouse icon to its real dispatch ratio and mounts a short summary only on focus', async () => {
  const node = {
    ...scheduleSummaryFixture(),
    id: 1,
    team_name: '库房',
    assessment_enabled: false,
    target_quantity: 100,
    dispatched_quantity: 60,
    received_quantity: 40,
    due_at: '2026-11-25T08:00:00+08:00',
    planning_state: 'confirmed',
    sequence_no: 1,
  } as ProductionSchedule
  const wrapper = mount(ScheduleTeamPlanning, {
    props: { nodes: [node] },
    global: {
      stubs: {
        AppPopover: {
          props: ['visible'],
          template: '<div><slot name="reference"/><slot v-if="visible"/></div>',
        },
      },
    },
  })
  try {
    const icon = wrapper.get('.team-planning__step')
    expect(icon.attributes('style')).toContain('--planning-progress: 60%')
    expect(icon.attributes('aria-label')).toContain('已转出 60%')
    expect(wrapper.find('.schedule-node-summary').exists()).toBe(false)
    await icon.trigger('focusin')
    await flushPromises()
    expect(wrapper.get('.schedule-node-summary').text()).toContain('约定转交')
    expect(wrapper.get('.schedule-node-summary').text()).toContain('60 件')
    await icon.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
    await icon.trigger('focusout')
    expect(wrapper.find('.schedule-node-summary').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

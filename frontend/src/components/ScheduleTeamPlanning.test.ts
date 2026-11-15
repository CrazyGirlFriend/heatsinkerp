// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ScheduleTeamPlanning from './ScheduleTeamPlanning.vue'
import { scheduleSummaryFixture } from '@/testFixtures/inventorySchedule'
import type { ProductionSchedule, ScheduleBatch } from '@/types/productionSchedule'

it('fills the warehouse initial to its real dispatch ratio and mounts a short summary only on focus', async () => {
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
    expect(icon.get('.team-planning__initial').text()).toBe('库')
    expect(icon.find('svg').exists()).toBe(false)
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

it.each(['库房', '检验'])(
  'shows customer shipment wording for %s without implying downstream receipt',
  async (team_name) => {
    const node = {
      ...scheduleSummaryFixture(),
      team_name,
      next_team_id: null,
      next_team_name: null,
      external_destination: '对外转料',
      completion_basis: 'quantity',
      processed_quantity: 100,
      dispatched_quantity: 60,
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
      expect(icon.attributes('aria-label')).toContain('已发货 60%')
      expect(icon.attributes('style')).toContain('--planning-progress: 60%')
      await icon.trigger('focusin')
      const summary = wrapper.get('.schedule-node-summary')
      expect(summary.get('[aria-label="发货进度"]').text()).toContain('已发货 60%')
      expect(summary.text()).toContain('约定发货')
      expect(summary.text()).toContain('实际发齐')
      expect(summary.text()).not.toContain('下序已签收')
      expect(summary.text()).not.toContain('已转出')

      for (const destination of [
        { next_team_id: 3, external_destination: null },
        { next_team_id: null, external_destination: '库房成品' },
        { next_team_id: null, external_destination: '外委库' },
      ]) {
        await wrapper.setProps({ nodes: [{ ...node, ...destination }] })
        expect(icon.attributes('aria-label')).toContain('已转出 60%')
        expect(summary.get('[aria-label="转出进度"]').text()).toContain('已转出 60%')
        expect(summary.text()).toContain('约定转交')
        expect(summary.text()).toContain('下序已签收')
        expect(summary.text()).not.toContain('已发货')
      }
    } finally {
      wrapper.unmount()
    }
  },
)

it('keeps one team circle and reveals each batch quantity, deadline and handover status only in the summary', async () => {
  const first: ScheduleBatch = {
    id: 101,
    batch_number: 1,
    target_quantity: 60,
    target_weight: 6,
    dispatched_quantity: 60,
    dispatched_weight: 6,
    received_quantity: 40,
    received_weight: 4,
    due_at: '2026-11-15T10:00:00+08:00',
    status: 'not_assessed',
    handover_status: 'completed',
    completed_at: null,
    upstream_batch_ids: [],
    warnings: [],
  }
  const second: ScheduleBatch = {
    ...first,
    id: 102,
    batch_number: 2,
    target_quantity: 40,
    dispatched_quantity: 0,
    due_at: '2026-11-15T14:00:00+08:00',
    handover_status: 'overdue',
  }
  const node = {
    ...scheduleSummaryFixture(),
    team_name: '库房',
    sequence_no: 1,
    completion_basis: 'quantity',
    dispatched_quantity: 60,
    batches: [second, { ...first, id: 103, batch_number: 3, status: 'cancelled' }, first],
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
    expect(wrapper.findAll('.team-planning__step')).toHaveLength(1)
    expect(wrapper.text()).toBe('库')
    await wrapper.get('.team-planning__step').trigger('focusin')
    expect(wrapper.get('.schedule-node-summary header').text()).toContain('已转出 60%')
    const rows = wrapper.findAll('.schedule-node-batches li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('第 1 批')
    expect(rows[0]!.text()).toContain('60 / 60 件')
    expect(rows[0]!.text()).toContain('2026-11-15 10:00')
    expect(rows[0]!.text()).toContain('按时完成')
    expect(rows[1]!.text()).toContain('第 2 批')
    expect(rows[1]!.text()).toContain('0 / 40 件')
    expect(rows[1]!.text()).toContain('2026-11-15 14:00')
    expect(rows[1]!.text()).toContain('逾期未交完')
    expect(wrapper.get('.schedule-node-batches__heading').text()).toContain('已转 / 应交')
    await wrapper.setProps({
      nodes: [{ ...node, next_team_id: null, external_destination: '对外转料' }],
    })
    expect(wrapper.get('.schedule-node-summary header').text()).toContain('已发货 60%')
    expect(wrapper.get('.schedule-node-batches__heading').text()).toContain('分批发货')
    expect(wrapper.get('.schedule-node-batches__heading').text()).toContain('已发 / 应发')
    expect(wrapper.findAll('.schedule-node-batches li')[1]!.text()).toContain('0 / 40 件')
    await wrapper.get('.team-planning__step').trigger('focusout')
    expect(wrapper.text()).toBe('库')
  } finally {
    wrapper.unmount()
  }
})

it.each([
  { status: 'not_assessed', handover_status: 'overdue', overdue: true },
  { status: 'pending', handover_status: 'overdue', overdue: true },
  { status: 'completed', handover_status: 'completed_late', overdue: true },
  { status: 'overdue', handover_status: 'completed', overdue: false },
  { status: 'overdue', handover_status: undefined, overdue: true },
  { status: 'pending', handover_status: 'pending', overdue: false },
] as const)(
  'uses handover status for the red background: %j',
  ({ status, handover_status, overdue }) => {
    const node = {
      ...scheduleSummaryFixture(),
      team_name: '线切割',
      sequence_no: 1,
      status,
      handover_status,
      planning_state: 'confirmed',
    } as ProductionSchedule
    const wrapper = mount(ScheduleTeamPlanning, { props: { nodes: [node] } })
    try {
      const symbol = wrapper.get('.team-planning__symbol')
      expect(symbol.get('.team-planning__initial').text()).toBe('线')
      expect(symbol.classes().includes('is-overdue')).toBe(overdue)
      if (overdue) expect(symbol.attributes('aria-label')).toContain('逾期')
    } finally {
      wrapper.unmount()
    }
  },
)

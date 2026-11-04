// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ScheduleTimelineBar from './ScheduleTimelineBar.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { layoutBoardBars, BOARD_DAY } from '@/utils/scheduleBoard'

it('keeps delivery and receipt counts distinct in the popover and preserves late completion', async () => {
  const start = Date.parse('2026-11-02T00:00:00+08:00')
  const node = {
    id: 1,
    serial_no: '691236-51',
    team_name: '研磨',
    next_team_name: '检验',
    sequence_no: 1,
    planning_state: 'confirmed',
    completion_basis: 'quantity',
    target_quantity: 60,
    dispatched_quantity: 60,
    received_quantity: 40,
    status: 'completed_late',
    planned_start_at: '2026-11-02T08:00:00+08:00',
    due_at: '2026-11-02T16:00:00+08:00',
    completed_at: '2026-11-02T18:00:00+08:00',
  } as ProductionSchedule
  const bar = layoutBoardBars([node], start, start + BOARD_DAY, 600).bars[0]!
  const wrapper = mount(ScheduleTimelineBar, {
    props: { bar, serialNo: node.serial_no, now: start + BOARD_DAY },
    global: {
      stubs: {
        AppPopover: {
          methods: { hide() {} },
          template: '<div><slot name="reference"/><slot/></div>',
        },
      },
    },
  })
  expect(wrapper.get('.batch-bar').text()).toBe('研磨')
  expect(wrapper.get('.detail-status').text()).toBe('逾期完成')
  expect(wrapper.get('.bar-endpoint').attributes('aria-label')).toBe('逾期完成')
  expect(wrapper.findAll('.detail-quantities > div').map((item) => item.text())).toEqual([
    '应交60件',
    '已转出60件',
    '下序已签收40件',
  ])
  expect(wrapper.get('.detail-dates').text()).toContain('2026-11-02 18:00')
  await wrapper.get('.detail-button').trigger('click')
  expect(wrapper.emitted('open')).toHaveLength(1)
  wrapper.unmount()
})

// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { TraceBatch } from '@/types/materialTrace'
import type { ProcessRouteContext } from '@/types/processRoute'
import TraceBatchDetail from './TraceBatchDetail.vue'

const processRoute: ProcessRouteContext = {
  id: 8,
  title: '首批派工',
  version: 1,
  step_index: 2,
  sequence_no: 3,
  step_name: '精磨',
  instructions: '厚度 2.5（+0.01/-0.02）mm\n禁止叠放；单件放入泡沫盒，清洗吹干后逐件复核。',
  team_id: 2,
  processing_task_id: 12345,
  purpose_id: 3,
  split_here: false,
  complete: false,
}

function batch(overrides: Partial<TraceBatch> = {}): TraceBatch {
  return {
    ...normalizeMaterialTransfer({
      id: 1,
      batch_no: 'TL-001',
      serial_no: 'S-001',
      source_team: { id: 1, name: '退火' },
      next_team: { id: 2, name: '研磨' },
      quantity: 10,
      weight: 1,
      status: 'received',
    }),
    on_hand_quantity: 10,
    on_hand_weight: 1,
    ...overrides,
  }
}

describe('trace batch process requirements', () => {
  it('shows the current step and full multiline instructions without exposing a task ID', () => {
    const wrapper = mount(TraceBatchDetail, {
      props: { batch: batch({ process_route: processRoute }) },
    })
    try {
      expect(wrapper.text()).toContain('本道工序')
      expect(wrapper.text()).toContain('首批派工 · 3 · 精磨')
      const requirements = wrapper.get('.route-instructions')
      expect(requirements.get('dt').text()).toBe('本道工艺要求')
      expect(requirements.get('dd').element.textContent).toBe(processRoute.instructions)
      expect(wrapper.text()).not.toContain('12345')
      expect(wrapper.find('[title]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps rework attributes alongside the recorded route requirements', () => {
    const wrapper = mount(TraceBatchDetail, {
      props: {
        batch: batch({ process_route: processRoute, rework_pending: true, rework_count: 3 }),
      },
    })
    try {
      expect(wrapper.text()).toContain('待返工 · 累计 3 次')
      expect(wrapper.get('.route-instructions dd').element.textContent).toBe(
        processRoute.instructions,
      )
    } finally {
      wrapper.unmount()
    }
  })

  it.each([undefined, '', '   '])(
    'does not invent instructions for a historical batch with missing requirements (%s)',
    (instructions) => {
      const wrapper = mount(TraceBatchDetail, {
        props: {
          batch: batch({
            process_route: instructions === undefined ? null : { ...processRoute, instructions },
            technical_requirements: '成品按图纸要求',
          }),
        },
      })
      try {
        expect(wrapper.find('.route-instructions').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('本道工艺要求')
        expect(wrapper.text()).not.toContain('成品按图纸要求')
      } finally {
        wrapper.unmount()
      }
    },
  )
})

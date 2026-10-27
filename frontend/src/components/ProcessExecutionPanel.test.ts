// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ProcessExecutionPanel from './ProcessExecutionPanel.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'

let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

it('keeps the current operation fixed while reading previous, next and original requirements', async () => {
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue({ ...routeFixture, state: 'published' })
  wrapper = mount(ProcessExecutionPanel, {
    props: {
      serial: 'S-001',
      context: {
        id: 8,
        version: 1,
        title: '首批派工',
        step_index: 2,
        sequence_no: 2,
        step_name: '精磨',
        instructions: '清洗吹干',
        team_id: 2,
        processing_task_id: 4,
        purpose_id: 3,
        split_here: false,
        complete: false,
        available: true,
      },
    },
    global: {
      stubs: {
        WordDocumentPreview: {
          props: ['route', 'sourceRow'],
          template: '<div data-word-preview />',
        },
        ProcessRouteDrawingPreview: true,
      },
    },
  })
  await flushPromises()
  expect(wrapper.get('.is-current').text()).toContain('精磨')
  await wrapper.findAll('.execution-nodes button')[1]!.trigger('click')
  expect(wrapper.get('.execution-requirements').text()).toContain('禁止摞放')
  expect(wrapper.get('.is-current').text()).toContain('精磨')
  expect(wrapper.emitted()).not.toHaveProperty('update:context')
  expect(wrapper.findAll('input, textarea').length).toBe(0)
  expect(wrapper.find('[data-word-preview]').exists()).toBe(false)
  await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
  expect(wrapper.find('[data-word-preview]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('保存工艺')
})

it('discards a late route response after switching to a different physical route', async () => {
  let finish!: (value: typeof routeFixture) => void
  vi.spyOn(processRouteApi, 'detail').mockImplementation((id) =>
    id === 8
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({
          ...routeFixture,
          id,
          steps: [{ ...routeFixture.steps[0]!, name: '返工磨削' }],
        }),
  )
  const context = {
    id: 8,
    version: 1,
    title: '',
    step_index: 0,
    sequence_no: 0,
    step_name: '',
    instructions: '',
    team_id: 2,
    processing_task_id: null,
    purpose_id: null,
    split_here: false,
    complete: false,
  }
  wrapper = mount(ProcessExecutionPanel, { props: { context } })
  await wrapper.setProps({ context: { ...context, id: 9 } })
  await flushPromises()
  finish(routeFixture)
  await flushPromises()
  expect(wrapper.get('.execution-nodes').text()).toContain('返工磨削')
  expect(wrapper.get('.execution-nodes').text()).not.toContain('粗磨')
})

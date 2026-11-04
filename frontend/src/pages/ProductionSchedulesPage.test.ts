// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ProductionSchedulesPage from './ProductionSchedulesPage.vue'

it('gives the scheduling board the page without a separate title or fullscreen action', () => {
  const wrapper = mount(ProductionSchedulesPage, {
    global: { stubs: { ScheduleTaskBoard: true } },
  })
  expect(wrapper.attributes('aria-label')).toBe('生产排期')
  expect(wrapper.findComponent({ name: 'ScheduleTaskBoard' }).exists()).toBe(true)
  expect(wrapper.find('header').exists()).toBe(false)
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
})
